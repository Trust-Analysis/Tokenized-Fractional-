// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/websocketDLQService.js — Dead Letter Queue for WebSocket broadcasts.
 *
 * Provides Redis-backed message buffering with sequence numbers to ensure delivery
 * guarantees for WebSocket broadcasts. Handles message recovery for reconnection scenarios.
 *
 * Retention policy (issue #902) — see docs/WEBSOCKET_DLQ.md:
 *   - Size: at most `bufferSize` messages per channel (WS_DLQ_BUFFER_SIZE,
 *     default 1000). Storing message N+1 drops the lowest seqId.
 *   - Age: messages older than `ttl` seconds (WS_DLQ_TTL_SECONDS, default
 *     86400) are never replayed and are pruned on the next write. In Redis the
 *     whole channel key also expires `ttl` seconds after its last write.
 *   - Failure log: the last 1000 delivery failures, same TTL.
 * A reconnecting client whose gap reaches past either bound gets only the
 * messages still retained and must refetch current state.
 *
 * Alerting: `getStats()` (scraped via the `websocket_dlq_*` Prometheus gauges)
 * flags `overThreshold` and logs a warning once when the total buffered count
 * crosses `alertThreshold` (WS_DLQ_ALERT_THRESHOLD, default 10000).
 */

import Redis from 'ioredis';

const FAILURE_LOG_LIMIT = 1000;

function envInt(name) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Dead Letter Queue Service for WebSocket message reliability
 */
export class WebSocketDLQService {
  constructor(options = {}) {
    this.redisUrl = options.redisUrl !== undefined ? options.redisUrl : process.env.REDIS_URL;
    this.bufferSize = options.bufferSize || envInt('WS_DLQ_BUFFER_SIZE') || 1000; // Last N messages per channel
    this.ttl = options.ttl || envInt('WS_DLQ_TTL_SECONDS') || 86400; // 24 hours default TTL
    this.alertThreshold = options.alertThreshold || envInt('WS_DLQ_ALERT_THRESHOLD') || 10000;
    this.logger = options.logger || console;
    this.now = options.now || (() => Date.now());
    this.redis = null;
    this.sequenceNumbers = new Map(); // In-memory sequence tracking per channel
    this.memoryBuffers = new Map(); // channel -> messages (in-memory fallback)
    this.memoryFailures = []; // delivery failures (in-memory fallback)
    this.droppedMessages = { size: 0, age: 0 };
    this._overThreshold = false;
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

  /** True when a stored message is past the retention window. */
  _isExpired(messageData) {
    return this.now() - Date.parse(messageData.timestamp) > this.ttl * 1000;
  }

  /**
   * Store message in DLQ buffer
   */
  async storeMessage(channel, message, seqId) {
    const messageData = {
      seqId,
      channel,
      message,
      timestamp: new Date(this.now()).toISOString(),
    };

    if (this.redis) {
      try {
        const key = `ws:dlq:${channel}`;
        const field = `msg:${seqId}`;

        // Store message as hash
        await this.redis.hset(key, field, JSON.stringify(messageData));

        // Maintain buffer size by removing the lowest seqIds. HKEYS order is
        // not insertion order once the hash leaves listpack encoding, so sort.
        const fields = await this.redis.hkeys(key);
        if (fields.length > this.bufferSize) {
          const toRemove = fields
            .sort((a, b) => parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10))
            .slice(0, fields.length - this.bufferSize);
          await this.redis.hdel(key, ...toRemove);
          this.droppedMessages.size += toRemove.length;
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
    const buffer = this.memoryBuffers.get(channel) || [];
    buffer.push(messageData);

    // Maintain retention: age first, then size
    while (buffer.length > 0 && this._isExpired(buffer[0])) {
      buffer.shift();
      this.droppedMessages.age++;
    }
    if (buffer.length > this.bufferSize) {
      const excess = buffer.length - this.bufferSize;
      buffer.splice(0, excess);
      this.droppedMessages.size += excess;
    }
    this.memoryBuffers.set(channel, buffer);

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
            const parsed = JSON.parse(data);
            if (!this._isExpired(parsed)) messages.push(parsed);
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
    const buffer = this.memoryBuffers.get(channel) || [];
    return buffer.filter(
      (msg) => msg.seqId >= fromSeqId && msg.seqId <= toSeqId && !this._isExpired(msg),
    );
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
    const buffer = this.memoryBuffers.get(channel) || [];
    const bufferedMax = buffer.reduce((max, msg) => Math.max(max, msg.seqId), 0);
    return Math.max(bufferedMax, this.sequenceNumbers.get(channel) || 0);
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
      timestamp: new Date(this.now()).toISOString(),
    };

    if (this.redis) {
      try {
        const key = `ws:dlq:failures`;
        await this.redis.rpush(key, JSON.stringify(failureData));

        // Keep only last 1000 failures
        await this.redis.ltrim(key, -FAILURE_LOG_LIMIT, -1);
        await this.redis.expire(key, this.ttl);

        this.logger.warn({ channel, clientId, seqId }, 'Broadcast delivery failure logged');
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to log delivery failure');
      }
    } else {
      this.memoryFailures.push(failureData);
      if (this.memoryFailures.length > FAILURE_LOG_LIMIT) {
        this.memoryFailures.splice(0, this.memoryFailures.length - FAILURE_LOG_LIMIT);
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

    return this.memoryFailures.slice(-limit);
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
    this.memoryBuffers.delete(channel);
    this.sequenceNumbers.delete(channel);
  }

  /**
   * Get DLQ statistics. Also evaluates the size alert threshold, logging a
   * warning when the total buffered count first crosses it (issue #902).
   */
  async getStats() {
    const stats = {
      channels: 0,
      totalMessages: 0,
      largestChannel: 0,
      recentFailures: 0,
      droppedMessages: { ...this.droppedMessages },
      alertThreshold: this.alertThreshold,
      overThreshold: false,
      redisConnected: this.redis !== null,
    };

    if (this.redis) {
      try {
        // SCAN rather than KEYS: this runs on every /metrics scrape.
        const keys = [];
        let cursor = '0';
        do {
          const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'ws:dlq:*', 'COUNT', 100);
          cursor = next;
          keys.push(...batch);
        } while (cursor !== '0');

        for (const key of keys) {
          if (key === 'ws:dlq:failures') {
            stats.recentFailures = await this.redis.llen(key);
          } else {
            const count = await this.redis.hlen(key);
            stats.totalMessages += count;
            stats.largestChannel = Math.max(stats.largestChannel, count);
            stats.channels++;
          }
        }
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to get DLQ stats');
      }
    } else {
      // In-memory stats
      for (const buffer of this.memoryBuffers.values()) {
        stats.totalMessages += buffer.length;
        stats.largestChannel = Math.max(stats.largestChannel, buffer.length);
        stats.channels++;
      }
      stats.recentFailures = this.memoryFailures.length;
    }

    stats.overThreshold = stats.totalMessages >= this.alertThreshold;
    if (stats.overThreshold && !this._overThreshold) {
      this.logger.warn(
        { totalMessages: stats.totalMessages, threshold: this.alertThreshold, channels: stats.channels },
        'WebSocket DLQ size exceeded alert threshold — many clients may be failing to reconnect',
      );
    }
    this._overThreshold = stats.overThreshold;

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
