// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * GeoLimiter tests (Issue #882)
 *
 * Verifies that per-country request counts live in a shared store so limits
 * are enforced consistently across backend replicas, with an in-memory
 * fallback when the shared store is unavailable.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { GeoLimiter, countryCountsKey } from '../src/services/geoLimiter.js';

/**
 * Minimal sorted-set with the ioredis command surface GeoLimiter uses.
 * Two GeoLimiter instances can share one instance to simulate two pods
 * pointing at the same Redis.
 */
class FakeRedis {
  constructor() {
    this.zsets = new Map(); // key -> Map(member -> score)
    this.expiries = new Map(); // key -> expiry timestamp (metadata only)
    this.expectFailure = false;
  }

  _zset(key) {
    if (this.expectFailure) throw new Error('store unavailable');
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key);
  }

  async zremrangebyscore(key, min, max) {
    // GeoLimiter must use '-inf' as the lower bound so stale entries go away.
    if (min !== '-inf') throw new Error(`test failure: expected lower bound '-inf', got ${min}`);
    const set = this._zset(key);
    let removed = 0;
    for (const [member, score] of Array.from(set.entries())) {
      if (score <= max) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  async zcard(key) {
    return this._zset(key).size;
  }

  async zadd(key, score, member) {
    this._zset(key).set(member, score);
    return 1;
  }

  async pexpire(key, ms) {
    // Real clients reset the key TTL on every write; we track it for parity.
    this.expiries.set(key, Date.now() + ms);
    return 1;
  }
}

describe('GeoLimiter (Issue #882: shared backing store across replicas)', () => {
  const ORIGINAL_GEO_RESTRICTED = process.env.GEO_RESTRICTED_COUNTRIES;
  const ORIGINAL_GEO_BLOCKED = process.env.GEO_BLOCKED_COUNTRIES;
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  let created = [];

  function makeLimiter(overrides = {}) {
    const limiter = new GeoLimiter({ logger: console, ...overrides });
    created.push(limiter);
    return limiter;
  }

  beforeEach(() => {
    created = [];
    process.env.GEO_RESTRICTED_COUNTRIES = 'NG:2'; // limit 2 requests/hour
    process.env.GEO_BLOCKED_COUNTRIES = '';
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    created.forEach((l) => l.destroy());
    created = [];

    if (ORIGINAL_GEO_RESTRICTED === undefined) delete process.env.GEO_RESTRICTED_COUNTRIES;
    else process.env.GEO_RESTRICTED_COUNTRIES = ORIGINAL_GEO_RESTRICTED;
    if (ORIGINAL_GEO_BLOCKED === undefined) delete process.env.GEO_BLOCKED_COUNTRIES;
    else process.env.GEO_BLOCKED_COUNTRIES = ORIGINAL_GEO_BLOCKED;
    if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = ORIGINAL_REDIS_URL;

    jest.restoreAllMocks();
  });

  const geoNG = { country: 'NG' };

  it('counts are enforced across two instances sharing one backing store', async () => {
    // Two "pods" sharing one Redis-equivalent store.
    const store = new FakeRedis();
    const podA = makeLimiter({ redis: store });
    const podB = makeLimiter({ redis: store });

    expect(await podA.check('1.1.1.1', geoNG)).toEqual({
      blocked: false,
      country: 'NG',
      reason: null,
    });
    expect(await podB.check('2.2.2.2', geoNG)).toEqual({
      blocked: false,
      country: 'NG',
      reason: null,
    });

    // Third request overall (split across pods) must be limited: the shared
    // store is consulted, not the per-instance memory.
    const third = await podA.check('3.3.3.3', geoNG);
    expect(third).toEqual({ blocked: true, country: 'NG', reason: 'country_rate_limited' });

    // Same view from the other pod.
    expect((await podB.check('4.4.4.4', geoNG)).blocked).toBe(true);

    // Only two timestamps were recorded in the shared key.
    expect(store.zsets.get(countryCountsKey('NG')).size).toBe(2);
  });

  it('tolerates bursts inside the same millisecond (unique members)', async () => {
    const store = new FakeRedis();
    const pod = makeLimiter({ redis: store, redisUrl: null });

    const first = await pod.check('1.1.1.1', geoNG);
    const second = await pod.check('1.1.1.2', geoNG);
    expect(first.blocked).toBe(false);
    expect(second.blocked).toBe(false);

    const third = await pod.check('1.1.1.3', geoNG);
    expect(third.blocked).toBe(true);
  });

  it('ignores requests outside the sliding window', async () => {
    const store = new FakeRedis();
    const pod = makeLimiter({ redis: store });

    expect((await pod.check('1.1.1.1', geoNG)).blocked).toBe(false);
    const key = countryCountsKey('NG');

    // Simulate an entry that happened 2 hours ago (outside the 1h window).
    store.zsets.set(key, new Map([['stale', Date.now() - 2 * 3600000]]));

    expect((await pod.check('1.1.1.2', geoNG)).blocked).toBe(false);
  });

  it('falls back to in-memory counting when the shared store fails', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new FakeRedis();
    store.expectFailure = true;

    const podA = makeLimiter({ redis: store });
    const podB = makeLimiter({ redis: store });

    expect((await podA.check('1.1.1.1', geoNG)).blocked).toBe(false);
    expect((await podA.check('1.1.1.2', geoNG)).blocked).toBe(false);
    expect((await podA.check('1.1.1.3', geoNG)).blocked).toBe(true);

    // Degradation is logged so it is visible to operators.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'NG' }),
      expect.stringContaining('degrading to per-process memory counts'),
    );

    // In fallback mode counts are local, so pod B has its own (independent) limit.
    expect((await podB.check('2.2.2.2', geoNG)).blocked).toBe(false);
    expect(podA.usesSharedStore).toBe(false);
  });

  it('still enforces limits without Redis (memory-only mode)', async () => {
    const pod = makeLimiter({});

    expect((await pod.check('1.1.1.1', geoNG)).blocked).toBe(false);
    expect((await pod.check('1.1.1.2', geoNG)).blocked).toBe(false);
    expect((await pod.check('1.1.1.3', geoNG)).blocked).toBe(true);

    expect(pod.usesSharedStore).toBe(false);

    const stats = pod.getCountryStats();
    expect(stats.NG).toMatchObject({ requestsLastHour: 2, restricted: true, limit: 2 });
  });

  it('blocked countries take precedence and are not counted', async () => {
    process.env.GEO_BLOCKED_COUNTRIES = 'RU';
    const store = new FakeRedis();
    const pod = makeLimiter({ redis: store });

    const result = await pod.check('9.9.9.9', { country: 'RU' });
    expect(result).toEqual({ blocked: true, country: 'RU', reason: 'country_blocked' });
    expect(store.zsets.size).toBe(0);
  });

  it('destroy() clears local counts but leaves injected clients untouched', async () => {
    const store = new FakeRedis();
    const pod = makeLimiter({ redis: store });
    await pod.check('1.1.1.1', geoNG);
    await pod.check('1.1.1.2', geoNG);

    pod.destroy();
    expect(pod.countryRequestCounts.size).toBe(0);
    // Injected store remains usable: the shared counts survive it.
    const again = await (async () => {
      const pod2 = makeLimiter({ redis: store });
      return pod2.check('1.1.1.2', geoNG);
    })();
    expect(again.blocked).toBe(true);
  });
});
