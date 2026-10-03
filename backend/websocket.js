/**
 * WebSocket Server and Event Manager
 * Handles real-time updates for marketplace events (share purchases, price changes, etc.)
 * Enhanced with Dead Letter Queue for message reliability and delivery guarantees.
 */

import { WebSocketServer } from 'ws';
import { logger } from './src/services/logger.js';
import { websocketDLQService } from './src/services/websocketDLQService.js';
import { WebSocketRedisAdapter } from './websocketRedisAdapter.js';

/**
 * Event types for WebSocket communication
 */
export const WS_EVENT_TYPES = {
  SHARE_PURCHASED: 'share_purchased',
  PRICE_UPDATED: 'price_updated',
  ASSET_LISTED: 'asset_listed',
  ASSET_UPDATED: 'asset_updated',
  AVAILABILITY_CHANGED: 'availability_changed',
  MARKETPLACE_PAUSED: 'marketplace_paused',
  MARKETPLACE_UNPAUSED: 'marketplace_unpaused',
  CONNECTION_ESTABLISHED: 'connection_established',
  SUBSCRIPTION_CONFIRMED: 'subscription_confirmed',
  ERROR: 'error',
};

/**
 * WebSocket Manager - Manages connections and broadcasts events
 * Enhanced with DLQ for message reliability and sequence tracking
 */
export class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of clientId -> { ws, subscriptions: Set, lastSeqId: Map }
    this.subscriptions = new Map(); // Map of topic -> Set of clientIds
    this.clientLastSeqId = new Map(); // Map of clientId -> Map<channel, lastSeqId>
    this.redisAdapter = null; // Optional Redis Pub/Sub adapter (Issue #593)
  }

  /**
   * Initialize WebSocket server attached to HTTP server
   */
  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = this.generateClientId();
      logger.info({ clientId }, 'WebSocket client connected');

      const client = {
        ws,
        subscriptions: new Set(),
        clientId,
        lastSeqId: new Map(), // Track last sequence ID per channel
      };

      this.clients.set(clientId, client);
      this.clientLastSeqId.set(clientId, new Map());

      // Send connection confirmation
      this.send(ws, {
        type: WS_EVENT_TYPES.CONNECTION_ESTABLISHED,
        clientId,
        timestamp: new Date().toISOString(),
      });

      ws.on('message', (data) => {
        this.handleMessage(clientId, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (error) => {
        logger.error({ clientId, error: error.message }, 'WebSocket error');
        this.send(ws, {
          type: WS_EVENT_TYPES.ERROR,
          message: 'WebSocket error occurred',
          timestamp: new Date().toISOString(),
        });
      });
    });

    logger.info('WebSocket server initialized at /ws');
    return this.wss;
  }

  /**
   * Handle incoming messages from clients
   */
  handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data);
      const client = this.clients.get(clientId);

      if (!client) {
        logger.warn({ clientId }, 'Received message from unknown client');
        return;
      }

      switch (message.action) {
        case 'subscribe':
          this.subscribe(clientId, message.topic);
          break;
        case 'unsubscribe':
          this.unsubscribe(clientId, message.topic);
          break;
        case 'ping':
          this.send(client.ws, { type: 'pong', timestamp: new Date().toISOString() });
          break;
        case 'request_missing_messages':
          this.handleMissingMessageRequest(clientId, message);
          break;
        default:
          logger.warn({ clientId, action: message.action }, 'Unknown action');
      }
    } catch (error) {
      logger.error({ clientId, error: error.message }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all subscriptions
    for (const [topic, subscribers] of this.subscriptions) {
      if (subscribers.has(clientId)) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.subscriptions.delete(topic);
        }
      }
    }

    this.clients.delete(clientId);
    this.clientLastSeqId.delete(clientId);
    logger.info({ clientId }, 'WebSocket client disconnected');
  }

  /**
   * Subscribe client to a topic
   */
  subscribe(clientId, topic) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.add(topic);

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic).add(clientId);

    this.send(client.ws, {
      type: WS_EVENT_TYPES.SUBSCRIPTION_CONFIRMED,
      topic,
      timestamp: new Date().toISOString(),
    });

    logger.debug({ clientId, topic }, 'Client subscribed to topic');
  }

  /**
   * Unsubscribe client from a topic
   */
  unsubscribe(clientId, topic) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.delete(topic);

    const subscribers = this.subscriptions.get(topic);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        this.subscriptions.delete(topic);
      }
    }

    logger.debug({ clientId, topic }, 'Client unsubscribed from topic');
  }

  /**
   * Handle missing message request from client
   */
  async handleMissingMessageRequest(clientId, message) {
    const { topic, fromSeqId, toSeqId } = message;
    const client = this.clients.get(clientId);
    
    if (!client) {
      logger.warn({ clientId }, 'Missing message request from unknown client');
      return;
    }

    try {
      const missingMessages = await websocketDLQService.getMessagesInRange(topic, fromSeqId, toSeqId);
      
      logger.info({ clientId, topic, fromSeqId, toSeqId, count: missingMessages.length }, 'Sending missing messages to client');
      
      for (const msg of missingMessages) {
        this.send(client.ws, {
          type: 'historical_message',
          topic: msg.channel,
          data: msg.message,
          seqId: msg.seqId,
          timestamp: msg.timestamp,
        });
      }

      // Update client's last sequence ID
      const clientSeqIds = this.clientLastSeqId.get(clientId);
      if (clientSeqIds && missingMessages.length > 0) {
        const lastMsg = missingMessages[missingMessages.length - 1];
        clientSeqIds.set(topic, lastMsg.seqId);
      }
    } catch (error) {
      logger.error({ clientId, topic, error: error.message }, 'Failed to retrieve missing messages');
      this.send(client.ws, {
        type: WS_EVENT_TYPES.ERROR,
        message: 'Failed to retrieve missing messages',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Broadcast event to all clients subscribed to a topic
   * Enhanced with sequence numbers and DLQ integration.
   *
   * Issue #593: when a Redis Pub/Sub adapter is attached, the message is also
   * fanned out to every other backend instance so clients connected to any
   * horizontal node receive it.
   */
  async broadcast(topic, event) {
    const subscribers = this.subscriptions.get(topic);

    // Assign sequence number for this broadcast (even with zero local
    // subscribers, so the Redis fan-out still carries a seqId)
    const seqId = websocketDLQService.getNextSequenceNumber(topic);

    const message = JSON.stringify({
      type: event.type,
      topic,
      data: event.data,
      seqId,
      timestamp: new Date().toISOString(),
    });

    // Fan the broadcast out to other instances through Redis Pub/Sub. This
    // must happen even when this instance has no local subscribers, because
    // another instance might.
    if (this.redisAdapter) {
      this.redisAdapter.publish(topic, message);
    }

    if (!subscribers || subscribers.size === 0) return;

    // Store message in DLQ
    await websocketDLQService.storeMessage(topic, { type: event.type, data: event.data }, seqId);

    const failedClients = [];

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === 1) { // WebSocket.OPEN
        try {
          client.ws.send(message);
          
          // Update client's last sequence ID for this topic
          const clientSeqIds = this.clientLastSeqId.get(clientId);
          if (clientSeqIds) {
            clientSeqIds.set(topic, seqId);
          }
        } catch (error) {
          logger.error({ clientId, error: error.message }, 'Failed to send message');
          await websocketDLQService.logDeliveryFailure(topic, clientId, seqId, error);
          failedClients.push(clientId);
        }
      }
    }

    // Clean up failed clients
    failedClients.forEach(clientId => this.handleDisconnect(clientId));

    logger.debug(
      { topic, seqId, subscriberCount: subscribers.size, sentCount: subscribers.size - failedClients.length },
      'Event broadcasted with sequence number'
    );
  }

  /**
   * Deliver a broadcast that originated on another instance (received via the
   * Redis Pub/Sub adapter, Issue #593). The payload is the fully serialized
   * message produced by the origin instance, so we only forward it to local
   * subscribers — never re-publish it.
   */
  handleRemoteBroadcast(topic, message) {
    const subscribers = this.subscriptions.get(topic);
    if (!subscribers || subscribers.size === 0) return;

    let parsed = message;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (error) {
        logger.error({ error: error.message, topic }, 'Failed to parse remote WebSocket message');
        return;
      }
    }

    const failedClients = [];

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === 1) { // WebSocket.OPEN
        try {
          client.ws.send(JSON.stringify(parsed));

          // Track the origin instance's sequence number for this topic
          const clientSeqIds = this.clientLastSeqId.get(clientId);
          if (clientSeqIds && parsed.seqId != null) {
            clientSeqIds.set(topic, parsed.seqId);
          }
        } catch (error) {
          logger.error({ clientId, error: error.message }, 'Failed to send remote WebSocket message');
          failedClients.push(clientId);
        }
      }
    }

    failedClients.forEach(clientId => this.handleDisconnect(clientId));
  }

  /**
   * Attach the Redis Pub/Sub adapter for cross-instance broadcasting
   * (Issue #593). Safe to call when Redis is unavailable — the adapter
   * disables itself and the manager keeps working in single-node mode.
   *
   * @param {Object} [options] - Overrides for { redisUrl, channel, instanceId }
   * @returns {Promise<WebSocketRedisAdapter|null>}
   */
  async connectRedisAdapter(options = {}) {
    if (process.env.REDIS_DISABLE_PUBSUB === 'true') return null;
    this.redisAdapter = new WebSocketRedisAdapter(this, options);
    await this.redisAdapter.connect();
    return this.redisAdapter;
  }

  /**
   * Send message to specific client
   */
  send(ws, message) {
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to send WebSocket message');
    }
  }

  /**
   * Broadcast share purchase event
   */
  broadcastSharePurchase(contractId, buyerAddress, sharesToBuy, totalCost) {
    this.broadcast('share-purchases', {
      type: WS_EVENT_TYPES.SHARE_PURCHASED,
      data: {
        contractId,
        buyerAddress,
        sharesToBuy,
        totalCost,
      },
    });

    // Also broadcast to asset-specific topic
    this.broadcast(`asset:${contractId}`, {
      type: WS_EVENT_TYPES.SHARE_PURCHASED,
      data: {
        contractId,
        buyerAddress,
        sharesToBuy,
        totalCost,
      },
    });
  }

  /**
   * Broadcast price update event
   */
  broadcastPriceUpdate(contractId, newPrice) {
    this.broadcast(`asset:${contractId}`, {
      type: WS_EVENT_TYPES.PRICE_UPDATED,
      data: {
        contractId,
        newPrice,
      },
    });
  }

  /**
   * Broadcast availability change event
   */
  broadcastAvailabilityChange(contractId, availableShares) {
    this.broadcast(`asset:${contractId}`, {
      type: WS_EVENT_TYPES.AVAILABILITY_CHANGED,
      data: {
        contractId,
        availableShares,
      },
    });
  }

  /**
   * Broadcast asset update event
   */
  broadcastAssetUpdate(contractId, assetData) {
    this.broadcast('assets', {
      type: WS_EVENT_TYPES.ASSET_UPDATED,
      data: {
        contractId,
        asset: assetData,
      },
    });

    this.broadcast(`asset:${contractId}`, {
      type: WS_EVENT_TYPES.ASSET_UPDATED,
      data: {
        contractId,
        asset: assetData,
      },
    });
  }

  /**
   * Broadcast marketplace pause/unpause
   */
  broadcastMarketplaceStatus(isPaused) {
    const eventType = isPaused ? WS_EVENT_TYPES.MARKETPLACE_PAUSED : WS_EVENT_TYPES.MARKETPLACE_UNPAUSED;
    this.broadcast('marketplace-status', {
      type: eventType,
      data: { isPaused },
    });
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      activeTopics: this.subscriptions.size,
      totalSubscriptions: Array.from(this.subscriptions.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      redisConnected: this.redisAdapter ? this.redisAdapter.connected : false,
    };
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Close WebSocket server
   */
  async close() {
    if (this.redisAdapter) {
      await this.redisAdapter.close();
      this.redisAdapter = null;
    }
    if (this.wss) {
      this.wss.close();
      logger.info('WebSocket server closed');
    }
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();
