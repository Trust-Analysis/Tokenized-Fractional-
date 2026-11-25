/**
 * WebSocket Redis Pub/Sub Adapter (Issue #593)
 *
 * Bridges WebSocket broadcasts across horizontally-scaled backend instances.
 * Each instance publishes its broadcasts to a shared Redis channel and
 * subscribes to that same channel, so a message broadcast on instance A is
 * delivered to clients connected to instance B (and vice versa). This lets
 * order book and price updates reach every client no matter which node they
 * are connected to.
 *
 * Resilience & Reconnection:
 * - Never throws — on initial connection failure or mid-session disconnect,
 *   the adapter disables itself (connected = false) and the manager keeps
 *   working in single-node mode.
 * - Automatically attempts background reconnection when Redis is unreachable
 *   or recovers after an outage, re-subscribes to the channel, and restores
 *   cross-instance broadcasting without requiring a full backend restart.
 * - Each instance tags its messages with a unique `instanceId` and ignores
 *   its own messages, preventing broadcast loops.
 */

import Redis from 'ioredis';
import { logger } from './src/services/logger.js';

const DEFAULT_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export class WebSocketRedisAdapter {
  constructor(wsManager, options = {}) {
    this.wsManager = wsManager;
    this.redisUrl = options.redisUrl || DEFAULT_REDIS_URL;
    this.channel = options.channel || 'ws:broadcast';
    this.instanceId = options.instanceId || `ws-${process.pid}-${Date.now()}`;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.RedisClient = options.RedisClient || Redis;
    this.redisOptions = options.redisOptions || {};
    this.pub = null;
    this.sub = null;
    this.connected = false;
    this.closed = false;
    this.reconnectTimer = null;
    this.isConnecting = false;
  }

  /**
   * Connect the publisher and subscriber clients and start listening for
   * broadcasts from other instances. Never throws — on failure or disconnect
   * the adapter disables itself and the manager keeps working in single-node mode.
   * Automatically attempts reconnection in the background when Redis recovers,
   * without requiring a full backend restart.
   *
   * @returns {Promise<boolean>} Whether the adapter is currently connected.
   */
  async connect() {
    if (this.closed) return false;
    if (this.connected) return true;
    if (this.isConnecting) return false;

    this.isConnecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      await this._cleanupClients();

      const clientOptions = {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (this.closed) return null;
          return Math.min(times * 200, this.reconnectInterval);
        },
        ...this.redisOptions,
      };

      this.pub = new this.RedisClient(this.redisUrl, clientOptions);
      this.sub = new this.RedisClient(this.redisUrl, clientOptions);

      this._setupClientListeners(this.pub, 'pub');
      this._setupClientListeners(this.sub, 'sub');

      await Promise.all([this.pub.connect(), this.sub.connect()]);
      await this.sub.subscribe(this.channel);

      this.connected = true;
      logger.info(
        { instanceId: this.instanceId, channel: this.channel },
        'WebSocket Redis Pub/Sub adapter connected',
      );
    } catch (error) {
      this.connected = false;
      logger.error(
        { error: error.message, redisUrl: this.redisUrl },
        'WebSocket Redis Pub/Sub adapter failed to connect; running single-node',
      );
      this._scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
    return this.connected;
  }

  /**
   * Attach lifecycle and error listeners on Redis clients.
   * Prevents unhandled error events from crashing the process.
   */
  _setupClientListeners(client, type) {
    if (!client || typeof client.on !== 'function') return;

    client.on('error', (error) => {
      logger.debug(
        { client: type, error: error.message, instanceId: this.instanceId },
        'WebSocket Redis Pub/Sub client error',
      );
      this._handleDisconnect();
    });

    client.on('close', () => {
      this._handleDisconnect();
    });

    client.on('ready', async () => {
      await this._onClientReady();
    });

    if (type === 'sub') {
      client.on('message', (channel, payload) => {
        this.handleMessage(channel, payload);
      });
    }
  }

  /**
   * Handle unexpected disconnection of a Redis client.
   */
  _handleDisconnect() {
    if (this.closed) return;
    if (this.connected) {
      this.connected = false;
      logger.warn(
        { instanceId: this.instanceId, channel: this.channel },
        'WebSocket Redis Pub/Sub adapter connection lost; running single-node',
      );
    }
    this._scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt after a failure or disconnection.
   */
  _scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.closed && !this.connected) {
        await this._retryConnect();
      }
    }, this.reconnectInterval);
  }

  _isPubReady() {
    return !!(this.pub && (this.pub.status === 'ready' || this.pub.status === 'connect'));
  }

  _isSubReady() {
    return !!(this.sub && (this.sub.status === 'ready' || this.sub.status === 'connect'));
  }

  /**
   * Called when a client emits 'ready'. If both pub and sub are ready,
   * resubscribe and re-enable cross-instance broadcasting.
   */
  async _onClientReady() {
    if (this.closed) return;
    if (this._isPubReady() && this._isSubReady()) {
      try {
        if (this.sub && typeof this.sub.subscribe === 'function') {
          await this.sub.subscribe(this.channel);
        }
        if (!this.connected) {
          this.connected = true;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          logger.info(
            { instanceId: this.instanceId, channel: this.channel },
            'WebSocket Redis Pub/Sub adapter reconnected',
          );
        }
      } catch (error) {
        logger.warn(
          { error: error.message, channel: this.channel },
          'Failed to re-subscribe on Redis reconnect',
        );
        this.connected = false;
        this._scheduleReconnect();
      }
    }
  }

  /**
   * Background retry logic called by the reconnect timer.
   */
  async _retryConnect() {
    if (this.closed || this.connected) return;

    if (this._isPubReady() && this._isSubReady()) {
      await this._onClientReady();
      if (this.connected) return;
    }

    await this.connect();
  }

  /**
   * Handle an incoming Pub/Sub message from another instance.
   */
  handleMessage(channel, payload) {
    if (channel !== this.channel) return;

    try {
      const envelope = JSON.parse(payload);
      // Ignore our own messages to prevent broadcast loops.
      if (envelope.instanceId === this.instanceId) return;
      this.wsManager.handleRemoteBroadcast(envelope.topic, envelope.message);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to process Redis WebSocket message');
    }
  }

  /**
   * Publish a broadcast so every other instance can deliver it to their
   * local subscribers.
   */
  publish(topic, message) {
    if (!this.connected || !this.pub) return;

    const envelope = JSON.stringify({
      instanceId: this.instanceId,
      topic,
      message,
    });

    this.pub.publish(this.channel, envelope).catch((error) => {
      logger.error(
        { error: error.message, topic },
        'Failed to publish WebSocket broadcast to Redis',
      );
      this._handleDisconnect();
    });
  }

  /**
   * Disconnect and clear Redis clients cleanly.
   */
  async _cleanupClients() {
    const clients = [this.sub, this.pub].filter(Boolean);
    this.sub = null;
    this.pub = null;

    await Promise.all(
      clients.map(async (client) => {
        try {
          client.removeAllListeners?.();
          client.on?.('error', () => {});
          if (typeof client.quit === 'function') {
            await client.quit();
          } else if (typeof client.disconnect === 'function') {
            client.disconnect();
          }
        } catch {
          try {
            client.disconnect?.();
          } catch {
            /* ignore */
          }
        }
      }),
    );
  }

  /**
   * Close both Redis connections and disable automatic reconnects.
   */
  async close() {
    this.closed = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this._cleanupClients();
  }
}
