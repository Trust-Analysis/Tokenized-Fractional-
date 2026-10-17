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
 * Notes:
 * - Redis Pub/Sub is fire-and-forget by design; messages published while a
 *   node is offline are not replayed to it. The existing WebSocketDLQService
 *   still buffers messages per instance for clients reconnecting to the same
 *   node.
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
    this.pub = null;
    this.sub = null;
    this.connected = false;
  }

  /**
   * Connect the publisher and subscriber clients and start listening for
   * broadcasts from other instances. Never throws — on failure the adapter
   * disables itself and the manager keeps working in single-node mode.
   */
  async connect() {
    try {
      this.pub = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });
      this.sub = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });

      await this.pub.connect();
      await this.sub.connect();
      await this.sub.subscribe(this.channel);

      this.sub.on('message', (channel, payload) => {
        this.handleMessage(channel, payload);
      });

      this.connected = true;
      logger.info(
        { instanceId: this.instanceId, channel: this.channel },
        'WebSocket Redis Pub/Sub adapter connected'
      );
    } catch (error) {
      this.connected = false;
      logger.error(
        { error: error.message, redisUrl: this.redisUrl },
        'WebSocket Redis Pub/Sub adapter failed to connect; running single-node'
      );
    }
    return this.connected;
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
      logger.error({ error: error.message, topic }, 'Failed to publish WebSocket broadcast to Redis');
    });
  }

  /**
   * Close both Redis connections.
   */
  async close() {
    this.connected = false;
    try {
      if (this.sub) await this.sub.quit();
    } catch {
      /* ignore */
    }
    try {
      if (this.pub) await this.pub.quit();
    } catch {
      /* ignore */
    }
  }
}
