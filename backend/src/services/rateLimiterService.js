import { randomUUID } from 'crypto';

const TIERS = {
  free: {
    name: 'Free',
    windowMs: 60 * 1000,
    maxRequests: 100,
    burstCapacity: 20,
    burstReplenishMs: 1000,
    burstReplenishCount: 5,
    hourlyLimit: 1000,
    dailyLimit: 10000,
    concurrentLimit: 10,
    costPerRequest: 1,
    overageCostPerRequest: 0.001,
  },
  premium: {
    name: 'Premium',
    windowMs: 60 * 1000,
    maxRequests: 1000,
    burstCapacity: 200,
    burstReplenishMs: 500,
    burstReplenishCount: 20,
    hourlyLimit: 10000,
    dailyLimit: 100000,
    concurrentLimit: 50,
    costPerRequest: 0.5,
    overageCostPerRequest: 0.0005,
  },
  enterprise: {
    name: 'Enterprise',
    windowMs: 60 * 1000,
    maxRequests: 10000,
    burstCapacity: 2000,
    burstReplenishMs: 100,
    burstReplenishCount: 100,
    hourlyLimit: null,
    dailyLimit: null,
    concurrentLimit: 200,
    costPerRequest: 0.1,
    overageCostPerRequest: 0.0001,
  },
};

const TIER_ORDER = ['free', 'premium', 'enterprise'];

class SlidingWindowCounter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 100;
    this.requests = [];
  }

  allow() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    while (this.requests.length > 0 && this.requests[0] <= cutoff) {
      this.requests.shift();
    }
    if (this.requests.length >= this.maxRequests) {
      const oldest = this.requests[0];
      const resetMs = this.windowMs - (now - oldest);
      return { allowed: false, current: this.requests.length, resetMs };
    }
    this.requests.push(now);
    return { allowed: true, current: this.requests.length, resetMs: 0 };
  }

  get count() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    while (this.requests.length > 0 && this.requests[0] <= cutoff) {
      this.requests.shift();
    }
    return this.requests.length;
  }

  get resetTime() {
    if (this.requests.length === 0) return 0;
    return this.windowMs - (Date.now() - this.requests[0]);
  }
}

class TokenBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || 20;
    this.tokens = this.capacity;
    this.replenishRate = options.replenishRate || 5;
    this.replenishInterval = options.replenishInterval || 1000;
    this.lastReplenish = Date.now();
  }

  _replenish() {
    const now = Date.now();
    const elapsed = now - this.lastReplenish;
    if (elapsed >= this.replenishInterval) {
      const intervals = Math.floor(elapsed / this.replenishInterval);
      this.tokens = Math.min(this.capacity, this.tokens + intervals * this.replenishRate);
      this.lastReplenish = now - (elapsed % this.replenishInterval);
    }
  }

  tryConsume(count = 1) {
    this._replenish();
    if (this.tokens >= count) {
      this.tokens -= count;
      return { allowed: true, remaining: this.tokens };
    }
    return { allowed: false, remaining: this.tokens };
  }

  get remaining() {
    this._replenish();
    return this.tokens;
  }
}

class RateLimitRecord {
  constructor(apiKey, tier = 'free') {
    this.apiKey = apiKey;
    this.tier = tier;
    this.config = TIERS[tier] || TIERS.free;
    this.slidingWindow = new SlidingWindowCounter({
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests,
    });
    this.burstBucket = new TokenBucket({
      capacity: this.config.burstCapacity,
      replenishRate: this.config.burstReplenishCount,
      replenishInterval: this.config.burstReplenishMs,
    });
    this.hourlyWindow = new SlidingWindowCounter({
      windowMs: 3600000,
      maxRequests: this.config.hourlyLimit || Infinity,
    });
    this.dailyWindow = new SlidingWindowCounter({
      windowMs: 86400000,
      maxRequests: this.config.dailyLimit || Infinity,
    });
    this.concurrent = 0;
    this.concurrentMax = this.config.concurrentLimit;
    this.createdAt = Date.now();
    this.totalRequests = 0;
    this.totalBlocked = 0;
    this.lastRequestAt = null;
  }

  check() {
    const now = Date.now();
    this.totalRequests++;
    this.lastRequestAt = now;

    if (this.concurrent >= this.concurrentMax) {
      this.totalBlocked++;
      return { allowed: false, reason: 'concurrent_limit', status: 429 };
    }

    const windowResult = this.slidingWindow.allow();
    if (!windowResult.allowed) {
      this.totalBlocked++;
      return {
        allowed: false,
        reason: 'rate_limit',
        status: 429,
        resetMs: windowResult.resetMs,
        current: windowResult.current,
        limit: this.config.maxRequests,
      };
    }

    const burstResult = this.burstBucket.tryConsume();
    if (!burstResult.allowed) {
      this.totalBlocked++;
      return {
        allowed: false,
        reason: 'burst_limit',
        status: 429,
        remaining: burstResult.remaining,
      };
    }

    if (this.config.hourlyLimit) {
      const hourlyResult = this.hourlyWindow.allow();
      if (!hourlyResult.allowed) {
        this.totalBlocked++;
        return { allowed: false, reason: 'hourly_limit', status: 429, resetMs: hourlyResult.resetMs };
      }
    }

    if (this.config.dailyLimit) {
      const dailyResult = this.dailyWindow.allow();
      if (!dailyResult.allowed) {
        this.totalBlocked++;
        return { allowed: false, reason: 'daily_limit', status: 429, resetMs: dailyResult.resetMs };
      }
    }

    return { allowed: true, status: 200 };
  }

  release() {
    this.concurrent = Math.max(0, this.concurrent - 1);
  }

  acquire() {
    this.concurrent++;
  }

  get headers() {
    return {
      'X-RateLimit-Limit': String(this.config.maxRequests),
      'X-RateLimit-Remaining': String(Math.max(0, this.config.maxRequests - this.slidingWindow.count)),
      'X-RateLimit-Reset': String(Math.ceil((Date.now() + this.slidingWindow.resetTime) / 1000)),
      'X-RateLimit-Burst-Remaining': String(this.burstBucket.remaining),
      'X-RateLimit-Tier': this.config.name,
      'X-RateLimit-Concurrent': String(this.concurrent),
      'X-RateLimit-Concurrent-Max': String(this.concurrentMax),
    };
  }

  get stats() {
    return {
      apiKey: this.apiKey,
      tier: this.tier,
      totalRequests: this.totalRequests,
      totalBlocked: this.totalBlocked,
      currentWindowCount: this.slidingWindow.count,
      burstRemaining: this.burstBucket.remaining,
      concurrent: this.concurrent,
      hourlyRemaining: this.config.hourlyLimit
        ? Math.max(0, this.config.hourlyLimit - this.hourlyWindow.count)
        : null,
      dailyRemaining: this.config.dailyLimit
        ? Math.max(0, this.config.dailyLimit - this.dailyWindow.count)
        : null,
      createdAt: this.createdAt,
      lastRequestAt: this.lastRequestAt,
    };
  }
}

export class RateLimiterService {
  constructor(options = {}) {
    this.records = new Map();
    this.apiKeyTiers = new Map();
    this.logger = options.logger || console;
    this.analytics = options.analytics || null;
    this.anomalyDetector = options.anomalyDetector || null;
    this.geoLimiter = options.geoLimiter || null;
    this.billingService = options.billingService || null;

    this._initTiersFromEnv();
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
  }

  _initTiersFromEnv() {
    const tiersEnv = process.env.RATE_LIMIT_TIERS;
    if (tiersEnv) {
      try {
        const custom = JSON.parse(tiersEnv);
        for (const [tier, config] of Object.entries(custom)) {
          if (TIERS[tier]) {
            Object.assign(TIERS[tier], config);
          }
        }
      } catch {
        this.logger.warn('Invalid RATE_LIMIT_TIERS env format, using defaults');
      }
    }
  }

  configureApiKey(apiKey, tier = 'free', options = {}) {
    if (!TIERS[tier]) {
      throw new Error(`Invalid tier: ${tier}. Must be one of: ${Object.keys(TIERS).join(', ')}`);
    }
    this.apiKeyTiers.set(apiKey, { tier, ...options });
    if (this.records.has(apiKey)) {
      this.records.get(apiKey).tier = tier;
      this.records.get(apiKey).config = TIERS[tier];
    }
    this.logger.info({ apiKey: apiKey.slice(0, 8) + '...', tier }, 'API key tier configured');
  }

  getTier(apiKey) {
    const mapping = this.apiKeyTiers.get(apiKey);
    return mapping?.tier || 'free';
  }

  getTierConfig(tier) {
    return TIERS[tier] || TIERS.free;
  }

  getAvailableTiers() {
    return TIER_ORDER.map(t => ({
      id: t,
      name: TIERS[t].name,
      ...TIERS[t],
    }));
  }

  getUpgradePath(currentTier) {
    const idx = TIER_ORDER.indexOf(currentTier);
    if (idx === -1 || idx >= TIER_ORDER.length - 1) return null;
    return TIER_ORDER.slice(idx + 1).map(t => ({
      id: t,
      name: TIERS[t].name,
      maxRequests: TIERS[t].maxRequests,
      burstCapacity: TIERS[t].burstCapacity,
      hourlyLimit: TIERS[t].hourlyLimit,
      costPerRequest: TIERS[t].costPerRequest,
    }));
  }

  _getRecord(apiKey) {
    if (!this.records.has(apiKey)) {
      const tier = this.getTier(apiKey);
      this.records.set(apiKey, new RateLimitRecord(apiKey, tier));
    }
    return this.records.get(apiKey);
  }

  async checkRateLimit(apiKey, options = {}) {
    const {
      ip,
      geo,
      userAgent,
      path,
      method,
    } = options;

    if (this.anomalyDetector && ip) {
      const anomalyCheck = await this.anomalyDetector.check({
        apiKey,
        ip,
        userAgent,
        path,
        method,
      });
      if (anomalyCheck.blocked) {
        if (this.analytics) {
          await this.analytics.logBlocked({
            apiKey, ip, reason: 'anomaly_detected',
            confidence: anomalyCheck.confidence,
            details: anomalyCheck.details,
          });
        }
        return {
          allowed: false,
          status: 429,
          reason: 'anomaly_detected',
          retryAfter: 300,
          headers: this._buildBlockHeaders(anomalyCheck),
        };
      }
    }

    if (this.geoLimiter && ip && geo) {
      const geoCheck = await this.geoLimiter.check(ip, geo, apiKey);
      if (geoCheck.blocked) {
        if (this.analytics) {
          await this.analytics.logBlocked({
            apiKey, ip, reason: 'geo_blocked',
            country: geoCheck.country,
          });
        }
        return {
          allowed: false,
          status: 403,
          reason: 'geo_blocked',
          retryAfter: null,
          headers: { 'X-RateLimit-Geo-Blocked': 'true' },
        };
      }
    }

    const record = this._getRecord(apiKey);
    record.acquire();

    try {
      const result = record.check();

      const responseHeaders = {
        ...record.headers,
        'X-RateLimit-Request-Cost': String(TIERS[record.tier]?.costPerRequest || 1),
        'X-RateLimit-Tier-Name': TIERS[record.tier]?.name || 'Free',
      };

      if (!result.allowed) {
        if (this.analytics) {
          await this.analytics.logBlocked({
            apiKey, ip, reason: result.reason,
            tier: record.tier,
            currentCount: result.current,
            limit: result.limit,
          });
        }

        const upgradePath = this.getUpgradePath(record.tier);
        const upgradePrompt = upgradePath ? {
          upgradeAvailable: true,
          tiers: upgradePath,
          message: `You've hit your ${TIERS[record.tier]?.name} tier rate limit. Upgrade for higher limits.`,
        } : {
          upgradeAvailable: false,
          message: 'Rate limit exceeded. Please wait and retry.',
        };

        let retryAfter = 60;
        if (result.resetMs) {
          retryAfter = Math.ceil(result.resetMs / 1000);
        }

        return {
          allowed: false,
          status: result.status,
          reason: result.reason,
          retryAfter,
          headers: responseHeaders,
          upgradePrompt,
        };
      }

      if (this.analytics) {
        await this.analytics.logRequest({
          apiKey, ip, geo, path, method,
          tier: record.tier,
          windowCount: result.current,
        });
      }

      const usage = record.stats;
      const usageRatio = usage.totalRequests > 0
        ? usage.totalBlocked / usage.totalRequests
        : 0;

      if (usageRatio > 0.1 && this.billingService) {
        this.billingService.suggestUpgrade(apiKey, record.tier, usage).catch(() => {});
      }

      return {
        allowed: true,
        status: 200,
        headers: responseHeaders,
      };
    } finally {
      record.release();
    }
  }

  _buildBlockHeaders(anomalyCheck) {
    return {
      'X-RateLimit-Anomaly': 'true',
      'X-RateLimit-Anomaly-Confidence': String(anomalyCheck.confidence || 0),
      'Retry-After': '300',
    };
  }

  getStats(apiKey) {
    const record = this.records.get(apiKey);
    if (!record) return null;
    return record.stats;
  }

  getAllStats() {
    const stats = [];
    for (const [apiKey, record] of this.records) {
      stats.push(record.stats);
    }
    return stats;
  }

  async resetKey(apiKey) {
    this.records.delete(apiKey);
    if (this.analytics) {
      await this.analytics.logEvent('rate_limit.reset', { apiKey });
    }
  }

  updateTierConfig(tier, config) {
    if (!TIERS[tier]) {
      throw new Error(`Invalid tier: ${tier}`);
    }
    Object.assign(TIERS[tier], config);
    for (const [, record] of this.records) {
      if (record.tier === tier) {
        record.config = TIERS[tier];
      }
    }
    this.logger.info({ tier, config }, 'Tier configuration updated');
  }

  _cleanup() {
    const cutoff = Date.now() - 86400000;
    for (const [apiKey, record] of this.records) {
      if (!record.lastRequestAt || record.lastRequestAt < cutoff) {
        if (record.totalRequests === 0 || record.lastRequestAt < cutoff) {
          this.records.delete(apiKey);
        }
      }
    }
  }

  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
  }
}
