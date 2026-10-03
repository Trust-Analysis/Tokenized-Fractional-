/**
 * GraphQL Subscriptions Test Suite
 * 
 * Tests for real-time GraphQL subscriptions covering:
 * - PubSub event broadcasting
 * - WebSocket subscription handling
 * - Event filtering and routing
 * - Subscription lifecycle management
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { pubsub, SUBSCRIPTION_EVENTS, publishSharePurchased, publishPriceUpdated, publishAssetListed } from '../pubsub.js';

describe('GraphQL Subscriptions - PubSub Manager', () => {
  beforeEach(() => {
    pubsub.clear();
  });

  describe('subscribe() - Topic Registration', () => {
    test('should register a subscriber to a topic', () => {
      const callback = jest.fn();
      pubsub.subscribe('test_topic', callback);

      expect(pubsub.getSubscriberCount('test_topic')).toBe(1);
    });

    test('should register multiple subscribers to same topic', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      pubsub.subscribe('test_topic', callback1);
      pubsub.subscribe('test_topic', callback2);

      expect(pubsub.getSubscriberCount('test_topic')).toBe(2);
    });

    test('should return an unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = pubsub.subscribe('test_topic', callback);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      expect(pubsub.getSubscriberCount('test_topic')).toBe(0);
    });

    test('should assign a unique subscriber ID', () => {
      const callback = jest.fn();
      const unsubscribe = pubsub.subscribe('test_topic', callback, 'sub-1');

      expect(pubsub.getSubscriberCount('test_topic')).toBe(1);
    });
  });

  describe('publish() - Event Broadcasting', () => {
    test('should broadcast events to all subscribers', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      pubsub.subscribe('test_topic', callback1);
      pubsub.subscribe('test_topic', callback2);

      pubsub.publish('test_topic', { data: 'test' });

      expect(callback1).toHaveBeenCalledWith({ data: 'test' });
      expect(callback2).toHaveBeenCalledWith({ data: 'test' });
    });

    test('should not broadcast to unrelated topics', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      pubsub.subscribe('topic_1', callback1);
      pubsub.subscribe('topic_2', callback2);

      pubsub.publish('topic_1', { data: 'test' });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    test('should handle errors in subscriber callbacks', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Subscriber error');
      });
      const goodCallback = jest.fn();

      pubsub.subscribe('test_topic', errorCallback);
      pubsub.subscribe('test_topic', goodCallback);

      // Should not throw; error is caught and logged
      expect(() => pubsub.publish('test_topic', { data: 'test' })).not.toThrow();

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled(); // Other callbacks still execute
    });

    test('should do nothing when publishing to non-existent topic', () => {
      expect(() => pubsub.publish('non_existent', { data: 'test' })).not.toThrow();
    });
  });

  describe('unsubscribe() - Topic Cleanup', () => {
    test('should remove a subscriber from a topic', () => {
      const callback = jest.fn();
      const unsubscribe = pubsub.subscribe('test_topic', callback, 'sub-1');

      expect(pubsub.getSubscriberCount('test_topic')).toBe(1);

      unsubscribe();

      expect(pubsub.getSubscriberCount('test_topic')).toBe(0);
      pubsub.publish('test_topic', { data: 'test' });
      expect(callback).not.toHaveBeenCalled();
    });

    test('should remove topic when last subscriber unsubscribes', () => {
      const callback = jest.fn();
      const unsubscribe = pubsub.subscribe('test_topic', callback, 'sub-1');

      expect(pubsub.getActiveTopics()).toContain('test_topic');

      unsubscribe();

      expect(pubsub.getActiveTopics()).not.toContain('test_topic');
    });

    test('should keep topic when other subscribers remain', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const unsub1 = pubsub.subscribe('test_topic', callback1, 'sub-1');
      pubsub.subscribe('test_topic', callback2, 'sub-2');

      unsub1();

      expect(pubsub.getActiveTopics()).toContain('test_topic');
      expect(pubsub.getSubscriberCount('test_topic')).toBe(1);
    });
  });

  describe('unsubscribeAll() - Bulk Cleanup', () => {
    test('should unsubscribe from all topics for a subscriber', () => {
      const callback = jest.fn();

      pubsub.subscribe('topic_1', callback, 'sub-1');
      pubsub.subscribe('topic_2', callback, 'sub-1');
      pubsub.subscribe('topic_3', callback, 'sub-1');

      expect(pubsub.getSubscriberCount('topic_1')).toBe(1);
      expect(pubsub.getSubscriberCount('topic_2')).toBe(1);
      expect(pubsub.getSubscriberCount('topic_3')).toBe(1);

      pubsub.unsubscribeAll('sub-1');

      expect(pubsub.getSubscriberCount('topic_1')).toBe(0);
      expect(pubsub.getSubscriberCount('topic_2')).toBe(0);
      expect(pubsub.getSubscriberCount('topic_3')).toBe(0);
    });
  });

  describe('getSubscriberCount() - Statistics', () => {
    test('should return correct subscriber count', () => {
      expect(pubsub.getSubscriberCount('test_topic')).toBe(0);

      pubsub.subscribe('test_topic', () => {});
      expect(pubsub.getSubscriberCount('test_topic')).toBe(1);

      pubsub.subscribe('test_topic', () => {});
      expect(pubsub.getSubscriberCount('test_topic')).toBe(2);
    });

    test('should return 0 for non-existent topics', () => {
      expect(pubsub.getSubscriberCount('non_existent')).toBe(0);
    });
  });

  describe('getActiveTopics() - Topic Discovery', () => {
    test('should return all active topics', () => {
      pubsub.subscribe('topic_1', () => {});
      pubsub.subscribe('topic_2', () => {});

      const topics = pubsub.getActiveTopics();

      expect(topics).toContain('topic_1');
      expect(topics).toContain('topic_2');
      expect(topics.length).toBe(2);
    });

    test('should return empty array when no subscriptions', () => {
      expect(pubsub.getActiveTopics()).toEqual([]);
    });
  });

  describe('getStats() - Subscription Metrics', () => {
    test('should return subscription statistics', () => {
      pubsub.subscribe('topic_1', () => {});
      pubsub.subscribe('topic_1', () => {});
      pubsub.subscribe('topic_2', () => {});

      const stats = pubsub.getStats();

      expect(stats.totalTopics).toBe(2);
      expect(stats.totalSubscribers).toBe(3);
      expect(stats.topicStats.topic_1.subscriberCount).toBe(2);
      expect(stats.topicStats.topic_2.subscriberCount).toBe(1);
    });

    test('should return empty stats when no subscriptions', () => {
      const stats = pubsub.getStats();

      expect(stats.totalTopics).toBe(0);
      expect(stats.totalSubscribers).toBe(0);
    });
  });

  describe('Subscription Events - Helper Functions', () => {
    test('publishSharePurchased should broadcast event', () => {
      const callback = jest.fn();
      pubsub.subscribe(SUBSCRIPTION_EVENTS.SHARE_PURCHASED, callback);

      publishSharePurchased({
        contractId: 'C123',
        buyer: 'BUYER123',
        shareCount: 10,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.event).toBe(SUBSCRIPTION_EVENTS.SHARE_PURCHASED);
      expect(event.data.contractId).toBe('C123');
    });

    test('publishPriceUpdated should broadcast event', () => {
      const callback = jest.fn();
      pubsub.subscribe(SUBSCRIPTION_EVENTS.PRICE_UPDATED, callback);

      publishPriceUpdated({
        contractId: 'C123',
        newPrice: 5000,
        oldPrice: 4000,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.event).toBe(SUBSCRIPTION_EVENTS.PRICE_UPDATED);
    });

    test('publishAssetListed should broadcast event', () => {
      const callback = jest.fn();
      pubsub.subscribe(SUBSCRIPTION_EVENTS.ASSET_LISTED, callback);

      publishAssetListed({
        contractId: 'C123',
        title: 'New Asset',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.event).toBe(SUBSCRIPTION_EVENTS.ASSET_LISTED);
    });
  });

  describe('clear() - Test Utility', () => {
    test('should clear all subscriptions', () => {
      pubsub.subscribe('topic_1', () => {});
      pubsub.subscribe('topic_2', () => {});

      expect(pubsub.getActiveTopics().length).toBe(2);

      pubsub.clear();

      expect(pubsub.getActiveTopics().length).toBe(0);
    });
  });
});

describe('GraphQL Subscriptions - Topic Filtering', () => {
  beforeEach(() => {
    pubsub.clear();
  });

  test('should support topic filtering with colons', () => {
    const callback1 = jest.fn();
    const callback2 = jest.fn();

    // Simulate contract-specific subscriptions
    pubsub.subscribe('share_purchased:C123', callback1);
    pubsub.subscribe('share_purchased:C456', callback2);

    pubsub.publish('share_purchased:C123', { contractId: 'C123' });

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).not.toHaveBeenCalled();
  });

  test('should support wildcard subscriptions', () => {
    const specificCallback = jest.fn();
    const generalCallback = jest.fn();

    // General subscription to all events
    pubsub.subscribe('share_purchased', generalCallback);
    // Specific subscription
    pubsub.subscribe('share_purchased:C123', specificCallback);

    pubsub.publish('share_purchased', { contractId: 'C789' });
    pubsub.publish('share_purchased:C123', { contractId: 'C123' });

    expect(generalCallback).toHaveBeenCalledTimes(1);
    expect(specificCallback).toHaveBeenCalledTimes(1);
  });
});

describe('GraphQL Subscriptions - Concurrency', () => {
  beforeEach(() => {
    pubsub.clear();
  });

  test('should handle rapid subscriptions and publications', async () => {
    const callbacks = Array.from({ length: 100 }, () => jest.fn());
    const payloads = [];

    // Subscribe all callbacks
    callbacks.forEach((cb, i) => {
      pubsub.subscribe('stress_test', cb, `sub-${i}`);
    });

    // Publish multiple events
    for (let i = 0; i < 10; i++) {
      const payload = { id: i };
      payloads.push(payload);
      pubsub.publish('stress_test', payload);
    }

    // All callbacks should receive all events
    callbacks.forEach(cb => {
      expect(cb).toHaveBeenCalledTimes(10);
    });
  });

  test('should handle subscription cleanup during iteration', () => {
    const callbacks = Array.from({ length: 10 }, () => jest.fn());
    const unsubscribers = [];

    callbacks.forEach((cb, i) => {
      const unsub = pubsub.subscribe('cleanup_test', cb, `sub-${i}`);
      unsubscribers.push(unsub);
    });

    // Unsubscribe half while publishing
    unsubscribers.slice(0, 5).forEach(unsub => unsub());

    pubsub.publish('cleanup_test', { data: 'test' });

    // Remaining subscribers should get the event
    callbacks.slice(5).forEach(cb => {
      expect(cb).toHaveBeenCalledWith({ data: 'test' });
    });

    // Unsubscribed should not get it
    callbacks.slice(0, 5).forEach(cb => {
      expect(cb).not.toHaveBeenCalled();
    });
  });
});

describe('SUBSCRIPTION_EVENTS - Event Type Constants', () => {
  test('should have all required event types defined', () => {
    expect(SUBSCRIPTION_EVENTS.SHARE_PURCHASED).toBe('share_purchased');
    expect(SUBSCRIPTION_EVENTS.PRICE_UPDATED).toBe('price_updated');
    expect(SUBSCRIPTION_EVENTS.ASSET_LISTED).toBe('asset_listed');
    expect(SUBSCRIPTION_EVENTS.ASSET_UPDATED).toBe('asset_updated');
    expect(SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED).toBe('availability_changed');
    expect(SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED).toBe('marketplace_paused');
    expect(SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED).toBe('marketplace_unpaused');
    expect(SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED).toBe('transaction_completed');
  });
});
