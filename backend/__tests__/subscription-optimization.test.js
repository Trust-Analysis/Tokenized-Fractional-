/**
 * Comprehensive Tests for GraphQL WebSocket Subscription Optimization
 * 
 * Tests all optimization features:
 * - Connection pooling
 * - Exponential backoff reconnection
 * - Payload filtering
 * - Bandwidth optimization
 * - Health monitoring
 * - Rate limiting
 * - Lifecycle management
 * - Subscription resumption
 * - Performance metrics
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
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
} from '../subscription-optimization.js';

describe('ConnectionPool', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    pool.close();
  });

  describe('Connection Acquisition', () => {
    it('should create new connection when pool is empty', () => {
      const mockWs = { readyState: 1, close: jest.fn() };
      const connection = pool.acquire('client-1', () => ({ ws: mockWs }));

      expect(connection).toBeDefined();
      expect(connection.ws).toBe(mockWs);
      expect(pool.getStats().totalConnections).toBe(1);
    });

    it('should reuse idle connection when available', () => {
      const mockWs = { readyState: 1, close: jest.fn() };
      pool.acquire('client-1', () => ({ ws: mockWs }));
      pool.release('client-1', pool.connections.get('client-1').values().next().value);

      const connection2 = pool.acquire('client-2', () => ({ ws: mockWs }));
      expect(pool.getStats().reusedConnections).toBe(1);
    });

    it('should enforce max connections per client', () => {
      const mockWs = { readyState: 1, close: jest.fn() };
      
      expect(() => {
        for (let i = 0; i < 6; i++) {
          pool.acquire('client-1', () => ({ ws: mockWs }));
        }
      }).toThrow('Max connections per client exceeded');
    });

    it('should enforce pool size limit', () => {
      const mockConfig = { ...OPTIMIZATION_CONFIG, connectionPoolSize: 5 };
      const smallPool = new ConnectionPool(mockConfig);
      const mockWs = { readyState: 1, close: jest.fn() };

      expect(() => {
        for (let i = 0; i < 6; i++) {
          smallPool.acquire(`client-${i}`, () => ({ ws: mockWs }));
        }
      }).toThrow('Connection pool exhausted');

      smallPool.close();
    });
  });

  describe('Connection Release', () => {
    it('should release connection back to pool', () => {
      const mockWs = { readyState: 1, close: jest.fn() };
      const connection = pool.acquire('client-1', () => ({ ws: mockWs }));
      const poolId = connection.poolId;

      pool.release('client-1', poolId);
      expect(pool.getStats().activeConnections).toBe(0);
      expect(pool.getStats().idleConnections).toBe(1);
    });

    it('should remove unhealthy connections', () => {
      const mockWs = { readyState: 0, close: jest.fn() }; // Not OPEN
      const connection = pool.acquire('client-1', () => ({ ws: mockWs }));
      const poolId = connection.poolId;

      pool.release('client-1', poolId);
      expect(pool.getStats().idleConnections).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track connection statistics', () => {
      const mockWs = { readyState: 1, close: jest.fn() };
      pool.acquire('client-1', () => ({ ws: mockWs }));
      pool.acquire('client-2', () => ({ ws: mockWs }));

      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(2);
      expect(stats.activeConnections).toBe(2);
      expect(stats.clientCount).toBe(2);
    });
  });
});

describe('ReconnectionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ReconnectionManager(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    manager.clearReconnection('client-1');
  });

  describe('Reconnection Scheduling', () => {
    it('should schedule reconnection with exponential backoff', async () => {
      jest.useFakeTimers();
      const reconnectFn = jest.fn();
      
      manager.scheduleReconnect('client-1', reconnectFn);
      expect(reconnectFn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(reconnectFn).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('should increase delay with each attempt', () => {
      jest.useFakeTimers();
      const reconnectFn = jest.fn();
      
      manager.scheduleReconnect('client-1', reconnectFn);
      jest.advanceTimersByTime(1000);
      
      manager.scheduleReconnect('client-1', reconnectFn);
      jest.advanceTimersByTime(2000); // 2x delay
      
      expect(reconnectFn).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should stop after max attempts', () => {
      const reconnectFn = jest.fn();
      const mockConfig = { ...OPTIMIZATION_CONFIG, maxReconnectAttempts: 3 };
      const strictManager = new ReconnectionManager(mockConfig);

      for (let i = 0; i < 3; i++) {
        strictManager.scheduleReconnect('client-1', reconnectFn);
      }

      const result = strictManager.scheduleReconnect('client-1', reconnectFn);
      expect(result).toBeNull();

      strictManager.clearReconnection('client-1');
    });
  });

  describe('Reconnection Reset', () => {
    it('should reset attempts on successful connection', () => {
      manager.scheduleReconnect('client-1', jest.fn());
      manager.resetReconnection('client-1');

      const status = manager.getStatus('client-1');
      expect(status.attempts).toBe(0);
    });
  });
});

describe('PayloadFilter', () => {
  let filter;

  beforeEach(() => {
    filter = new PayloadFilter();
  });

  afterEach(() => {
    filter.clear();
  });

  describe('Filter Registration', () => {
    it('should register and apply filter', () => {
      const filterFn = (payload) => ({
        ...payload,
        data: { ...payload.data, filtered: true }
      });

      filter.registerFilter('sub-1', filterFn);
      const payload = { data: { value: 42 } };
      const filtered = filter.filter('sub-1', payload);

      expect(filtered.data.filtered).toBe(true);
      expect(filter.getStats().filteredPayloads).toBe(1);
    });

    it('should return original payload if no filter registered', () => {
      const payload = { data: { value: 42 } };
      const filtered = filter.filter('sub-1', payload);

      expect(filtered).toEqual(payload);
    });

    it('should track bytes saved', () => {
      const filterFn = (payload) => ({ data: { small: true } });
      filter.registerFilter('sub-1', filterFn);
      
      const largePayload = { data: { very: 'large', payload: 'data' } };
      filter.filter('sub-1', largePayload);

      expect(filter.getStats().bytesSaved).toBeGreaterThan(0);
    });
  });

  describe('Filter Unregistration', () => {
    it('should unregister filter', () => {
      const filterFn = jest.fn();
      filter.registerFilter('sub-1', filterFn);
      filter.unregisterFilter('sub-1');

      const payload = { data: { value: 42 } };
      const filtered = filter.filter('sub-1', payload);

      expect(filtered).toEqual(payload);
    });
  });
});

describe('BandwidthOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new BandwidthOptimizer(OPTIMIZATION_CONFIG);
  });

  describe('Payload Optimization', () => {
    it('should optimize payload for transmission', async () => {
      const payload = { data: { value: 42 } };
      const optimized = await optimizer.optimize(payload);

      expect(optimized).toBeDefined();
      expect(optimizer.getStats().totalBytes).toBeGreaterThan(0);
    });

    it('should track compression statistics', async () => {
      const largePayload = { data: 'x'.repeat(2000) };
      await optimizer.optimize(largePayload);

      const stats = optimizer.getStats();
      expect(stats.totalBytes).toBeGreaterThan(0);
    });
  });
});

describe('HealthMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new HealthMonitor(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    monitor.close();
  });

  describe('Health Monitoring', () => {
    it('should start monitoring connection', () => {
      const mockWs = { readyState: 1, send: jest.fn() };
      monitor.startMonitoring('client-1', mockWs);

      expect(monitor.getStats().monitoredConnections).toBe(1);
    });

    it('should handle heartbeat response', () => {
      const mockWs = { readyState: 1, send: jest.fn() };
      monitor.startMonitoring('client-1', mockWs);
      monitor.handleHeartbeatResponse('client-1');

      expect(monitor.isHealthy('client-1')).toBe(true);
    });

    it('should mark unhealthy after missed heartbeats', () => {
      const mockWs = { readyState: 1, send: jest.fn() };
      monitor.startMonitoring('client-1', mockWs);

      for (let i = 0; i < 3; i++) {
        monitor.handleMissedHeartbeat('client-1');
      }

      expect(monitor.isHealthy('client-1')).toBe(false);
    });

    it('should stop monitoring', () => {
      const mockWs = { readyState: 1, send: jest.fn() };
      monitor.startMonitoring('client-1', mockWs);
      monitor.stopMonitoring('client-1');

      expect(monitor.getStats().monitoredConnections).toBe(0);
    });
  });
});

describe('SubscriptionRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new SubscriptionRateLimiter(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    limiter.clear();
  });

  describe('Rate Limiting', () => {
    it('should allow subscription within limits', () => {
      const result = limiter.canSubscribe('client-1', 'sub-1');
      expect(result).toBe(true);
    });

    it('should enforce max subscriptions per client', () => {
      const mockConfig = { ...OPTIMIZATION_CONFIG, maxSubscriptionsPerClient: 3 };
      const strictLimiter = new SubscriptionRateLimiter(mockConfig);

      for (let i = 0; i < 3; i++) {
        strictLimiter.canSubscribe('client-1', `sub-${i}`);
      }

      const result = strictLimiter.canSubscribe('client-1', 'sub-4');
      expect(result).toBe(false);

      strictLimiter.clear();
    });

    it('should enforce rate limit per window', () => {
      const mockConfig = { ...OPTIMIZATION_CONFIG, maxSubscriptionsPerWindow: 5 };
      const strictLimiter = new SubscriptionRateLimiter(mockConfig);

      for (let i = 0; i < 5; i++) {
        strictLimiter.canSubscribe('client-1', `sub-${i}`);
      }

      const result = strictLimiter.canSubscribe('client-1', 'sub-6');
      expect(result).toBe(false);

      strictLimiter.clear();
    });

    it('should track subscription on unsubscribe', () => {
      limiter.canSubscribe('client-1', 'sub-1');
      limiter.unsubscribe('client-1', 'sub-1');

      const stats = limiter.getStats();
      expect(stats.activeClients).toBe(0);
    });
  });
});

describe('LifecycleManager', () => {
  let lifecycle;

  beforeEach(() => {
    lifecycle = new LifecycleManager(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    lifecycle.close();
  });

  describe('Subscription Lifecycle', () => {
    it('should register subscription', () => {
      const subscription = lifecycle.register('sub-1', 'client-1', 'topic-1');

      expect(subscription).toBeDefined();
      expect(subscription.id).toBe('sub-1');
      expect(lifecycle.getStats().activeSubscriptions).toBe(1);
    });

    it('should update subscription activity', () => {
      lifecycle.register('sub-1', 'client-1', 'topic-1');
      const before = lifecycle.subscriptions.get('sub-1').lastActivity;

      setTimeout(() => {
        lifecycle.updateActivity('sub-1');
        const after = lifecycle.subscriptions.get('sub-1').lastActivity;
        expect(after).toBeGreaterThan(before);
      }, 10);
    });

    it('should mark subscription as abandoned', () => {
      lifecycle.register('sub-1', 'client-1', 'topic-1');
      lifecycle.markAbandoned('sub-1');

      expect(lifecycle.subscriptions.get('sub-1').isAbandoned).toBe(true);
      expect(lifecycle.getStats().abandonedSubscriptions).toBe(1);
    });

    it('should unregister subscription', () => {
      lifecycle.register('sub-1', 'client-1', 'topic-1');
      lifecycle.unregister('sub-1');

      expect(lifecycle.subscriptions.has('sub-1')).toBe(false);
      expect(lifecycle.getStats().activeSubscriptions).toBe(0);
    });
  });
});

describe('ResumptionManager', () => {
  let resumption;

  beforeEach(() => {
    resumption = new ResumptionManager();
  });

  afterEach(() => {
    resumption.clear();
  });

  describe('Subscription Resumption', () => {
    it('should save subscription state', () => {
      const state = { topic: 'topic-1', filter: null };
      const token = resumption.saveState('client-1', 'sub-1', state);

      expect(token).toBeDefined();
      expect(resumption.getStats().savedStates).toBe(1);
    });

    it('should resume subscription from token', () => {
      const state = { topic: 'topic-1', filter: null };
      const token = resumption.saveState('client-1', 'sub-1', state);

      const resumed = resumption.resume(token);
      expect(resumed).toBeDefined();
      expect(resumed.topic).toBe('topic-1');
      expect(resumption.getStats().resumedSubscriptions).toBe(1);
    });

    it('should return null for invalid token', () => {
      const resumed = resumption.resume('invalid-token');
      expect(resumed).toBeNull();
      expect(resumption.getStats().failedResumptions).toBe(1);
    });

    it('should clear saved state', () => {
      const state = { topic: 'topic-1', filter: null };
      resumption.saveState('client-1', 'sub-1', state);
      resumption.clearState('client-1', 'sub-1');

      const stats = resumption.getStats();
      expect(stats.pendingStates).toBe(0);
    });
  });
});

describe('MetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new MetricsCollector(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    collector.clear();
  });

  describe('Metrics Collection', () => {
    it('should record metric values', () => {
      collector.recordMetric('test_metric', 42);
      collector.recordMetric('test_metric', 58);

      const stats = collector.getMetricStats('test_metric');
      expect(stats).toBeDefined();
      expect(stats.count).toBe(2);
      expect(stats.avg).toBe('50.00');
    });

    it('should increment counters', () => {
      collector.incrementCounter('test_counter');
      collector.incrementCounter('test_counter', 5);

      expect(collector.getCounter('test_counter')).toBe(6);
    });

    it('should track timer duration', () => {
      collector.startTimer('test_timer');
      const duration = collector.stopTimer('test_timer');

      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should return null for non-existent metric', () => {
      const stats = collector.getMetricStats('non_existent');
      expect(stats).toBeNull();
    });

    it('should get all metrics', () => {
      collector.recordMetric('metric1', 10);
      collector.incrementCounter('counter1', 5);

      const all = collector.getAllMetrics();
      expect(all.metrics.metric1).toBeDefined();
      expect(all.counters.counter1).toBe(5);
    });
  });
});

describe('SubscriptionOptimizationManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SubscriptionOptimizationManager(OPTIMIZATION_CONFIG);
  });

  afterEach(() => {
    manager.close();
  });

  describe('Manager Integration', () => {
    it('should initialize all components', () => {
      const stats = manager.getStats();

      expect(stats.connectionPool).toBeDefined();
      expect(stats.healthMonitor).toBeDefined();
      expect(stats.rateLimiter).toBeDefined();
      expect(stats.lifecycle).toBeDefined();
      expect(stats.resumption).toBeDefined();
      expect(stats.metrics).toBeDefined();
    });

    it('should return comprehensive statistics', () => {
      const stats = manager.getStats();

      expect(stats.connectionPool.totalConnections).toBe(0);
      expect(stats.healthMonitor.monitoredConnections).toBe(0);
      expect(stats.rateLimiter.activeClients).toBe(0);
      expect(stats.lifecycle.activeSubscriptions).toBe(0);
    });

    it('should close all components', () => {
      manager.close();

      const stats = manager.getStats();
      expect(stats.connectionPool.activeConnections).toBe(0);
    });
  });
});
