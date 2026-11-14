// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/geoLimiter.js — Geographic request limiting.
 *
 * Two modes of per-country request counting:
 *
 * 1. **Shared store (Redis)** — the default whenever REDIS_URL is configured
 *    (or a Redis client is injected via `options.redis`). Counts live in a
 *    Redis sorted set, one per restricted country, so every backend replica
 *    (see `k8s/backend-deployment.yaml`) enforces the *same* limit instead of
 *    each pod silently multiplying the configured limit by its replica count
 *    (Issue #882).
 *
 * 2. **In-memory fallback** — used when Redis is not configured or becomes
 *    unreachable. Behaviour matches the previous implementation: counts are
 *    local to the process and limits are enforced per pod. This keeps the
 *    limiter functional during a Redis outage, but a warning is logged so the
 *    degradation is visible.
 *
 * The same sliding window is used in both modes: a config-driven request
 * allowance per restricted country over a one-hour window.
 */

const WINDOW_MS = 3600000; // one hour

export const GEO_COUNT_KEY_PREFIX = 'geolimiter:country_counts';

/** Redis key holding the request-timestamp sorted set for `country`. */
export function countryCountsKey(country, prefix = GEO_COUNT_KEY_PREFIX) {
  return `${prefix}:${country}`;
}

export class GeoLimiter {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.enabled = process.env.GEO_LIMITING_ENABLED !== 'false';
    this.db = options.db || null;

    this.blockedCountries = new Set(
      (process.env.GEO_BLOCKED_COUNTRIES || '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    );

    this.restrictedCountries = new Map();
    const restrictedRaw = process.env.GEO_RESTRICTED_COUNTRIES || '';
    if (restrictedRaw) {
      for (const entry of restrictedRaw.split(',')) {
        const [country, limit] = entry.split(':');
        if (country && limit) {
          this.restrictedCountries.set(country.trim().toUpperCase(), parseInt(limit) || 100);
        }
      }
    }

    // In-memory mirror of recent counts. It is the authoritative store when
    // Redis is unavailable, and a per-process stats copy in shared mode
    // (getCountryStats remains a synchronous, local view).
    this.countryRequestCounts = new Map();
    this.tierCountryOverrides = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), 300000);

    this.keyPrefix = options.keyPrefix || GEO_COUNT_KEY_PREFIX;

    this._injectedReader = options.redis || null;
    this.redisUrl =
      options.redisUrl !== undefined ? options.redisUrl : process.env.REDIS_URL || null;
    this._autoRedis = null;
    this._sharedBroken = false;
  }

  /**
   * Returns the client backing the shared store, or null when the limiter is
   * running in memory-only mode. Any client error flips `this._sharedBroken`
   * so subsequent checks stop retrying and silently fall back to memory.
   */
  async _getSharedClient() {
    if (this._sharedBroken) return null;
    if (this._injectedReader) return this._injectedReader;
    if (!this.redisUrl) return null;
    if (!this._autoRedis) {
      try {
        const { default: Redis } = await import('ioredis');
        this._autoRedis = new Redis(this.redisUrl, {
          lazyConnect: true,
          connectTimeout: 2000,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: (times) => (times < 3 ? 500 : null),
        });
        this._autoRedis.on('error', (err) => {
          this.logger.warn?.(
            { error: err.message },
            'GeoLimiter shared store error; falling back to per-process memory',
          );
        });
      } catch (err) {
        this.logger.warn?.({ error: err.message }, 'Failed to initialise GeoLimiter shared store');
        this._sharedBroken = true;
        return null;
      }
    }
    return this._autoRedis;
  }

  /** True when the effective shared client is an ioredis instance we created. */
  get usesSharedStore() {
    return Boolean(this._injectedReader || this._autoRedis) && !this._sharedBroken;
  }

  setTierCountryOverride(tier, country, action) {
    if (!this.tierCountryOverrides.has(tier)) {
      this.tierCountryOverrides.set(tier, new Map());
    }
    this.tierCountryOverrides.get(tier).set(country.toUpperCase(), action);
  }

  async check(ip, geo, apiKey) {
    if (!this.enabled) return { blocked: false };

    const result = { blocked: false, country: geo?.country || 'unknown', reason: null };

    if (!geo?.country) return result;

    const country = geo.country.toUpperCase();

    if (this.blockedCountries.has(country)) {
      result.blocked = true;
      result.reason = 'country_blocked';
      return result;
    }

    const restrictedLimit = this.restrictedCountries.get(country);
    if (restrictedLimit) {
      const allowed = await this._enforceCountryLimit(country, restrictedLimit);
      if (!allowed) {
        result.blocked = true;
        result.reason = 'country_rate_limited';
        return result;
      }
    }

    return result;
  }

  /**
   * Sliding-window count for one restricted country.
   *
   * Returns true when the request is allowed (and recorded, if under limit),
   * false when the country already reached `limit` requests inside the window.
   */
  async _enforceCountryLimit(country, limit) {
    const now = Date.now();
    const client = await this._getSharedClient();

    if (client) {
      try {
        const key = countryCountsKey(country, this.keyPrefix);
        // Drop timestamps older than the window, then count what is left.
        // Members are unique (timestamp + random suffix) so bursts inside the
        // same millisecond are counted individually.
        const removed = await client.zremrangebyscore(key, '-inf', now - WINDOW_MS);
        if (typeof removed === 'string') {
          throw new Error(`unexpected response from zremrangebyscore: ${removed}`);
        }
        const recent = await client.zcard(key);

        if (recent >= limit) return false;

        await client.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 10)}`);
        await client.pexpire(key, WINDOW_MS);

        // Keep the local mirror in sync for getCountryStats().
        this._recordLocal(country, now);
        return true;
      } catch (err) {
        if (!this._sharedBroken) {
          this.logger.warn?.(
            { error: err.message, country },
            'GeoLimiter shared store failed; degrading to per-process memory counts',
          );
        }
        this._sharedBroken = true;
        // fall through to the in-memory path
      }
    }

    // In-memory (fallback or memory-only) mode.
    const recent = this._recentLocal(country, now);
    if (recent.length >= limit) return false;
    this._recordLocal(country, now);
    return true;
  }

  _recentLocal(country, now = Date.now()) {
    const counts = this.countryRequestCounts.get(country) || [];
    return counts.filter((t) => now - t < WINDOW_MS);
  }

  _recordLocal(country, now = Date.now()) {
    const recent = this._recentLocal(country, now);
    const limit = this.restrictedCountries.get(country) || 100;
    recent.push(now);
    this.countryRequestCounts.set(country, recent.slice(-limit * 2));
  }

  getCountryStats() {
    // Per-process view: in shared mode the authoritative counts live in Redis;
    // this reflects the requests seen by *this* pod (via the local mirror).
    const stats = {};
    for (const [country, counts] of this.countryRequestCounts) {
      const now = Date.now();
      const recent = counts.filter((t) => now - t < WINDOW_MS);
      stats[country] = {
        requestsLastHour: recent.length,
        blocked: this.blockedCountries.has(country),
        restricted: this.restrictedCountries.has(country),
        limit: this.restrictedCountries.get(country) || null,
      };
    }
    return stats;
  }

  _cleanup() {
    const now = Date.now();
    for (const [country, counts] of this.countryRequestCounts) {
      const recent = counts.filter((t) => now - t < WINDOW_MS);
      if (recent.length === 0) {
        this.countryRequestCounts.delete(country);
      } else {
        this.countryRequestCounts.set(country, recent);
      }
    }
  }

  destroy() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    this.countryRequestCounts.clear();
    // Only disconnect a client this instance created; injected clients belong
    // to their owner.
    if (this._autoRedis) {
      this._autoRedis.disconnect();
      this._autoRedis = null;
    }
  }
}
