/* eslint-disable max-classes-per-file, no-await-in-loop */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { WebSocketManager } from '../websocket.js';
import { WebSocketRedisAdapter } from '../websocketRedisAdapter.js';

/**
 * Mock Redis Broker that simulates a shared Redis server supporting Pub/Sub.
 * Supports simulating outages (disconnecting clients, rejecting new operations)
 * and recovery (allowing reconnections and resuming message delivery).
 */
class MockRedisBroker extends EventEmitter {
  constructor() {
    super();
    this.isOutage = false;
    this.activeClients = new Set();
    this.subscriptions = new Map(); // channel -> Set<MockRedisClient>
  }

  simulateOutage() {
    this.isOutage = true;
    [...this.activeClients].forEach((client) => {
      client.triggerDisconnect();
    });
  }

  simulateRecovery() {
    this.isOutage = false;
    this.emit('recovered');
    [...this.activeClients].forEach((client) => {
      client.triggerRecovery();
    });
  }

  registerClient(client) {
    this.activeClients.add(client);
  }

  unregisterClient(client) {
    this.activeClients.delete(client);
    this.subscriptions.forEach((subscribers) => {
      subscribers.delete(client);
    });
  }
}

/**
 * Mock Redis Client that simulates ioredis behavior for pub/sub connections.
 */
class MockRedisClient extends EventEmitter {
  constructor(broker, url, options = {}) {
    super();
    this.broker = broker;
    this.url = url;
    this.options = options;
    this.status = 'wait';
    this.retryStrategy = options.retryStrategy;
    this.broker.registerClient(this);
    this._retryTimer = null;
  }

  async connect() {
    if (this.broker.isOutage) {
      this.status = 'reconnecting';
      const error = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      this.emit('error', error);
      if (this.retryStrategy) {
        this._scheduleRetry();
      }
      throw error;
    }

    this.status = 'ready';
    this.emit('connect');
    this.emit('ready');
    return 'OK';
  }

  async subscribe(channel) {
    if (this.broker.isOutage || this.status !== 'ready') {
      throw new Error('Connection is closed');
    }

    let subscribers = this.broker.subscriptions.get(channel);
    if (!subscribers) {
      subscribers = new Set();
      this.broker.subscriptions.set(channel, subscribers);
    }
    subscribers.add(this);
    return 1;
  }

  async publish(channel, message) {
    if (this.broker.isOutage || this.status !== 'ready') {
      throw new Error('Connection is closed');
    }

    const subscribers = this.broker.subscriptions.get(channel);
    if (subscribers) {
      subscribers.forEach((sub) => {
        if (sub !== this && sub.status === 'ready') {
          // Deliver asynchronously like real network pub/sub
          setImmediate(() => {
            if (sub.status === 'ready') {
              sub.emit('message', channel, message);
            }
          });
        }
      });
    }
    return 1;
  }

  triggerDisconnect() {
    if (this.status === 'end') return;
    this.status = 'close';
    this.emit('close');
    this.emit('error', new Error('connect ECONNRESET'));
    if (this.retryStrategy) {
      this._scheduleRetry();
    }
  }

  triggerRecovery() {
    if (this.status === 'reconnecting' || this.status === 'close') {
      this.status = 'ready';
      this.emit('connect');
      this.emit('ready');
    }
  }

  _scheduleRetry() {
    if (this._retryTimer || this.status === 'end') return;
    const delay = this.retryStrategy ? this.retryStrategy(1) : 50;
    if (delay == null) return;

    this._retryTimer = setTimeout(
      () => {
        this._retryTimer = null;
        if (this.status === 'end') return;
        if (this.broker.isOutage) {
          this.status = 'reconnecting';
          this.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379'));
          this._scheduleRetry();
        } else {
          this.status = 'ready';
          this.emit('connect');
          this.emit('ready');
        }
      },
      Math.max(delay, 20),
    );
  }

  async quit() {
    this.status = 'end';
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this.broker.unregisterClient(this);
    this.emit('end');
    return 'OK';
  }

  disconnect() {
    this.status = 'end';
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this.broker.unregisterClient(this);
    this.emit('end');
  }
}

/**
 * Helper to wait for a predicate to become true with a timeout.
 */
async function waitFor(predicate, timeoutMs = 4000, stepMs = 50) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, stepMs);
    });
  }
  return false;
}

describe('WebSocketRedisAdapter - Automatic Reconnection and Outage Recovery', () => {
  let broker;
  let MockClientClass;

  beforeEach(() => {
    broker = new MockRedisBroker();
    MockClientClass = class extends MockRedisClient {
      constructor(url, opts) {
        super(broker, url, opts);
      }
    };
  });

  afterEach(() => {
    broker.simulateRecovery();
  });

  test('simulates a Redis outage followed by recovery and confirms cross-instance broadcasting resumes automatically', async () => {
    const managerA = new WebSocketManager();
    const managerB = new WebSocketManager();

    // Track remote broadcasts received on Node B
    const remoteBroadcastsB = [];
    managerB.handleRemoteBroadcast = (topic, message) => {
      remoteBroadcastsB.push({ topic, message });
    };

    // Attach adapters to both nodes with short reconnectInterval for rapid test feedback
    const adapterA = new WebSocketRedisAdapter(managerA, {
      instanceId: 'node-A',
      reconnectInterval: 50,
      RedisClient: MockClientClass,
    });
    const adapterB = new WebSocketRedisAdapter(managerB, {
      instanceId: 'node-B',
      reconnectInterval: 50,
      RedisClient: MockClientClass,
    });

    managerA.redisAdapter = adapterA;
    managerB.redisAdapter = adapterB;

    // 1. Initial connection: both nodes connect successfully
    const connectedA = await adapterA.connect();
    const connectedB = await adapterB.connect();
    expect(connectedA).toBe(true);
    expect(connectedB).toBe(true);
    expect(adapterA.connected).toBe(true);
    expect(adapterB.connected).toBe(true);
    expect(managerA.getStats().redisConnected).toBe(true);
    expect(managerB.getStats().redisConnected).toBe(true);

    // 2. Broadcast from Node A to Node B works prior to outage
    adapterA.publish('share-purchases', { event: 'initial-broadcast', amount: 100 });

    const receivedInitial = await waitFor(() => remoteBroadcastsB.length === 1);
    expect(receivedInitial).toBe(true);
    expect(remoteBroadcastsB[0].topic).toBe('share-purchases');
    expect(remoteBroadcastsB[0].message).toEqual({ event: 'initial-broadcast', amount: 100 });

    // 3. Simulate Redis outage
    broker.simulateOutage();

    // Both adapters should degrade gracefully to single-node mode (connected = false)
    const outageRecognized = await waitFor(() => !adapterA.connected && !adapterB.connected);
    expect(outageRecognized).toBe(true);
    expect(managerA.getStats().redisConnected).toBe(false);
    expect(managerB.getStats().redisConnected).toBe(false);

    // 4. Broadcasting during outage must not throw or crash the backend process
    expect(() => {
      adapterA.publish('share-purchases', { event: 'during-outage' });
    }).not.toThrow();

    // Node B does not receive broadcasts during the outage
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(remoteBroadcastsB.length).toBe(1);

    // 5. Simulate Redis recovery
    broker.simulateRecovery();

    // Confirm automatic reconnection WITHOUT backend restart or manual connect calls
    const recovered = await waitFor(() => adapterA.connected && adapterB.connected);
    expect(recovered).toBe(true);
    expect(managerA.getStats().redisConnected).toBe(true);
    expect(managerB.getStats().redisConnected).toBe(true);

    // 6. Confirm cross-instance broadcasting resumes automatically after recovery
    adapterA.publish('share-purchases', { event: 'post-recovery-broadcast', amount: 500 });

    const receivedPostRecovery = await waitFor(() => remoteBroadcastsB.length === 2);
    expect(receivedPostRecovery).toBe(true);
    expect(remoteBroadcastsB[1].topic).toBe('share-purchases');
    expect(remoteBroadcastsB[1].message).toEqual({
      event: 'post-recovery-broadcast',
      amount: 500,
    });

    // Cleanup
    await adapterA.close();
    await adapterB.close();
  });

  test('recovers automatically when Redis was initially unreachable at startup', async () => {
    // Start in outage state (Redis unreachable at boot)
    broker.simulateOutage();

    const manager = new WebSocketManager();
    const adapter = new WebSocketRedisAdapter(manager, {
      instanceId: 'node-late-boot',
      reconnectInterval: 50,
      RedisClient: MockClientClass,
    });
    manager.redisAdapter = adapter;

    // Initial connect must not throw — degrades gracefully to single-node mode
    const initialConnected = await adapter.connect();
    expect(initialConnected).toBe(false);
    expect(adapter.connected).toBe(false);
    expect(manager.getStats().redisConnected).toBe(false);

    // Redis becomes reachable later
    broker.simulateRecovery();

    // Adapter should automatically reconnect in the background without manual restart
    const reconnected = await waitFor(() => adapter.connected);
    expect(reconnected).toBe(true);
    expect(manager.getStats().redisConnected).toBe(true);

    await adapter.close();
  });

  test('close() stops reconnection and disconnects cleanly', async () => {
    const manager = new WebSocketManager();
    const adapter = new WebSocketRedisAdapter(manager, {
      instanceId: 'node-closing',
      reconnectInterval: 50,
      RedisClient: MockClientClass,
    });

    await adapter.connect();
    expect(adapter.connected).toBe(true);

    await adapter.close();
    expect(adapter.closed).toBe(true);
    expect(adapter.connected).toBe(false);
    expect(adapter.pub).toBeNull();
    expect(adapter.sub).toBeNull();

    // Further outage/recovery events should not trigger reconnection on a closed adapter
    broker.simulateRecovery();
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(adapter.connected).toBe(false);
  });

  test('ignores self-originated messages to prevent broadcast loops', async () => {
    const manager = new WebSocketManager();
    let remoteCallCount = 0;
    manager.handleRemoteBroadcast = () => {
      remoteCallCount += 1;
    };

    const adapter = new WebSocketRedisAdapter(manager, {
      instanceId: 'same-node',
      reconnectInterval: 50,
      RedisClient: MockClientClass,
    });

    await adapter.connect();

    // Simulate incoming message with matching instanceId
    adapter.handleMessage(
      'ws:broadcast',
      JSON.stringify({ instanceId: 'same-node', topic: 'test', message: {} }),
    );
    expect(remoteCallCount).toBe(0);

    // Message with different instanceId is forwarded
    adapter.handleMessage(
      'ws:broadcast',
      JSON.stringify({ instanceId: 'different-node', topic: 'test', message: {} }),
    );
    expect(remoteCallCount).toBe(1);

    await adapter.close();
  });
});
