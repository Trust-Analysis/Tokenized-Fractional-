const { SubscriptionOptimizer } = require('../src/services/subscriptionOptimizer');

describe('SubscriptionOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new SubscriptionOptimizer({ batchInterval: 10, batchSize: 3 });
  });

  afterEach(() => {
    optimizer.destroy();
  });

  test('subscribes and unsubscribes', () => {
    const cb = jest.fn();
    optimizer.subscribe('user1', cb);
    expect(optimizer._stats.activeSubscriptions).toBe(1);
    optimizer.unsubscribe('user1');
    expect(optimizer._stats.activeSubscriptions).toBe(0);
  });

  test('batches payloads', (done) => {
    const cb = jest.fn();
    optimizer.subscribe('user1', cb);
    optimizer.publish('user1', { price: 100 });
    optimizer.publish('user1', { price: 101 });
    optimizer.publish('user1', { price: 102 });
    expect(cb).toHaveBeenCalledWith({ batch: [{ price: 100 }, { price: 101 }, { price: 102 }] });
    done();
  });

  test('flushes on batch size', () => {
    const cb = jest.fn();
    optimizer.subscribe('user1', cb);
    optimizer.publish('user1', { price: 1 });
    optimizer.publish('user1', { price: 2 });
    optimizer.publish('user1', { price: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(optimizer._stats.batchesSent).toBe(1);
  });

  test('returns stats', () => {
    optimizer.subscribe('user1', jest.fn());
    const stats = optimizer.getStats();
    expect(stats.activeSubscriptions).toBe(1);
    expect(stats.totalSubscriptions).toBe(1);
  });
});
