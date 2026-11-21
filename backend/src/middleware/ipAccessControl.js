import Redis from 'ioredis';
import { logger } from '../services/logger.js';
import { REDIS_URL } from '../config.js';

let redisClient = null;
let redisConnected = false;

const WHITELIST_KEY = 'ip:whitelist';
const BLACKLIST_KEY = 'ip:blacklist';
const WHITELIST_ENABLED_KEY = 'ip:whitelist_enabled';

const memoryWhitelist = new Set();
const memoryBlacklist = new Set();
let memoryWhitelistEnabled = false;

export async function initializeIPAccessControl() {
  if (!REDIS_URL) {
    logger.info('Redis not configured for IP access control, using memory-only mode');
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
      logger.error({ error: err.message }, 'IP access control Redis error');
      redisConnected = false;
    });
    redisClient.on('connect', () => { redisConnected = true; });
    redisClient.on('disconnect', () => { redisConnected = false; });
    await redisClient.connect();
    redisConnected = true;
    await syncFromRedis();
    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to init IP access control Redis');
    redisClient = null;
    redisConnected = false;
    return false;
  }
}

async function syncFromRedis() {
  if (!redisConnected || !redisClient) return;
  try {
    const whitelist = await redisClient.smembers(WHITELIST_KEY);
    const blacklist = await redisClient.smembers(BLACKLIST_KEY);
    const enabled = await redisClient.get(WHITELIST_ENABLED_KEY);
    memoryWhitelist.clear();
    memoryBlacklist.clear();
    whitelist.forEach(ip => memoryWhitelist.add(ip));
    blacklist.forEach(ip => memoryBlacklist.add(ip));
    memoryWhitelistEnabled = enabled === 'true';
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to sync IP lists from Redis');
  }
}

export function createIPAccessControl() {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';

      if (memoryBlacklist.has(ip)) {
        logger.warn({ ip, path: req.path }, 'Blocked request from blacklisted IP');
        return res.status(403).json({
          error: 'Access denied',
          code: 'IP_BLACKLISTED',
          message: 'Your IP address has been blocked.',
        });
      }

      if (memoryWhitelistEnabled && !memoryWhitelist.has(ip)) {
        logger.warn({ ip, path: req.path }, 'Blocked request from non-whitelisted IP');
        return res.status(403).json({
          error: 'Access denied',
          code: 'IP_NOT_WHITELISTED',
          message: 'Your IP address is not whitelisted.',
        });
      }

      req.ipAccess = { ip, whitelisted: memoryWhitelist.has(ip), whitelistEnabled: memoryWhitelistEnabled };
      next();
    } catch (error) {
      req.log?.error({ error: error.message }, 'IP access control error, allowing request');
      next();
    }
  };
}

export async function addToWhitelist(ip) {
  memoryWhitelist.add(ip);
  if (redisConnected && redisClient) {
    await redisClient.sadd(WHITELIST_KEY, ip);
  }
  logger.info({ ip }, 'IP added to whitelist');
}

export async function removeFromWhitelist(ip) {
  memoryWhitelist.delete(ip);
  if (redisConnected && redisClient) {
    await redisClient.srem(WHITELIST_KEY, ip);
  }
  logger.info({ ip }, 'IP removed from whitelist');
}

export async function addToBlacklist(ip) {
  memoryBlacklist.add(ip);
  if (redisConnected && redisClient) {
    await redisClient.sadd(BLACKLIST_KEY, ip);
  }
  logger.info({ ip }, 'IP added to blacklist');
}

export async function removeFromBlacklist(ip) {
  memoryBlacklist.delete(ip);
  if (redisConnected && redisClient) {
    await redisClient.srem(BLACKLIST_KEY, ip);
  }
  logger.info({ ip }, 'IP removed from blacklist');
}

export async function setWhitelistEnabled(enabled) {
  memoryWhitelistEnabled = enabled;
  if (redisConnected && redisClient) {
    await redisClient.set(WHITELIST_ENABLED_KEY, enabled ? 'true' : 'false');
  }
  logger.info({ enabled }, 'IP whitelist mode updated');
}

export function getWhitelist() {
  return Array.from(memoryWhitelist);
}

export function getBlacklist() {
  return Array.from(memoryBlacklist);
}

export function isWhitelistEnabled() {
  return memoryWhitelistEnabled;
}

export async function closeIPAccessControl() {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = null;
    redisConnected = false;
  }
}