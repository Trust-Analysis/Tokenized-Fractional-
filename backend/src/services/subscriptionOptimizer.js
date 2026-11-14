/**
 * GraphQL Subscription Optimizer
 *
 * Implements payload batching, connection timeout, and memory cleanup
 * for real-time price update subscriptions.
 */

class SubscriptionOptimizer {
  constructor(options = {}) {
    this.batchInterval = options.batchInterval || 100;
    this.batchSize = options.batchSize || 50;
    this.idleTimeout = options.idleTimeout || 300000;
    this.maxMemoryMB = options.maxMemoryMB || 512;

    this.subscribers = new Map();
    this.pendingPayloads = new Map();
    this.batchTimers = new Map();
    this.lastActivity = new Map();
    this._cleanupTimer = null;
    this._stats = {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      batchesSent: 0,
      payloadsBatched: 0,
      idleDisconnected: 0,
      memoryCleanups: 0,
    };
  }

  subscribe(subscriberId, callback, options = {}) {
    this.subscribers.set(subscriberId, {
      callback,
      topics: options.topics || [],
      createdAt: Date.now(),
    });
    this.lastActivity.set(subscriberId, Date.now());
    this.pendingPayloads.set(subscriberId, []);
    this._stats.totalSubscriptions++;
    this._stats.activeSubscriptions = this.subscribers.size;
  }

  unsubscribe(subscriberId) {
    this.subscribers.delete(subscriberId);
    this.pendingPayloads.delete(subscriberId);
    this.lastActivity.delete(subscriberId);
    if (this.batchTimers.has(subscriberId)) {
      clearTimeout(this.batchTimers.get(subscriberId));
      this.batchTimers.delete(subscriberId);
    }
    this._stats.activeSubscriptions = this.subscribers.size;
  }

  publish(subscriberId, payload) {
    if (!this.subscribers.has(subscriberId)) return;

    this.lastActivity.set(subscriberId, Date.now());
    const pending = this.pendingPayloads.get(subscriberId) || [];
    pending.push(payload);
    this.pendingPayloads.set(subscriberId, pending);
    this._stats.payloadsBatched++;

    if (pending.length >= this.batchSize) {
      this._flushBatch(subscriberId);
    } else if (!this.batchTimers.has(subscriberId)) {
      this.batchTimers.set(subscriberId, setTimeout(() => {
        this._flushBatch(subscriberId);
      }, this.batchInterval));
    }
  }

  _flushBatch(subscriberId) {
    const pending = this.pendingPayloads.get(subscriberId) || [];
    if (pending.length === 0) return;

    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return;

    const batch = pending.splice(0, this.batchSize);
    this.pendingPayloads.set(subscriberId, pending);
    this.batchTimers.delete(subscriberId);

    try {
      subscriber.callback(batch.length === 1 ? batch[0] : { batch });
      this._stats.batchesSent++;
    } catch (err) {
      console.error(`Subscription batch error for ${subscriberId}:`, err);
    }

    if (pending.length > 0) {
      this.batchTimers.set(subscriberId, setTimeout(() => {
        this._flushBatch(subscriberId);
      }, this.batchInterval));
    }
  }

  startIdleCleanup() {
    this._cleanupTimer = setInterval(() => this._cleanupIdle(), 60000);
  }

  stopIdleCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  _cleanupIdle() {
    const now = Date.now();
    for (const [id, lastActive] of this.lastActivity) {
      if (now - lastActive > this.idleTimeout) {
        this.unsubscribe(id);
        this._stats.idleDisconnected++;
      }
    }
    this._checkMemory();
  }

  _checkMemory() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memMB = process.memoryUsage().heapUsed / 1024 / 1024;
      if (memMB > this.maxMemoryMB) {
        this._stats.memoryCleanups++;
        const oldest = [...this.lastActivity.entries()]
          .sort((a, b) => a[1] - b[1])
          .slice(0, Math.ceil(this.subscribers.size * 0.2));
        for (const [id] of oldest) {
          this.unsubscribe(id);
        }
      }
    }
  }

  getStats() {
    return {
      ...this._stats,
      activeSubscriptions: this.subscribers.size,
      memoryMB: typeof process !== 'undefined' && process.memoryUsage
        ? Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        : 0,
    };
  }

  destroy() {
    this.stopIdleCleanup();
    for (const [id] of this.subscribers) {
      this.unsubscribe(id);
    }
  }
}

module.exports = { SubscriptionOptimizer };
