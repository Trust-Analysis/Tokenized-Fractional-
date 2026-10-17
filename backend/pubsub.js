/**
 * PubSub Manager for GraphQL Subscriptions with Optimization
 * 
 * Manages real-time event broadcasting for GraphQL subscriptions with advanced optimization:
 * - Integration with optimization manager for payload filtering
 * - Rate limiting for subscription requests
 * - Lifecycle management for subscriptions
 * - Performance metrics tracking
 * - Bandwidth optimization for payloads
 */

import { EventEmitter } from 'events';
import { logger } from './index.js';
import { optimizationManager } from './subscription-optimization.js';

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
 * PubSub Manager with Optimization
 * Handles subscription registration and event publishing with optimization features
 */
class PubSubManager extends EventEmitter {
  constructor() {
    super();
    this.subscribers = new Map(); // Map of topic -> Set of subscriber callbacks
    this.subscriptionTopics = new Map(); // Map of subscriberId -> Set of topics
    this.subscriptionIds = new Map(); // Map of subscriberId -> subscriptionId mapping
    this.maxListeners = 100;
    this.setMaxListeners(this.maxListeners);
  }

  /**
   * Subscribe to an event topic with optimization
   * @param {string} topic - Event topic to subscribe to
   * @param {Function} callback - Function to call when event is published
   * @param {string} subscriberId - Unique subscriber identifier
   * @param {Object} options - Subscription options (filter, clientId)
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, callback, subscriberId = null, options = {}) {
    const { filter = null, clientId = null } = options;

    // Check rate limit
    if (clientId) {
      const subscriptionId = this.generateSubscriptionId(topic, subscriberId);
      if (!optimizationManager.rateLimiter.canSubscribe(clientId, subscriptionId)) {
        logger.warn({ clientId, topic }, 'Subscription rate limited');
        throw new Error('Subscription rate limit exceeded');
      }
    }

    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }

    const subscriptionId = this.generateSubscriptionId(topic, subscriberId);
    const subscriber = {
      id: subscriberId || Math.random().toString(36).substring(2),
      subscriptionId,
      callback,
      topic,
      subscribedAt: new Date(),
      clientId,
      filter,
    };

    this.subscribers.get(topic).add(subscriber);

    // Track topics per subscriber for cleanup
    if (subscriberId) {
      if (!this.subscriptionTopics.has(subscriberId)) {
        this.subscriptionTopics.set(subscriberId, new Set());
      }
      this.subscriptionTopics.get(subscriberId).add(topic);
      this.subscriptionIds.set(subscriberId, subscriptionId);
    }

    // Register with lifecycle manager
    if (clientId) {
      optimizationManager.lifecycleManager.register(subscriptionId, clientId, topic);
    }

    // Register payload filter if provided
    if (filter) {
      optimizationManager.payloadFilter.registerFilter(subscriptionId, filter);
    }

    logger.debug({ topic, subscriberId: subscriber.id, clientId }, 'Subscriber added to topic');

    // Record subscription metric
    optimizationManager.metricsCollector.incrementCounter('subscriptions');

    // Return unsubscribe function
    return () => this.unsubscribe(topic, subscriber.id, clientId);
  }

  /**
   * Unsubscribe from an event topic with cleanup
   * @param {string} topic - Event topic
   * @param {string} subscriberId - Subscriber ID
   * @param {string} clientId - Client ID for cleanup
   */
  unsubscribe(topic, subscriberId, clientId = null) {
    if (!this.subscribers.has(topic)) return;

    const subscribers = this.subscribers.get(topic);
    const subscriber = Array.from(subscribers).find(s => s.id === subscriberId);

    if (subscriber) {
      subscribers.delete(subscriber);
      
      // Cleanup optimization components
      if (subscriber.subscriptionId) {
        optimizationManager.payloadFilter.unregisterFilter(subscriber.subscriptionId);
        optimizationManager.lifecycleManager.unregister(subscriber.subscriptionId);
        
        if (clientId) {
          optimizationManager.rateLimiter.unsubscribe(clientId, subscriber.subscriptionId);
          optimizationManager.resumptionManager.clearState(clientId, subscriber.subscriptionId);
        }
      }
      
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

    if (this.subscriptionIds.has(subscriberId)) {
      this.subscriptionIds.delete(subscriberId);
    }

    // Record unsubscription metric
    optimizationManager.metricsCollector.incrementCounter('unsubscriptions');
  }

  /**
   * Unsubscribe a subscriber from all topics
   * @param {string} subscriberId - Subscriber ID
   * @param {string} clientId - Client ID for cleanup
   */
  unsubscribeAll(subscriberId, clientId = null) {
    if (!this.subscriptionTopics.has(subscriberId)) return;

    const topics = Array.from(this.subscriptionTopics.get(subscriberId));
    topics.forEach(topic => this.unsubscribe(topic, subscriberId, clientId));
  }

  /**
   * Publish an event to all subscribers of a topic with optimization
   * @param {string} topic - Event topic
   * @param {Object} payload - Event data
   */
  publish(topic, payload) {
    if (!this.subscribers.has(topic)) {
      logger.debug({ topic }, 'No subscribers for topic');
      return;
    }

    const subscribers = Array.from(this.subscribers.get(topic));
    
    // Start timer for performance tracking
    optimizationManager.metricsCollector.startTimer('publish_duration');
    
    logger.info(
      { topic, subscriberCount: subscribers.length, payload: JSON.stringify(payload).slice(0, 100) },
      'Publishing event to subscribers'
    );

    let successCount = 0;
    let errorCount = 0;

    subscribers.forEach(subscriber => {
      try {
        // Apply payload filter if registered
        let filteredPayload = payload;
        if (subscriber.subscriptionId) {
          filteredPayload = optimizationManager.payloadFilter.filter(
            subscriber.subscriptionId,
            payload
          );
          
          // Update subscription activity
          optimizationManager.lifecycleManager.updateActivity(subscriber.subscriptionId);
        }

        subscriber.callback(filteredPayload);
        successCount++;
      } catch (error) {
        errorCount++;
        logger.error(
          { error: error.message, subscriberId: subscriber.id, topic },
          'Error calling subscriber callback'
        );
      }
    });

    // Stop timer and record metrics
    const duration = optimizationManager.metricsCollector.stopTimer('publish_duration');
    optimizationManager.metricsCollector.recordMetric('publish_subscriber_count', subscribers.length);
    optimizationManager.metricsCollector.recordMetric('publish_success_count', successCount);
    optimizationManager.metricsCollector.recordMetric('publish_error_count', errorCount);
    
    if (duration) {
      optimizationManager.metricsCollector.recordMetric('publish_duration', duration);
    }
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
   * Get stats on subscriptions including optimization stats
   * @returns {Object} Subscription statistics
   */
  getStats() {
    const stats = {
      totalTopics: this.subscribers.size,
      totalSubscribers: 0,
      topicStats: {},
      optimization: optimizationManager.getStats(),
    };

    this.subscribers.forEach((subscribers, topic) => {
      stats.totalSubscribers += subscribers.size;
      stats.topicStats[topic] = {
        subscriberCount: subscribers.size,
        subscriptionTimes: Array.from(subscribers)
          .map(s => s.subscribedAt)
          .sort((a, b) => b - a)
          .slice(0, 5),
      };
    });

    return stats;
  }

  /**
   * Generate unique subscription ID
   * @param {string} topic - Event topic
   * @param {string} subscriberId - Subscriber ID
   * @returns {string} Unique subscription ID
   */
  generateSubscriptionId(topic, subscriberId) {
    return `${topic}-${subscriberId || Date.now()}`;
  }

  /**
   * Clear all subscriptions (for testing)
   */
  clear() {
    this.subscribers.clear();
    this.subscriptionTopics.clear();
    this.subscriptionIds.clear();
    logger.debug('All subscriptions cleared');
  }
}

// Singleton instance
export const pubsub = new PubSubManager();

// Export helper functions for common operations with optimization
export function publishSharePurchased(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'share_purchased');
  pubsub.publish(SUBSCRIPTION_EVENTS.SHARE_PURCHASED, {
    event: SUBSCRIPTION_EVENTS.SHARE_PURCHASED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishPriceUpdated(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'price_updated');
  pubsub.publish(SUBSCRIPTION_EVENTS.PRICE_UPDATED, {
    event: SUBSCRIPTION_EVENTS.PRICE_UPDATED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishAssetListed(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'asset_listed');
  pubsub.publish(SUBSCRIPTION_EVENTS.ASSET_LISTED, {
    event: SUBSCRIPTION_EVENTS.ASSET_LISTED,
    timestamp: new Date().toISOString(),
    data,
  });
}

const previousAssetStates = new Map();

export function publishAssetUpdated(data) {
  const contractId = data.contractId;
  const prevState = previousAssetStates.get(contractId) || {};
  
  const delta = { contractId };
  let hasChanges = false;
  
  // Calculate diff between previous state and current state
  for (const key of Object.keys(data)) {
    if (key === 'contractId') continue;
    
    // Simple deep comparison for changes
    if (JSON.stringify(prevState[key]) !== JSON.stringify(data[key])) {
      delta[key] = data[key];
      hasChanges = true;
    }
  }
  
  // If nothing changed, we don't broadcast
  if (!hasChanges && Object.keys(prevState).length > 0) {
    return;
  }
  
  // Update state tracking
  previousAssetStates.set(contractId, JSON.parse(JSON.stringify(data)));

  optimizationManager.metricsCollector.incrementCounter('events_published', 'asset_updated');
  pubsub.publish(SUBSCRIPTION_EVENTS.ASSET_UPDATED, {
    event: SUBSCRIPTION_EVENTS.ASSET_UPDATED,
    timestamp: new Date().toISOString(),
    data: delta,
  });
}

export function publishAvailabilityChanged(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'availability_changed');
  pubsub.publish(SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED, {
    event: SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishMarketplacePaused(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'marketplace_paused');
  pubsub.publish(SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED, {
    event: SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishMarketplaceUnpaused(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'marketplace_unpaused');
  pubsub.publish(SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED, {
    event: SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishTransactionCompleted(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'transaction_completed');
  pubsub.publish(SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED, {
    event: SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED,
    timestamp: new Date().toISOString(),
    data,
  });
}

export function publishError(data) {
  optimizationManager.metricsCollector.incrementCounter('events_published', 'error_occurred');
  pubsub.publish(SUBSCRIPTION_EVENTS.ERROR_OCCURRED, {
    event: SUBSCRIPTION_EVENTS.ERROR_OCCURRED,
    timestamp: new Date().toISOString(),
    data,
  });
}
