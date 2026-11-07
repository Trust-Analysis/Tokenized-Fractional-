import Redis from 'ioredis';
import { logger } from '../services/logger.js';
import { REDIS_URL, NODE_ENV } from '../config.js';

const ENDPOINT_LIMITS = {
  '/api/v1/rwa': {
    GET: { windowMs: 60 * 1000, max: 30 },
    default: { windowMs: 60 * 1000, max: 10 },
  },
  '/api/v1/analytics': {
    GET: { windowMs: 60 * 1000, max: 20 },
    default: { windowMs: 60 * 1000, max: 5 },
  },
  '/api/v1/purchases': {
    POST: { windowMs: 60 * 1000, max: 5 },
    default: { windowMs: 60 * 1000, max: 15 },
  },
  '/api/v1/webhooks': {
    GET: { windowMs: 60 * 1000, max: 30 },
    POST: { windowMs: 60 * 1000, max: 10 },
    default: { windowMs: 60 * 1000, max: 15 },
  },
  '/api/v1/flash-loan-protection': {
    GET: { windowMs: 60 * 1000, max: 20 },
    default: { windowMs: 60 * 1000, max: 5 },
  },
  '/api/v1/api-keys': {
    default: { windowMs: 60 * 1000, max: 10 },
  },
  '/graphql': {
    POST: { windowMs: 60 * 1000, max: 40 },
    default: { windowMs: 60 * 1000, max: 40 },
  },
};

const TEST_ENDPOINT_LIMITS = {};
for (const [path, methods] of Object.entries(ENDPOINT_LIMITS)) {
  TEST_ENDPOINT_LIMITS[path] = {};
  for (const [method, limit] of Object.entries(methods)) {
    TEST_ENDPOINT_LIMITS[path][method] = { windowMs: 60 * 1000, max: 10000 };
  }
}

const LIMITS = NODE_ENV === 'test' ? TEST_ENDPOINT_LIMITS : ENDPOINT_LIMITS;

let redisClient = null;
let redisConnected = false;

export async function initializeEndpointLimiter() {
  if (!REDIS_URL) return false;
  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      enableReadyCheck: false,
    });
    redisClient.on('error', (err) => {
      logger.error({ error: err.message }, 'Endpoint rate limiter Redis error');
      redisConnected = false;
    });
    redisClient.on('connect', () => { redisConnected = true; });
    redisClient.on('disconnect', () => { redisConnected = false; });
    await redisClient.connect();
    redisConnected = true;
    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to init endpoint rate limiter Redis');
    redisClient = null;
    redisConnected = false;
    return false;
  }
}

export async function closeEndpointLimiter() {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = null;
    redisConnected = false;
  }
}

const memoryStore = new Map();

async function getCount(key, windowMs) {
  if (redisConnected && redisClient) {
    try {
      const count = await redisClient.incr(key);
      const ttl = await redisClient.ttl(key);
      if (ttl === -1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }
      return { count, ttl: Math.max(0, ttl) };
    } catch {
      redisConnected = false;
    }
  }
  const now = Date.now();
  let entry = memoryStore.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs };
    memoryStore.set(key, entry);
  }
  entry.count += 1;
  return { count: entry.count, ttl: Math.ceil((entry.resetTime - now) / 1000) };
}

function matchPath(requestPath) {
  const sorted = Object.keys(LIMITS).sort((a, b) => b.length - a.length);
  for (const pattern of sorted) {
    if (requestPath.startsWith(pattern)) return pattern;
  }
  return null;
}

export function createEndpointRateLimiter() {
  return async (req, res, next) => {
    try {
      const matchedPath = matchPath(req.path);
      if (!matchedPath) return next();

      const methodLimits = LIMITS[matchedPath];
      const config = methodLimits[req.method] || methodLimits.default;
      if (!config) return next();

      const identifier = req.user?.id || req.wallet || req.ip || 'unknown';
      const windowKey = Math.floor(Date.now() / config.windowMs);
      const key = `endpoint:${matchedPath}:${req.method}:${identifier}:${windowKey}`;

      const { count, ttl } = await getCount(key, config.windowMs);

      res.setHeader('X-Endpoint-RateLimit-Limit', config.max);
      res.setHeader('X-Endpoint-RateLimit-Remaining', Math.max(0, config.max - count));
      res.setHeader('X-Endpoint-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());

      req.endpointRateLimit = {
        path: matchedPath,
        method: req.method,
        limit: config.max,
        current: count,
        remaining: Math.max(0, config.max - count),
      };

      if (count > config.max) {
        return res.status(429).json({
          error: 'Too many requests',
          code: 'ENDPOINT_RATE_LIMIT_EXCEEDED',
          path: matchedPath,
          retryAfter: ttl,
          message: `Rate limit exceeded for ${req.method} ${matchedPath}. Try again in ${ttl}s.`,
        }).set('Retry-After', ttl);
      }

      next();
    } catch (error) {
      req.log?.error({ error: error.message }, 'Endpoint rate limiter error');
      next();
    }
  };
}

export async function getEndpointRateLimitStats() {
  if (!redisConnected || !redisClient) {
    return { backend: 'memory', keysInMemory: memoryStore.size };
  }
  try {
    const keys = await redisClient.keys('endpoint:*');
    return { backend: 'redis', totalKeys: keys.length };
  } catch {
    return { backend: 'redis', connected: false };
  }
}