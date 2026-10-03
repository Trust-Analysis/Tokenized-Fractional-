// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/websocketDLQService.js — Dead Letter Queue for WebSocket broadcasts.
 *
 * Provides Redis-backed message buffering with sequence numbers to ensure delivery
 * guarantees for WebSocket broadcasts. Handles message recovery for reconnection scenarios.
 */

import Redis from 'ioredis';

/**
 * Dead Letter Queue Service for WebSocket message reliability
 */
export class WebSocketDLQService {
  constructor(options = {}) {
    this.redisUrl = options.redisUrl || process.env.REDIS_URL;
    this.bufferSize = options.bufferSize || 1000; // Last N messages per channel
    this.ttl = options.ttl || 86400; // 24 hours default TTL
    this.logger = options.logger || console;
    this.redis = null;
    this.sequenceNumbers = new Map(); // In-memory sequence tracking per channel
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    if (!this.redisUrl) {
      this.logger.warn('No REDIS_URL configured, DLQ service running in memory-only mode');
      return false;
    }

    try {
      this.redis = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 3,
      });

      await this.redis.connect();
      this.logger.info('WebSocket DLQ service initialized with Redis');
      return true;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to connect to Redis for DLQ');
      this.redis = null;
      return false;
    }
  }

  /**
   * Get next sequence number for a channel
   */
  getNextSequenceNumber(channel) {
    const current = this.sequenceNumbers.get(channel) || 0;
    const next = current + 1;
    this.sequenceNumbers.set(channel, next);
    return next;
  }

  /**
   * Store message in DLQ buffer
   */
  async storeMessage(channel, message, seqId) {
    const messageData = {
      seqId,
      channel,
      message,
      timestamp: new Date().toISOString(),
    };

    if (this.redis) {
      try {
        const key = `ws:dlq:${channel}`;
        const field = `msg:${seqId}`;
        
        // Store message as hash
        await this.redis.hset(key, field, JSON.stringify(messageData));
        
        // Maintain buffer size by removing old messages
        const fields = await this.redis.hkeys(key);
        if (fields.length > this.bufferSize) {
          const toRemove = fields.slice(0, fields.length - this.bufferSize);
          await this.redis.hdel(key, ...toRemove);
        }

        // Set TTL on the key
        await this.redis.expire(key, this.ttl);

        this.logger.debug({ channel, seqId }, 'Message stored in DLQ');
        return true;
      } catch (error) {
        this.logger.error({ error: error.message, channel, seqId }, 'Failed to store message in DLQ');
        return false;
      }
    }

    // Fallback to in-memory storage
    const memoryKey = `memory:${channel}`;
    if (!this.sequenceNumbers.has(memoryKey)) {
      this.sequenceNumbers.set(memoryKey, []);
    }
    const buffer = this.sequenceNumbers.get(memoryKey);
    buffer.push(messageData);
    
    // Maintain buffer size
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }

    return true;
  }

  /**
   * Get messages from a specific sequence range
   */
  async getMessagesInRange(channel, fromSeqId, toSeqId) {
    if (this.redis) {
      try {
        const key = `ws:dlq:${channel}`;
        const messages = [];

        for (let seqId = fromSeqId; seqId <= toSeqId; seqId++) {
          const field = `msg:${seqId}`;
          const data = await this.redis.hget(key, field);
          if (data) {
            messages.push(JSON.parse(data));
          }
        }

        this.logger.debug({ channel, fromSeqId, toSeqId, count: messages.length }, 'Retrieved messages from DLQ');
        return messages;
      } catch (error) {
        this.logger.error({ error: error.message, channel }, 'Failed to retrieve messages from DLQ');
        return [];
      }
    }

    // Fallback to in-memory storage
    const memoryKey = `memory:${channel}`;
    const buffer = this.sequenceNumbers.get(memoryKey) || [];
    return buffer.filter(msg => msg.seqId >= fromSeqId && msg.seqId <= toSeqId);
  }

  /**
   * Get latest sequence number for a channel
   */
  async getLatestSequenceNumber(channel) {
    if (this.redis) {
      try {
        const key = `ws:dlq:${channel}`;
        const fields = await this.redis.hkeys(key);
        
        if (fields.length === 0) return 0;

        // Extract sequence numbers from field names
        const seqIds = fields
          .map(field => {
            const match = field.match(/msg:(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(id => id > 0);

        return Math.max(...seqIds);
      } catch (error) {
        this.logger.error({ error: error.message, channel }, 'Failed to get latest sequence number');
        return 0;
      }
    }

    // Fallback to in-memory
    return this.sequenceNumbers.get(channel) || 0;
  }

  /**
   * Log broadcast delivery failure
   */
  async logDeliveryFailure(channel, clientId, seqId, error) {
    const failureData = {
      channel,
      clientId,
      seqId,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    if (this.redis) {
      try {
        const key = `ws:dlq:failures`;
        await this.redis.rpush(key, JSON.stringify(failureData));
        
        // Keep only last 1000 failures
        await this.redis.ltrim(key, -1000, -1);
        await this.redis.expire(key, this.ttl);

        this.logger.warn({ channel, clientId, seqId }, 'Broadcast delivery failure logged');
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to log delivery failure');
      }
    }

    this.logger.error({ channel, clientId, seqId, error: error.message }, 'Broadcast delivery failure');
  }

  /**
   * Get recent delivery failures for monitoring
   */
  async getRecentFailures(limit = 100) {
    if (this.redis) {
      try {
        const key = `ws:dlq:failures`;
        const failures = await this.redis.lrange(key, -limit, -1);
        return failures.map(f => JSON.parse(f));
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to get recent failures');
        return [];
      }
    }

    return [];
  }

  /**
   * Clear old messages from a channel
   */
  async clearChannel(channel) {
    if (this.redis) {
      try {
        const key = `ws:dlq:${channel}`;
        await this.redis.del(key);
        this.logger.info({ channel }, 'Cleared DLQ channel');
      } catch (error) {
        this.logger.error({ error: error.message, channel }, 'Failed to clear channel');
      }
    }

    // Clear in-memory buffer
    const memoryKey = `memory:${channel}`;
    this.sequenceNumbers.delete(memoryKey);
    this.sequenceNumbers.delete(channel);
  }

  /**
   * Get DLQ statistics
   */
  async getStats() {
    const stats = {
      channels: 0,
      totalMessages: 0,
      recentFailures: 0,
      redisConnected: this.redis !== null,
    };

    if (this.redis) {
      try {
        const pattern = 'ws:dlq:*';
        const keys = await this.redis.keys(pattern);
        
        for (const key of keys) {
          if (key.includes(':failures')) {
            stats.recentFailures = await this.redis.llen(key);
          } else {
            const count = await this.redis.hlen(key);
            stats.totalMessages += count;
            stats.channels++;
          }
        }
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to get DLQ stats');
      }
    } else {
      // In-memory stats
      for (const [key] of this.sequenceNumbers) {
        if (key.startsWith('memory:')) {
          const buffer = this.sequenceNumbers.get(key);
          stats.totalMessages += buffer.length;
          stats.channels++;
        }
      }
    }

    return stats;
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.logger.info('WebSocket DLQ service closed');
    }
  }
}

/**
 * Singleton instance
 */
export const websocketDLQService = new WebSocketDLQService();
