// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/tieredRateLimiter.js — Tiered rate limiting with Redis support
 *
 * Implements different rate limits for:
 * - Anonymous users (lowest limits)
 * - Authenticated users (medium limits)
 * - Admin users (highest limits)
 *
 * Uses Redis for distributed rate limiting across multiple instances.
 * Falls back to memory-based limiting if Redis is unavailable.
 */

import Redis from 'ioredis';
import { logger } from '../services/logger.js';
import { REDIS_URL, NODE_ENV } from '../config.js';

/**
 * Rate limit tiers with different windows and thresholds
 */
const RATE_LIMIT_TIERS = {
  anonymous: {
    name: 'Anonymous User',
    read: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 50, // 50 requests per 15 min = 3.33 req/sec
    },
    write: {
      windowMs: 15 * 60 * 1000,
      max: 10, // 10 write requests per 15 min = 0.67 req/sec
    },
  },
  authenticated: {
    name: 'Authenticated User',
    read: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 500, // 500 requests per 15 min = 33.3 req/sec
    },
    write: {
      windowMs: 15 * 60 * 1000,
      max: 100, // 100 write requests per 15 min = 6.67 req/sec
    },
  },
  admin: {
    name: 'Admin User',
    read: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5000, // 5000 requests per 15 min = 333 req/sec
    },
    write: {
      windowMs: 15 * 60 * 1000,
      max: 1000, // 1000 write requests per 15 min = 67 req/sec
    },
  },
};

/**
 * Rate limit tiers for test environment (relaxed)
 */
const TEST_RATE_LIMIT_TIERS = {
  anonymous: {
    name: 'Anonymous User (Test)',
    read: { windowMs: 60 * 1000, max: 10000 },
    write: { windowMs: 60 * 1000, max: 10000 },
  },
  authenticated: {
    name: 'Authenticated User (Test)',
    read: { windowMs: 60 * 1000, max: 10000 },
    write: { windowMs: 60 * 1000, max: 10000 },
  },
  admin: {
    name: 'Admin User (Test)',
    read: { windowMs: 60 * 1000, max: 10000 },
    write: { windowMs: 60 * 1000, max: 10000 },
  },
};

const TIERS = NODE_ENV === 'test' ? TEST_RATE_LIMIT_TIERS : RATE_LIMIT_TIERS;

/**
 * Redis client for distributed rate limiting
 */
let redisClient = null;
let redisConnected = false;

/**
 * Initialize Redis client if URL is provided
 */
export async function initializeRedisLimiter() {
  if (!REDIS_URL) {
    logger.info('Redis not configured, using in-memory rate limiting');
    return false;
  }

  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      enableReadyCheck: false,
    });

    redisClient.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis rate limiter error');
      redisConnected = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis rate limiter connected');
      redisConnected = true;
    });

    redisClient.on('disconnect', () => {
      logger.warn('Redis rate limiter disconnected, falling back to memory');
      redisConnected = false;
    });

    await redisClient.connect();
    redisConnected = true;
    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Redis rate limiter');
    redisClient = null;
    redisConnected = false;
    return false;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedisLimiter() {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = null;
    redisConnected = false;
  }
}

/**
 * In-memory store for rate limiting (fallback when Redis unavailable)
 * { key: { count, resetTime } }
 */
const memoryStore = new Map();

/**
 * Get current count and reset time for a rate limit key
 */
async function getRateLimitInfo(key, windowMs) {
  if (redisConnected && redisClient) {
    try {
      const count = await redisClient.incr(key);
      const ttl = await redisClient.ttl(key);

      if (ttl === -1) {
        // First time seeing this key, set TTL
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

      return { count, ttl };
    } catch (error) {
      logger.warn({ error: error.message, key }, 'Redis rate limit check failed, falling back to memory');
      redisConnected = false;
      // Fall through to memory store
    }
  }

  // Memory-based fallback
  const now = Date.now();
  let entry = memoryStore.get(key);

  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs };
    memoryStore.set(key, entry);
  }

  entry.count += 1;
  const remainingMs = entry.resetTime - now;
  const ttl = Math.ceil(remainingMs / 1000);

  return { count: entry.count, ttl };
}

/**
 * Determine user tier based on request context
 */
function getUserTier(req) {
  // Admin has API key
  if (req.apiKey) {
    return 'admin';
  }

  // Authenticated user has wallet address from Freighter or other auth
  if (req.user || req.wallet) {
    return 'authenticated';
  }

  // Default to anonymous
  return 'anonymous';
}

/**
 * Create a tiered rate limiter middleware
 *
 * @param {string} type - 'read' or 'write'
 * @returns {Function} Express middleware
 */
export function createTieredRateLimiter(type = 'read') {
  if (!['read', 'write'].includes(type)) {
    throw new Error('Rate limiter type must be "read" or "write"');
  }

  return async (req, res, next) => {
    try {
      const tier = getUserTier(req);
      const limits = TIERS[tier][type];
      const identifier = req.ip || req.connection.remoteAddress || 'unknown';

      // Create unique key for this user/ip and rate limit window
      const now = Date.now();
      const windowStart = Math.floor(now / limits.windowMs);
      const key = `ratelimit:${type}:${tier}:${identifier}:${windowStart}`;

      // Check rate limit
      const { count, ttl } = await getRateLimitInfo(key, limits.windowMs);

      // Set response headers
      res.setHeader('X-RateLimit-Limit', limits.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limits.max - count));
      res.setHeader('X-RateLimit-Reset', new Date(now + ttl * 1000).toISOString());
      res.setHeader('X-RateLimit-Tier', tier);

      // Store rate limit info on request for logging
      req.rateLimit = {
        tier,
        type,
        limit: limits.max,
        current: count,
        remaining: Math.max(0, limits.max - count),
        resetIn: ttl,
      };

      if (count > limits.max) {
        const error = {
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          tier: tier,
          retryAfter: ttl,
          message: `Rate limit exceeded for ${tier} users. Try again in ${ttl}s.`,
        };

        req.log?.warn(
          { tier, type, ip: identifier, count, limit: limits.max },
          'Rate limit exceeded'
        );

        return res.status(429).json(error)
          .set('Retry-After', ttl);
      }

      next();
    } catch (error) {
      // On error, allow request to proceed but log it
      req.log?.error({ error: error.message }, 'Rate limiter error, allowing request');
      next();
    }
  };
}

/**
 * Create a simple limiter that enforces limits for a specific tier
 */
export function createTierLimiter(tier = 'authenticated', type = 'read') {
  return createTieredRateLimiter(type);
}

/**
 * Middleware to extract wallet from request context
 * Marks user as authenticated if wallet is present
 */
export function extractWalletMiddleware(req, res, next) {
  // Check for wallet in various possible locations
  const wallet =
    req.body?.wallet ||
    req.query?.wallet ||
    req.headers['x-wallet-address'] ||
    null;

  if (wallet) {
    req.wallet = wallet;
  }

  next();
}

/**
 * Get current rate limit status for a request
 */
export function getRateLimitStatus(req) {
  return req.rateLimit || null;
}

/**
 * Reset rate limit for a specific user/tier (admin only)
 */
export async function resetRateLimitForUser(identifier, tier = 'all', type = 'all') {
  if (!redisConnected || !redisClient) {
    // Clear from memory store
    for (const [key] of memoryStore.entries()) {
      if (key.includes(identifier)) {
        memoryStore.delete(key);
      }
    }
    return true;
  }

  try {
    const tiers = tier === 'all' ? Object.keys(TIERS) : [tier];
    const types = type === 'all' ? ['read', 'write'] : [type];

    let keysDeleted = 0;

    for (const t of tiers) {
      for (const ty of types) {
        // Pattern match: ratelimit:{type}:{tier}:{identifier}:*
        const pattern = `ratelimit:${ty}:${t}:${identifier}:*`;
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          keysDeleted += keys.length;
          await redisClient.del(...keys);
        }
      }
    }

    logger.info({ identifier, tier, type, keysDeleted }, 'Rate limit reset');
    return true;
  } catch (error) {
    logger.error({ error: error.message, identifier }, 'Failed to reset rate limit');
    return false;
  }
}

/**
 * Get rate limit stats for monitoring
 */
export async function getRateLimitStats() {
  if (!redisConnected || !redisClient) {
    return {
      backend: 'memory',
      keysInMemory: memoryStore.size,
      connected: false,
    };
  }

  try {
    const keys = await redisClient.keys('ratelimit:*');
    const info = await redisClient.info('memory');

    return {
      backend: 'redis',
      connected: true,
      totalKeys: keys.length,
      memoryUsage: info ? info.split('\n').find(line => line.includes('used_memory_human')) : null,
    };
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get rate limit stats');
    return { backend: 'redis', connected: false, error: error.message };
  }
}

/**
 * Export tier information for documentation
 */
export { TIERS as RATE_LIMIT_TIERS };

/**
 * Health check for rate limiter
 */
export async function checkRateLimiterHealth() {
  if (!redisConnected || !redisClient) {
    return { status: 'ok', backend: 'memory' };
  }

  try {
    await redisClient.ping();
    return { status: 'ok', backend: 'redis', connected: true };
  } catch (error) {
    return {
      status: 'degraded',
      backend: 'redis',
      connected: false,
      error: error.message,
      fallback: 'memory',
    };
  }
}
