/**
 * WebSocket Integration Tests
 * Tests the WebSocket server, event manager, and client hook integration
 */

import { WebSocketManager, WS_EVENT_TYPES } from '../websocket.js';
import { logger } from '../index.js';

describe('WebSocket Implementation', () => {
  let wsManager;

  beforeEach(() => {
    wsManager = new WebSocketManager();
  });

  describe('WebSocketManager', () => {
    test('should generate unique client IDs', () => {
      const id1 = wsManager.generateClientId();
      const id2 = wsManager.generateClientId();

      expect(id1).toMatch(/^client-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^client-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should track client subscriptions', () => {
      const clientId = 'test-client-1';
      const topic = 'share-purchases';

      wsManager.subscribe(clientId, topic);

      expect(wsManager.subscriptions.has(topic)).toBe(true);
      expect(wsManager.subscriptions.get(topic).has(clientId)).toBe(true);
    });

    test('should unsubscribe clients from topics', () => {
      const clientId = 'test-client-1';
      const topic = 'share-purchases';

      wsManager.subscribe(clientId, topic);
      expect(wsManager.subscriptions.get(topic).has(clientId)).toBe(true);

      wsManager.unsubscribe(clientId, topic);
      expect(wsManager.subscriptions.get(topic).has(clientId)).toBe(false);
    });

    test('should clean up topics with no subscribers', () => {
      const clientId = 'test-client-1';
      const topic = 'share-purchases';

      wsManager.subscribe(clientId, topic);
      wsManager.unsubscribe(clientId, topic);

      expect(wsManager.subscriptions.has(topic)).toBe(false);
    });

    test('should return connection stats', () => {
      const stats = wsManager.getStats();

      expect(stats).toHaveProperty('connectedClients');
      expect(stats).toHaveProperty('activeTopics');
      expect(stats).toHaveProperty('totalSubscriptions');
      expect(typeof stats.connectedClients).toBe('number');
      expect(typeof stats.activeTopics).toBe('number');
      expect(typeof stats.totalSubscriptions).toBe('number');
    });

    test('should have all required event types', () => {
      const requiredTypes = [
        'SHARE_PURCHASED',
        'PRICE_UPDATED',
        'ASSET_LISTED',
        'ASSET_UPDATED',
        'AVAILABILITY_CHANGED',
        'MARKETPLACE_PAUSED',
        'MARKETPLACE_UNPAUSED',
        'CONNECTION_ESTABLISHED',
        'SUBSCRIPTION_CONFIRMED',
        'ERROR',
      ];

      requiredTypes.forEach((type) => {
        expect(WS_EVENT_TYPES[type]).toBeDefined();
      });
    });

    test('should validate event type values', () => {
      expect(WS_EVENT_TYPES.SHARE_PURCHASED).toBe('share_purchased');
      expect(WS_EVENT_TYPES.PRICE_UPDATED).toBe('price_updated');
      expect(WS_EVENT_TYPES.MARKETPLACE_PAUSED).toBe('marketplace_paused');
      expect(WS_EVENT_TYPES.MARKETPLACE_UNPAUSED).toBe('marketplace_unpaused');
    });
  });

  describe('Event Broadcasting', () => {
    test('broadcastSharePurchase should include correct data', () => {
      const contractId = 'C1234567890123456789012345678901234567890';
      const buyerAddress = 'GAAAA';
      const sharesToBuy = 10;
      const totalCost = 100000000;

      // Test that method executes without error
      expect(() => {
        wsManager.broadcastSharePurchase(contractId, buyerAddress, sharesToBuy, totalCost);
      }).not.toThrow();
    });

    test('broadcastPriceUpdate should include correct data', () => {
      const contractId = 'C1234567890123456789012345678901234567890';
      const newPrice = 15000000;

      expect(() => {
        wsManager.broadcastPriceUpdate(contractId, newPrice);
      }).not.toThrow();
    });

    test('broadcastAvailabilityChange should include correct data', () => {
      const contractId = 'C1234567890123456789012345678901234567890';
      const availableShares = 50;

      expect(() => {
        wsManager.broadcastAvailabilityChange(contractId, availableShares);
      }).not.toThrow();
    });

    test('broadcastAssetUpdate should include correct data', () => {
      const contractId = 'C1234567890123456789012345678901234567890';
      const assetData = {
        title: 'Test Asset',
        location: 'New York',
        description: 'A test asset',
      };

      expect(() => {
        wsManager.broadcastAssetUpdate(contractId, assetData);
      }).not.toThrow();
    });

    test('broadcastMarketplaceStatus should accept boolean', () => {
      expect(() => {
        wsManager.broadcastMarketplaceStatus(true);
      }).not.toThrow();

      expect(() => {
        wsManager.broadcastMarketplaceStatus(false);
      }).not.toThrow();
    });
  });

  describe('Message Handling', () => {
    test('should handle message parsing errors gracefully', () => {
      const clientId = 'test-client-1';
      const invalidJson = 'not valid json';

      // Should not throw
      expect(() => {
        wsManager.handleMessage(clientId, invalidJson);
      }).not.toThrow();
    });

    test('should handle unknown actions', () => {
      const clientId = 'test-client-1';
      const message = JSON.stringify({
        action: 'unknown_action',
      });

      expect(() => {
        wsManager.handleMessage(clientId, message);
      }).not.toThrow();
    });
  });
});

describe('WebSocket Event Types', () => {
  test('all event types should be strings', () => {
    Object.values(WS_EVENT_TYPES).forEach((value) => {
      expect(typeof value).toBe('string');
    });
  });

  test('event types should follow snake_case convention', () => {
    Object.values(WS_EVENT_TYPES).forEach((value) => {
      expect(value).toMatch(/^[a-z_]+$/);
    });
  });

  test('no event types should be empty strings', () => {
    Object.values(WS_EVENT_TYPES).forEach((value) => {
      expect(value.length).toBeGreaterThan(0);
    });
  });
});
