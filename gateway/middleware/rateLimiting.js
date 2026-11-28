/**
 * Rate Limiting and Throttling Policies
 * Implements sliding window, token bucket, and leaky bucket algorithms
 */

/**
 * Rate limiting configuration by tier
 */
export const RATE_LIMIT_TIERS = {
  // Free tier - public endpoints
  free: {
    window: 3600, // 1 hour in seconds
    requests: 100,
    burstSize: 10,
  },
  // Basic tier - authenticated users
  basic: {
    window: 3600,
    requests: 1000,
    burstSize: 100,
  },
  // Professional tier - enterprise customers
  professional: {
    window: 3600,
    requests: 10000,
    burstSize: 1000,
  },
  // Enterprise tier - dedicated accounts
  enterprise: {
    window: 3600,
    requests: 100000,
    burstSize: 10000,
  },
  // Admin tier - internal services
  admin: {
    window: 3600,
    requests: Infinity,
    burstSize: Infinity,
  },
};

/**
 * Endpoint-specific rate limits
 */
export const ENDPOINT_RATE_LIMITS = {
  'GET:/api/rwa': {
    default: 60,        // 60 req/min
    burst: 5,           // Allow 5 requests in 1 second
    window: 60,
  },
  'GET:/api/rwa/:contractId': {
    default: 60,
    burst: 5,
    window: 60,
  },
  'POST:/api/rwa': {
    default: 10,        // 10 req/min for write operations
    burst: 2,
    window: 60,
  },
  'DELETE:/api/rwa/:contractId': {
    default: 5,         // 5 req/min for delete operations
    burst: 1,
    window: 60,
  },
};

/**
 * Sliding window rate limiter using in-memory storage
 * For production, use Redis
 */
class SlidingWindowLimiter {
  constructor() {
    this.requests = new Map();
  }

  /**
   * Check if request should be allowed
   */
  isAllowed(key, limit, windowSeconds) {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key);

    // Remove old requests outside window
    const validTimestamps = timestamps.filter(t => t > windowStart);

    if (validTimestamps.length >= limit) {
      return false;
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);

    // Cleanup old entries
    if (this.requests.size > 10000) {
      for (const [k, v] of this.requests.entries()) {
        if (v.filter(t => t > windowStart).length === 0) {
          this.requests.delete(k);
        }
      }
    }

    return true;
  }

  getRemainingRequests(key, limit, windowSeconds) {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    if (!this.requests.has(key)) {
      return limit;
    }

    const validTimestamps = this.requests.get(key).filter(t => t > windowStart);
    return Math.max(0, limit - validTimestamps.length);
  }

  getResetTime(key, windowSeconds) {
    const now = Date.now();

    if (!this.requests.has(key) || this.requests.get(key).length === 0) {
      return Math.ceil(now / 1000) + windowSeconds;
    }

    const oldest = Math.min(...this.requests.get(key));
    return Math.ceil(oldest / 1000) + windowSeconds;
  }
}

/**
 * Token bucket rate limiter
 * Allows for bursts while maintaining overall rate
 */
class TokenBucketLimiter {
  constructor() {
    this.buckets = new Map();
  }

  /**
   * Check if request should be allowed
   */
  isAllowed(key, capacity, refillRate, tokensNeeded = 1) {
    const now = Date.now() / 1000;

    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: capacity,
        lastRefill: now,
      });
    }

    const bucket = this.buckets.get(key);

    // Calculate tokens to add based on time passed
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * refillRate;
    bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= tokensNeeded) {
      bucket.tokens -= tokensNeeded;
      return true;
    }

    return false;
  }

  getRemainingTokens(key, capacity, refillRate) {
    if (!this.buckets.has(key)) {
      return capacity;
    }

    const now = Date.now() / 1000;
    const bucket = this.buckets.get(key);

    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * refillRate;
    return Math.min(capacity, bucket.tokens + tokensToAdd);
  }
}

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(options = {}) {
  const {
    limiter = 'sliding-window',
    keyGenerator = (req) => req.ip || req.connection.remoteAddress,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  const limiters = {
    'sliding-window': new SlidingWindowLimiter(),
    'token-bucket': new TokenBucketLimiter(),
  };

  const activeLimiter = limiters[limiter];

  return (limit, windowSeconds) => {
    return (req, res, next) => {
      // Skip if conditions met
      if (skipSuccessfulRequests && res.statusCode < 400) {
        return next();
      }
      if (skipFailedRequests && res.statusCode >= 400) {
        return next();
      }

      const key = keyGenerator(req);
      let isAllowed = false;
      let remaining = 0;
      let resetTime = 0;

      if (limiter === 'token-bucket') {
        const capacity = limit * windowSeconds;
        const refillRate = limit / windowSeconds;
        isAllowed = activeLimiter.isAllowed(key, capacity, refillRate);
        remaining = Math.floor(activeLimiter.getRemainingTokens(key, capacity, refillRate));
      } else {
        isAllowed = activeLimiter.isAllowed(key, limit, windowSeconds);
        remaining = activeLimiter.getRemainingRequests(key, limit, windowSeconds);
        resetTime = activeLimiter.getResetTime(key, windowSeconds);
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime || Math.ceil(Date.now() / 1000) + windowSeconds);
      res.setHeader('X-Request-ID', req.requestId);

      if (!isAllowed) {
        res.setHeader('Retry-After', Math.ceil((resetTime || 0) - Math.ceil(Date.now() / 1000)));
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: res.getHeader('Retry-After'),
          requestId: req.requestId,
        });
      }

      next();
    };
  };
}

/**
 * Get rate limit tier for user
 */
export function getUserTier(req) {
  // API key users are assumed to be authenticated
  if (req.auth?.method === 'api-key') {
    // Check against database for tier mapping
    return process.env.DEFAULT_TIER || 'basic';
  }

  // JWT users
  if (req.auth?.method === 'jwt') {
    return req.auth.decoded?.tier || 'basic';
  }

  // Public/anonymous users
  return 'free';
}

/**
 * Apply per-endpoint rate limits
 */
export function applyEndpointLimit(req, res, next) {
  const endpoint = `${req.method}:${req.route?.path || req.path}`;
  const config = ENDPOINT_RATE_LIMITS[endpoint];

  if (!config) {
    return next();
  }

  const tier = getUserTier(req);
  const tierConfig = RATE_LIMIT_TIERS[tier];

  if (!tierConfig || tierConfig.requests === Infinity) {
    return next();
  }

  // Calculate effective limit for this endpoint
  const effectiveLimit = Math.min(config.default, tierConfig.requests);

  const limiter = createRateLimiter({
    limiter: 'sliding-window',
  });

  limiter(effectiveLimit, config.window)(req, res, next);
}

/**
 * Apply tier-based rate limits
 */
export function applyTierLimit(req, res, next) {
  const tier = getUserTier(req);
  const config = RATE_LIMIT_TIERS[tier];

  if (!config || config.requests === Infinity) {
    return next();
  }

  const limiter = createRateLimiter({
    limiter: 'sliding-window',
  });

  limiter(config.requests, config.window)(req, res, next);
}

/**
 * Combine endpoint and tier-based limiting
 */
export function applyDualLimit(req, res, next) {
  applyTierLimit(req, res, () => {
    applyEndpointLimit(req, res, next);
  });
}
