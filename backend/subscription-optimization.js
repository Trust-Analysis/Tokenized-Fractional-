/**
 * GraphQL WebSocket Subscription Optimization Layer
 * 
 * Provides advanced features for WebSocket subscription optimization:
 * - Connection pooling for efficient resource management
 * - Exponential backoff reconnection strategy
 * - Payload filtering and bandwidth optimization
 * - Connection health monitoring and heartbeat system
 * - Subscription rate limiting
 * - Efficient data serialization
 * - Subscription lifecycle management
 * - Subscription resumption after connection drops
 * - Performance monitoring and metrics
 */

import { logger } from './index.js';

/**
 * Configuration for subscription optimization
 */
const OPTIMIZATION_CONFIG = {
  // Connection pooling
  maxConnectionsPerClient: 5,
  connectionPoolSize: 100,
  connectionIdleTimeout: 300000, // 5 minutes
  
  // Reconnection strategy
  maxReconnectAttempts: 10,
  initialReconnectDelay: 1000, // 1 second
  maxReconnectDelay: 30000, // 30 seconds
  reconnectBackoffMultiplier: 2,
  
  // Health monitoring
  heartbeatInterval: 30000, // 30 seconds
  heartbeatTimeout: 10000, // 10 seconds
  healthCheckInterval: 60000, // 1 minute
  
  // Rate limiting
  maxSubscriptionsPerClient: 50,
  subscriptionRateLimitWindow: 60000, // 1 minute
  maxSubscriptionsPerWindow: 100,
  
  // Payload optimization
  enableCompression: true,
  compressionThreshold: 1024, // 1KB
  enableBinarySerialization: true,
  
  // Lifecycle management
  abandonedSubscriptionTimeout: 300000, // 5 minutes
  cleanupInterval: 120000, // 2 minutes
  
  // Metrics
  metricsRetentionPeriod: 3600000, // 1 hour
};

/**
 * Connection Pool Manager
 * Manages WebSocket connections efficiently with pooling
 */
class ConnectionPool {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.connections = new Map(); // clientId -> connection info
    this.pool = new Map(); // poolId -> connection
    this.idleConnections = new Set();
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      reusedConnections: 0,
    };
  }

  /**
   * Acquire a connection from the pool or create new one
   */
  acquire(clientId, connectionFactory) {
    // Check if client already has active connections
    const clientConnections = this.getClientConnections(clientId);
    if (clientConnections.length >= this.config.maxConnectionsPerClient) {
      throw new Error(`Max connections per client exceeded: ${this.config.maxConnectionsPerClient}`);
    }

    // Try to reuse idle connection
    if (this.idleConnections.size > 0) {
      const poolId = this.idleConnections.values().next().value;
      const connection = this.pool.get(poolId);
      
      if (connection && this.isConnectionHealthy(connection)) {
        this.idleConnections.delete(poolId);
        this.associateConnection(clientId, poolId, connection);
        this.stats.reusedConnections++;
        this.stats.activeConnections++;
        this.stats.idleConnections--;
        logger.debug({ clientId, poolId }, 'Reusing idle connection from pool');
        return connection;
      }
    }

    // Create new connection if pool not full
    if (this.pool.size >= this.config.connectionPoolSize) {
      throw new Error('Connection pool exhausted');
    }

    const connection = connectionFactory();
    const poolId = this.generatePoolId();
    
    this.pool.set(poolId, connection);
    this.associateConnection(clientId, poolId, connection);
    
    this.stats.totalConnections++;
    this.stats.activeConnections++;
    
    logger.debug({ clientId, poolId }, 'Created new connection');
    return connection;
  }

  /**
   * Release connection back to pool
   */
  release(clientId, poolId) {
    const connection = this.pool.get(poolId);
    if (!connection) return;

    this.disassociateConnection(clientId, poolId);
    
    // Mark as idle if healthy
    if (this.isConnectionHealthy(connection)) {
      this.idleConnections.add(poolId);
      this.stats.activeConnections--;
      this.stats.idleConnections++;
      
      // Schedule cleanup after idle timeout
      setTimeout(() => {
        if (this.idleConnections.has(poolId)) {
          this.removeConnection(poolId);
        }
      }, this.config.connectionIdleTimeout);
    } else {
      this.removeConnection(poolId);
    }
  }

  /**
   * Remove connection from pool
   */
  removeConnection(poolId) {
    const connection = this.pool.get(poolId);
    if (!connection) return;

    if (connection.ws && connection.ws.readyState === 1) {
      connection.ws.close();
    }

    this.pool.delete(poolId);
    this.idleConnections.delete(poolId);
    this.stats.activeConnections--;
    logger.debug({ poolId }, 'Connection removed from pool');
  }

  /**
   * Associate connection with client
   */
  associateConnection(clientId, poolId, connection) {
    if (!this.connections.has(clientId)) {
      this.connections.set(clientId, new Set());
    }
    this.connections.get(clientId).add(poolId);
    connection.clientId = clientId;
    connection.poolId = poolId;
    connection.lastUsed = Date.now();
  }

  /**
   * Disassociate connection from client
   */
  disassociateConnection(clientId, poolId) {
    const clientPoolIds = this.connections.get(clientId);
    if (clientPoolIds) {
      clientPoolIds.delete(poolId);
      if (clientPoolIds.size === 0) {
        this.connections.delete(clientId);
      }
    }
    
    const connection = this.pool.get(poolId);
    if (connection) {
      connection.clientId = null;
    }
  }

  /**
   * Get all connections for a client
   */
  getClientConnections(clientId) {
    const poolIds = this.connections.get(clientId);
    if (!poolIds) return [];
    
    return Array.from(poolIds)
      .map(poolId => this.pool.get(poolId))
      .filter(conn => conn && this.isConnectionHealthy(conn));
  }

  /**
   * Check if connection is healthy
   */
  isConnectionHealthy(connection) {
    return connection.ws && 
           connection.ws.readyState === 1 && // WebSocket.OPEN
           (!connection.lastHeartbeat || 
            Date.now() - connection.lastHeartbeat < this.config.heartbeatTimeout * 2);
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      poolSize: this.pool.size,
      idleConnections: this.idleConnections.size,
      clientCount: this.connections.size,
    };
  }

  /**
   * Generate unique pool ID
   */
  generatePoolId() {
    return `pool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Close all connections
   */
  close() {
    this.pool.forEach((connection, poolId) => {
      if (connection.ws && connection.ws.readyState === 1) {
        connection.ws.close();
      }
    });
    this.pool.clear();
    this.connections.clear();
    this.idleConnections.clear();
    logger.info('Connection pool closed');
  }
}

/**
 * Exponential Backoff Reconnection Manager
 */
class ReconnectionManager {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.reconnectAttempts = new Map(); // clientId -> attempt count
    this.reconnectTimers = new Map(); // clientId -> timer
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect(clientId, reconnectFn) {
    const attempts = this.reconnectAttempts.get(clientId) || 0;
    
    if (attempts >= this.config.maxReconnectAttempts) {
      logger.error({ clientId, attempts }, 'Max reconnection attempts reached');
      this.clearReconnection(clientId);
      return null;
    }

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(this.config.reconnectBackoffMultiplier, attempts),
      this.config.maxReconnectDelay
    );

    logger.info({ clientId, attempts, delay }, 'Scheduling reconnection');

    const timer = setTimeout(() => {
      this.reconnectAttempts.set(clientId, attempts + 1);
      reconnectFn();
    }, delay);

    this.reconnectTimers.set(clientId, timer);
    return timer;
  }

  /**
   * Clear reconnection state for client
   */
  clearReconnection(clientId) {
    const timer = this.reconnectTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(clientId);
    }
    this.reconnectAttempts.delete(clientId);
    logger.debug({ clientId }, 'Reconnection state cleared');
  }

  /**
   * Reset reconnection attempts (successful connection)
   */
  resetReconnection(clientId) {
    this.clearReconnection(clientId);
    this.reconnectAttempts.set(clientId, 0);
    logger.debug({ clientId }, 'Reconnection attempts reset');
  }

  /**
   * Get reconnection status
   */
  getStatus(clientId) {
    return {
      attempts: this.reconnectAttempts.get(clientId) || 0,
      hasScheduledReconnect: this.reconnectTimers.has(clientId),
    };
  }
}

/**
 * Payload Filter for reducing unnecessary data transmission
 */
class PayloadFilter {
  constructor() {
    this.filters = new Map(); // subscriptionId -> filter function
    this.stats = {
      totalPayloads: 0,
      filteredPayloads: 0,
      bytesSaved: 0,
    };
  }

  /**
   * Register filter for subscription
   */
  registerFilter(subscriptionId, filterFn) {
    this.filters.set(subscriptionId, filterFn);
    logger.debug({ subscriptionId }, 'Payload filter registered');
  }

  /**
   * Unregister filter
   */
  unregisterFilter(subscriptionId) {
    this.filters.delete(subscriptionId);
    logger.debug({ subscriptionId }, 'Payload filter unregistered');
  }

  /**
   * Apply filter to payload
   */
  filter(subscriptionId, payload) {
    this.stats.totalPayloads++;
    const originalSize = JSON.stringify(payload).length;

    const filterFn = this.filters.get(subscriptionId);
    if (filterFn) {
      const filtered = filterFn(payload);
      const filteredSize = JSON.stringify(filtered).length;
      
      if (filteredSize < originalSize) {
        this.stats.filteredPayloads++;
        this.stats.bytesSaved += originalSize - filteredSize;
        logger.debug(
          { subscriptionId, originalSize, filteredSize, saved: originalSize - filteredSize },
          'Payload filtered'
        );
        return filtered;
      }
    }

    return payload;
  }

  /**
   * Get filter statistics
   */
  getStats() {
    return {
      ...this.stats,
      filterRate: this.stats.totalPayloads > 0 
        ? (this.stats.filteredPayloads / this.stats.totalPayloads * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Clear all filters
   */
  clear() {
    this.filters.clear();
    logger.debug('All payload filters cleared');
  }
}

/**
 * Bandwidth Optimizer with compression and binary serialization
 */
class BandwidthOptimizer {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.stats = {
      totalBytes: 0,
      compressedBytes: 0,
      serializedBytes: 0,
      compressionRatio: 0,
    };
  }

  /**
   * Optimize payload for transmission
   */
  async optimize(payload) {
    let data = JSON.stringify(payload);
    this.stats.totalBytes += data.length;

    // Apply compression if enabled and threshold met
    if (this.config.enableCompression && data.length >= this.config.compressionThreshold) {
      data = await this.compress(data);
      this.stats.compressedBytes += data.length;
    }

    // Apply binary serialization if enabled
    if (this.config.enableBinarySerialization) {
      data = this.serialize(data);
      this.stats.serializedBytes += data.length;
    }

    return data;
  }

  /**
   * Decompress payload
   */
  async decompress(data) {
    // Simple placeholder - would use zlib or similar in production
    // For now, return as-is since we're not actually compressing
    return data;
  }

  /**
   * Deserialize payload
   */
  deserialize(data) {
    // Simple placeholder - would use MessagePack or similar in production
    // For now, assume JSON
    return JSON.parse(data);
  }

  /**
   * Compress data (placeholder - would use zlib in production)
   */
  async compress(data) {
    // Placeholder - in production, use zlib.gzip or similar
    return data;
  }

  /**
   * Serialize to binary (placeholder - would use MessagePack in production)
   */
  serialize(data) {
    // Placeholder - in production, use msgpack.encode or similar
    return data;
  }

  /**
   * Get optimization statistics
   */
  getStats() {
    const compressionRatio = this.stats.totalBytes > 0
      ? ((this.stats.totalBytes - this.stats.compressedBytes) / this.stats.totalBytes * 100).toFixed(2) + '%'
      : '0%';

    return {
      ...this.stats,
      compressionRatio,
    };
  }
}

/**
 * Connection Health Monitor with heartbeat system
 */
class HealthMonitor {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.healthChecks = new Map(); // clientId -> health info
    this.heartbeatIntervals = new Map(); // clientId -> interval
    this.stats = {
      totalHeartbeats: 0,
      missedHeartbeats: 0,
      unhealthyConnections: 0,
    };
  }

  /**
   * Start monitoring a connection
   */
  startMonitoring(clientId, ws) {
    const healthInfo = {
      clientId,
      ws,
      lastHeartbeat: Date.now(),
      missedBeats: 0,
      isHealthy: true,
    };

    this.healthChecks.set(clientId, healthInfo);

    // Start heartbeat interval
    const interval = setInterval(() => {
      this.sendHeartbeat(clientId);
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(clientId, interval);

    logger.debug({ clientId }, 'Health monitoring started');
  }

  /**
   * Stop monitoring a connection
   */
  stopMonitoring(clientId) {
    const interval = this.heartbeatIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(clientId);
    }

    this.healthChecks.delete(clientId);
    logger.debug({ clientId }, 'Health monitoring stopped');
  }

  /**
   * Send heartbeat to client
   */
  sendHeartbeat(clientId) {
    const healthInfo = this.healthChecks.get(clientId);
    if (!healthInfo || !healthInfo.ws || healthInfo.ws.readyState !== 1) {
      this.stopMonitoring(clientId);
      return;
    }

    try {
      healthInfo.ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
      this.stats.totalHeartbeats++;
      logger.trace({ clientId }, 'Heartbeat sent');
    } catch (error) {
      logger.error({ clientId, error: error.message }, 'Failed to send heartbeat');
      this.handleMissedHeartbeat(clientId);
    }
  }

  /**
   * Handle heartbeat response
   */
  handleHeartbeatResponse(clientId) {
    const healthInfo = this.healthChecks.get(clientId);
    if (!healthInfo) return;

    healthInfo.lastHeartbeat = Date.now();
    healthInfo.missedBeats = 0;
    healthInfo.isHealthy = true;
    
    logger.trace({ clientId }, 'Heartbeat response received');
  }

  /**
   * Handle missed heartbeat
   */
  handleMissedHeartbeat(clientId) {
    const healthInfo = this.healthChecks.get(clientId);
    if (!healthInfo) return;

    healthInfo.missedBeats++;
    this.stats.missedHeartbeats++;

    if (healthInfo.missedBeats >= 3) {
      healthInfo.isHealthy = false;
      this.stats.unhealthyConnections++;
      logger.warn({ clientId, missedBeats: healthInfo.missedBeats }, 'Connection marked as unhealthy');
    }
  }

  /**
   * Check connection health
   */
  isHealthy(clientId) {
    const healthInfo = this.healthChecks.get(clientId);
    return healthInfo ? healthInfo.isHealthy : false;
  }

  /**
   * Get health statistics
   */
  getStats() {
    return {
      ...this.stats,
      monitoredConnections: this.healthChecks.size,
      healthRate: this.stats.totalHeartbeats > 0
        ? ((this.stats.totalHeartbeats - this.stats.missedHeartbeats) / this.stats.totalHeartbeats * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Stop all monitoring
   */
  close() {
    this.heartbeatIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.heartbeatIntervals.clear();
    this.healthChecks.clear();
    logger.info('Health monitor closed');
  }
}

/**
 * Subscription Rate Limiter
 */
class SubscriptionRateLimiter {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.subscriptionCounts = new Map(); // clientId -> { count, windowStart }
    this.clientSubscriptions = new Map(); // clientId -> Set of subscriptionIds
    this.stats = {
      totalRequests: 0,
      limitedRequests: 0,
      blockedClients: 0,
    };
  }

  /**
   * Check if subscription is allowed
   */
  canSubscribe(clientId, subscriptionId) {
    this.stats.totalRequests++;

    // Check per-client subscription limit
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (clientSubs && clientSubs.size >= this.config.maxSubscriptionsPerClient) {
      logger.warn({ clientId, count: clientSubs.size }, 'Max subscriptions per client reached');
      this.stats.limitedRequests++;
      return false;
    }

    // Check rate limit
    const now = Date.now();
    const counts = this.subscriptionCounts.get(clientId) || { count: 0, windowStart: now };

    if (now - counts.windowStart > this.config.subscriptionRateLimitWindow) {
      counts.count = 0;
      counts.windowStart = now;
    }

    if (counts.count >= this.config.maxSubscriptionsPerWindow) {
      logger.warn({ clientId, count: counts.count }, 'Subscription rate limit reached');
      this.stats.limitedRequests++;
      this.stats.blockedClients++;
      return false;
    }

    counts.count++;
    this.subscriptionCounts.set(clientId, counts);

    // Track subscription
    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    this.clientSubscriptions.get(clientId).add(subscriptionId);

    logger.debug({ clientId, subscriptionId, count: counts.count }, 'Subscription allowed');
    return true;
  }

  /**
   * Remove subscription tracking
   */
  unsubscribe(clientId, subscriptionId) {
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(clientId);
        this.subscriptionCounts.delete(clientId);
      }
    }
    logger.debug({ clientId, subscriptionId }, 'Subscription tracking removed');
  }

  /**
   * Get rate limit statistics
   */
  getStats() {
    return {
      ...this.stats,
      limitedRate: this.stats.totalRequests > 0
        ? (this.stats.limitedRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      activeClients: this.clientSubscriptions.size,
    };
  }

  /**
   * Clear all rate limiting data
   */
  clear() {
    this.subscriptionCounts.clear();
    this.clientSubscriptions.clear();
    logger.debug('Rate limiter cleared');
  }
}

/**
 * Subscription Lifecycle Manager
 */
class LifecycleManager {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.subscriptions = new Map(); // subscriptionId -> subscription info
    this.cleanupTimer = null;
    this.stats = {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      abandonedSubscriptions: 0,
      cleanedSubscriptions: 0,
    };
  }

  /**
   * Register subscription
   */
  register(subscriptionId, clientId, topic) {
    const subscription = {
      id: subscriptionId,
      clientId,
      topic,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isActive: true,
      isAbandoned: false,
    };

    this.subscriptions.set(subscriptionId, subscription);
    this.stats.totalSubscriptions++;
    this.stats.activeSubscriptions++;

    logger.debug({ subscriptionId, clientId, topic }, 'Subscription registered');
    
    this.startCleanup();
    return subscription;
  }

  /**
   * Update subscription activity
   */
  updateActivity(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.lastActivity = Date.now();
      subscription.isAbandoned = false;
      logger.trace({ subscriptionId }, 'Subscription activity updated');
    }
  }

  /**
   * Mark subscription as abandoned
   */
  markAbandoned(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.isAbandoned = true;
      this.stats.abandonedSubscriptions++;
      logger.warn({ subscriptionId }, 'Subscription marked as abandoned');
    }
  }

  /**
   * Unregister subscription
   */
  unregister(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.subscriptions.delete(subscriptionId);
      this.stats.activeSubscriptions--;
      logger.debug({ subscriptionId }, 'Subscription unregistered');
    }
  }

  /**
   * Start cleanup timer
   */
  startCleanup() {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    logger.debug('Subscription cleanup timer started');
  }

  /**
   * Cleanup abandoned subscriptions
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    this.subscriptions.forEach((subscription, subscriptionId) => {
      const inactiveTime = now - subscription.lastActivity;
      
      if (inactiveTime > this.config.abandonedSubscriptionTimeout) {
        this.markAbandoned(subscriptionId);
        this.subscriptions.delete(subscriptionId);
        this.stats.activeSubscriptions--;
        this.stats.cleanedSubscriptions++;
        cleanedCount++;
        
        logger.info(
          { subscriptionId, inactiveTime },
          'Cleaned up abandoned subscription'
        );
      }
    });

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Subscription cleanup completed');
    }
  }

  /**
   * Get lifecycle statistics
   */
  getStats() {
    return {
      ...this.stats,
      abandonmentRate: this.stats.totalSubscriptions > 0
        ? (this.stats.abandonedSubscriptions / this.stats.totalSubscriptions * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Stop cleanup and clear all subscriptions
   */
  close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.subscriptions.clear();
    logger.info('Lifecycle manager closed');
  }
}

/**
 * Subscription Resumption Manager
 */
class ResumptionManager {
  constructor() {
    this.subscriptionStates = new Map(); // clientId -> Map of subscriptionId -> state
    this.resumptionTokens = new Map(); // token -> subscription state
    this.stats = {
      savedStates: 0,
      resumedSubscriptions: 0,
      failedResumptions: 0,
    };
  }

  /**
   * Save subscription state for resumption
   */
  saveState(clientId, subscriptionId, state) {
    if (!this.subscriptionStates.has(clientId)) {
      this.subscriptionStates.set(clientId, new Map());
    }

    const token = this.generateResumptionToken();
    const stateWithMeta = {
      ...state,
      subscriptionId,
      clientId,
      savedAt: Date.now(),
    };

    this.subscriptionStates.get(clientId).set(subscriptionId, stateWithMeta);
    this.resumptionTokens.set(token, stateWithMeta);
    
    this.stats.savedStates++;
    logger.debug({ clientId, subscriptionId, token }, 'Subscription state saved for resumption');
    
    return token;
  }

  /**
   * Resume subscription from saved state
   */
  resume(token) {
    const state = this.resumptionTokens.get(token);
    if (!state) {
      logger.warn({ token }, 'Resumption token not found');
      this.stats.failedResumptions++;
      return null;
    }

    // Check if state is too old (optional - could add expiry)
    const age = Date.now() - state.savedAt;
    if (age > 3600000) { // 1 hour
      logger.warn({ token, age }, 'Resumption token expired');
      this.resumptionTokens.delete(token);
      this.stats.failedResumptions++;
      return null;
    }

    this.stats.resumedSubscriptions++;
    logger.info({ token, subscriptionId: state.subscriptionId }, 'Subscription resumed');
    
    return state;
  }

  /**
   * Clear saved state for subscription
   */
  clearState(clientId, subscriptionId) {
    const clientStates = this.subscriptionStates.get(clientId);
    if (clientStates) {
      const state = clientStates.get(subscriptionId);
      if (state) {
        // Find and remove token
        for (const [token, s] of this.resumptionTokens.entries()) {
          if (s.subscriptionId === subscriptionId && s.clientId === clientId) {
            this.resumptionTokens.delete(token);
            break;
          }
        }
        clientStates.delete(subscriptionId);
      }
      
      if (clientStates.size === 0) {
        this.subscriptionStates.delete(clientId);
      }
    }
    logger.debug({ clientId, subscriptionId }, 'Subscription state cleared');
  }

  /**
   * Generate unique resumption token
   */
  generateResumptionToken() {
    return `resume-${Date.now()}-${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * Get resumption statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.savedStates > 0
        ? (this.stats.resumedSubscriptions / this.stats.savedStates * 100).toFixed(2) + '%'
        : '0%',
      pendingStates: this.resumptionTokens.size,
    };
  }

  /**
   * Clear all saved states
   */
  clear() {
    this.subscriptionStates.clear();
    this.resumptionTokens.clear();
    logger.debug('All resumption states cleared');
  }
}

/**
 * Performance Metrics Collector
 */
class MetricsCollector {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    this.metrics = new Map(); // metricName -> Array of { timestamp, value }
    this.counters = new Map(); // counterName -> value
    this.timers = new Map(); // timerName -> startTime
  }

  /**
   * Record metric value
   */
  recordMetric(name, value) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricData = {
      timestamp: Date.now(),
      value,
    };

    this.metrics.get(name).push(metricData);

    // Cleanup old metrics
    this.cleanupOldMetrics(name);

    logger.trace({ name, value }, 'Metric recorded');
  }

  /**
   * Increment counter
   */
  incrementCounter(name, delta = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + delta);
    logger.trace({ name, value: current + delta }, 'Counter incremented');
  }

  /**
   * Start timer
   */
  startTimer(name) {
    this.timers.set(name, Date.now());
    logger.trace({ name }, 'Timer started');
  }

  /**
   * Stop timer and record duration
   */
  stopTimer(name) {
    const startTime = this.timers.get(name);
    if (!startTime) {
      logger.warn({ name }, 'Timer not found');
      return null;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);
    this.recordMetric(`${name}_duration`, duration);
    
    logger.trace({ name, duration }, 'Timer stopped');
    return duration;
  }

  /**
   * Get metric statistics
   */
  getMetricStats(name) {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) {
      return null;
    }

    const sortedValues = values.map(v => v.value).sort((a, b) => a - b);
    const sum = sortedValues.reduce((a, b) => a + b, 0);
    const avg = sum / sortedValues.length;
    const min = sortedValues[0];
    const max = sortedValues[sortedValues.length - 1];
    const median = sortedValues[Math.floor(sortedValues.length / 2)];

    return {
      count: sortedValues.length,
      min,
      max,
      avg: avg.toFixed(2),
      median,
      sum,
    };
  }

  /**
   * Get counter value
   */
  getCounter(name) {
    return this.counters.get(name) || 0;
  }

  /**
   * Get all metrics
   */
  getAllMetrics() {
    const result = {
      metrics: {},
      counters: {},
    };

    this.metrics.forEach((values, name) => {
      result.metrics[name] = this.getMetricStats(name);
    });

    this.counters.forEach((value, name) => {
      result.counters[name] = value;
    });

    return result;
  }

  /**
   * Cleanup old metrics
   */
  cleanupOldMetrics(name) {
    const values = this.metrics.get(name);
    if (!values) return;

    const cutoff = Date.now() - this.config.metricsRetentionPeriod;
    const filtered = values.filter(v => v.timestamp > cutoff);
    
    this.metrics.set(name, filtered);
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
    this.counters.clear();
    this.timers.clear();
    logger.debug('All metrics cleared');
  }
}

/**
 * Main Subscription Optimization Manager
 * Orchestrates all optimization components
 */
class SubscriptionOptimizationManager {
  constructor(config = OPTIMIZATION_CONFIG) {
    this.config = config;
    
    // Initialize all components
    this.connectionPool = new ConnectionPool(config);
    this.reconnectionManager = new ReconnectionManager(config);
    this.payloadFilter = new PayloadFilter();
    this.bandwidthOptimizer = new BandwidthOptimizer(config);
    this.healthMonitor = new HealthMonitor(config);
    this.rateLimiter = new SubscriptionRateLimiter(config);
    this.lifecycleManager = new LifecycleManager(config);
    this.resumptionManager = new ResumptionManager();
    this.metricsCollector = new MetricsCollector(config);
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      connectionPool: this.connectionPool.getStats(),
      reconnection: this.reconnectionManager.getStatus('global'),
      payloadFilter: this.payloadFilter.getStats(),
      bandwidthOptimizer: this.bandwidthOptimizer.getStats(),
      healthMonitor: this.healthMonitor.getStats(),
      rateLimiter: this.rateLimiter.getStats(),
      lifecycle: this.lifecycleManager.getStats(),
      resumption: this.resumptionManager.getStats(),
      metrics: this.metricsCollector.getAllMetrics(),
    };
  }

  /**
   * Close all components
   */
  close() {
    this.connectionPool.close();
    this.healthMonitor.close();
    this.lifecycleManager.close();
    this.payloadFilter.clear();
    this.rateLimiter.clear();
    this.resumptionManager.clear();
    this.metricsCollector.clear();
    logger.info('Subscription optimization manager closed');
  }
}

// Export singleton instance
export const optimizationManager = new SubscriptionOptimizationManager();

// Export individual components for direct access
export {
  ConnectionPool,
  ReconnectionManager,
  PayloadFilter,
  BandwidthOptimizer,
  HealthMonitor,
  SubscriptionRateLimiter,
  LifecycleManager,
  ResumptionManager,
  MetricsCollector,
  SubscriptionOptimizationManager,
  OPTIMIZATION_CONFIG,
};
