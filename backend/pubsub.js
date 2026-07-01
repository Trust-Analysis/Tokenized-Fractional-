/**
 * PubSub Manager for GraphQL Subscriptions
 *
 * Manages real-time event broadcasting for GraphQL subscriptions.
 * Handles subscription/unsubscription logic and event distribution to subscribers.
 */

import { EventEmitter } from 'events';
import { logger } from './index.js';

/**
 * Subscription event types
 */
export const SUBSCRIPTION_EVENTS = {
  SHARE_PURCHASED: 'share_purchased',
  PRICE_UPDATED: 'price_updated',
  ASSET_LISTED: 'asset_listed',
  ASSET_UPDATED: 'asset_updated',
  AVAILABILITY_CHANGED: 'availability_changed',
  MARKETPLACE_PAUSED: 'marketplace_paused',
  MARKETPLACE_UNPAUSED: 'marketplace_unpaused',
  TRANSACTION_COMPLETED: 'transaction_completed',
  ERROR_OCCURRED: 'error_occurred',
};

/**
 * PubSub Manager
 * Handles subscription registration and event publishing
 */
class PubSubManager extends EventEmitter {
  constructor() {
    super();
    this.subscribers = new Map(); // Map of topic -> Set of subscriber callbacks
    this.subscriptionTopics = new Map(); // Map of subscriberId -> Set of topics
    this.maxListeners = 100;
    this.setMaxListeners(this.maxListeners);
  }

  /**
   * Subscribe to an event topic
   * @param {string} topic - Event topic to subscribe to
   * @param {Function} callback - Function to call when event is published
   * @param {string} subscriberId - Unique subscriber identifier
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, callback, subscriberId = null) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }

    const subscriber = {
      id: subscriberId || Math.random().toString(36).substring(2),
      callback,
      topic,
      subscribedAt: new Date(),
    };

    this.subscribers.get(topic).add(subscriber);

    // Track topics per subscriber for cleanup
    if (subscriberId) {
      if (!this.subscriptionTopics.has(subscriberId)) {
        this.subscriptionTopics.set(subscriberId, new Set());
      }
      this.subscriptionTopics.get(subscriberId).add(topic);
    }

    logger.debug({ topic, subscriberId: subscriber.id }, 'Subscriber added to topic');

    // Return unsubscribe function
    return () => this.unsubscribe(topic, subscriber.id);
  }

  /**
   * Unsubscribe from an event topic
   * @param {string} topic - Event topic
   * @param {string} subscriberId - Subscriber ID
   */
  unsubscribe(topic, subscriberId) {
    if (!this.subscribers.has(topic)) return;

    const subscribers = this.subscribers.get(topic);
    const subscriber = Array.from(subscribers).find((s) => s.id === subscriberId);

    if (subscriber) {
      subscribers.delete(subscriber);
      logger.debug({ topic, subscriberId }, 'Subscriber removed from topic');
    }

    // Clean up topic if no subscribers
    if (subscribers.size === 0) {
      this.subscribers.delete(topic);
    }

    // Clean up subscriber tracking
    if (this.subscriptionTopics.has(subscriberId)) {
      this.subscriptionTopics.get(subscriberId).delete(topic);
      if (this.subscriptionTopics.get(subscriberId).size === 0) {
        this.subscriptionTopics.delete(subscriberId);
      }
    }
  }

  /**
   * Unsubscribe a subscriber from all topics
   * @param {string} subscriberId - Subscriber ID
   */
  unsubscribeAll(subscriberId) {
    if (!this.subscriptionTopics.has(subscriberId)) return;

    const topics = Array.from(this.subscriptionTopics.get(subscriberId));
    topics.forEach((topic) => this.unsubscribe(topic, subscriberId));
  }

  /**
   * Publish an event to all subscribers of a topic
   * @param {string} topic - Event topic
   * @param {Object} payload - Event data
   */
  publish(topic, payload) {
    if (!this.subscribers.has(topic)) {
      logger.debug({ topic }, 'No subscribers for topic');
      return;
    }

    const subscribers = Array.from(this.subscribers.get(topic));
    logger.info(
      {
        topic,
        subscriberCount: subscribers.length,
        payload: JSON.stringify(payload).slice(0, 100),
      },
      'Publishing event to subscribers',
    );

    subscribers.forEach((subscriber) => {
      try {
        subscriber.callback(payload);
      } catch (error) {
        logger.error(
          { error: error.message, subscriberId: subscriber.id, topic },
          'Error calling subscriber callback',
        );
      }
    });
  }

  /**
   * Get subscriber count for a topic
   * @param {string} topic - Event topic
   * @returns {number} Number of subscribers
   */
  getSubscriberCount(topic) {
    return this.subscribers.has(topic) ? this.subscribers.get(topic).size : 0;
  }

  /**
   * Get all active topics
   * @returns {string[]} Array of topic names
   */
  getActiveTopics() {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Get stats on subscriptions
   * @returns {Object} Subscription statistics
   */
  getStats() {
    const stats = {
      totalTopics: this.subscribers.size,
      totalSubscribers: 0,
      topicStats: {},
    };

    this.subscribers.forEach((subscribers, topic) => {
      stats.totalSubscribers += subscribers.size;
      stats.topicStats[topic] = {
        subscriberCount: subscribers.size,
        subscriptionTimes: Array.from(subscribers)
          .map((s) => s.subscribedAt)
          .sort((a, b) => b - a)
          .slice(0, 5),
      };
    });

    return stats;
  }

  /**
   * Clear all subscriptions (for testing)
   */
  clear() {
    this.subscribers.clear();
    this.subscriptionTopics.clear();
    logger.debug('All subscriptions cleared');
  }
}

// Singleton instance
export const pubsub = new PubSubManager();

// Export helper functions for common operations
export function publishSharePurchased(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.SHARE_PURCHASED, {
    event: SUBSCRIPTION_EVENTS.SHARE_PURCHASED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishPriceUpdated(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.PRICE_UPDATED, {
    event: SUBSCRIPTION_EVENTS.PRICE_UPDATED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishAssetListed(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.ASSET_LISTED, {
    event: SUBSCRIPTION_EVENTS.ASSET_LISTED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishAssetUpdated(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.ASSET_UPDATED, {
    event: SUBSCRIPTION_EVENTS.ASSET_UPDATED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishAvailabilityChanged(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED, {
    event: SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishMarketplacePaused(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED, {
    event: SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishMarketplaceUnpaused(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED, {
    event: SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishTransactionCompleted(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED, {
    event: SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishError(data) {
  pubsub.publish(SUBSCRIPTION_EVENTS.ERROR_OCCURRED, {
    event: SUBSCRIPTION_EVENTS.ERROR_OCCURRED,
    timestamp: new Date().toISOString(),
    data,
  });
}
