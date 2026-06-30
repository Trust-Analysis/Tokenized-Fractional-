/**
 * WebSocket Server and Event Manager
 * Handles real-time updates for marketplace events (share purchases, price changes, etc.)
 */

import { WebSocketServer } from 'ws';
import { logger } from './index.js';

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
 */
export class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of clientId -> { ws, subscriptions: Set }
    this.subscriptions = new Map(); // Map of topic -> Set of clientIds
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
      };

      this.clients.set(clientId, client);

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
   * Broadcast event to all clients subscribed to a topic
   */
  broadcast(topic, event) {
    const subscribers = this.subscriptions.get(topic);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify({
      type: event.type,
      topic,
      data: event.data,
      timestamp: new Date().toISOString(),
    });

    const failedClients = [];

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === 1) { // WebSocket.OPEN
        try {
          client.ws.send(message);
        } catch (error) {
          logger.error({ clientId, error: error.message }, 'Failed to send message');
          failedClients.push(clientId);
        }
      }
    }

    // Clean up failed clients
    failedClients.forEach(clientId => this.handleDisconnect(clientId));

    logger.debug(
      { topic, subscriberCount: subscribers.size, sentCount: subscribers.size - failedClients.length },
      'Event broadcasted'
    );
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
  close() {
    if (this.wss) {
      this.wss.close();
      logger.info('WebSocket server closed');
    }
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();
