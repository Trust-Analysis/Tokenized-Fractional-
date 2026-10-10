// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { cacheGet, cacheSet, cacheDel } from '../cache.js';

/**
 * Price history cache key format:
 *   price_history:{tokenId}:{interval}
 *
 * Intervals:  1D, 1W, 1M, 1Y
 * TTLs:       1D  -> 60s   (1m)
 *             1W  -> 900s  (15m)
 *             1M  -> 3600s (1h)
 *             1Y  -> 3600s (1h)
 */

const INTERVAL_TTL = {
  '1D': 60,
  '1W': 900,
  '1M': 3600,
  '1Y': 3600,
};

const VALID_INTERVALS = new Set(Object.keys(INTERVAL_TTL));

/**
 * Build a Redis cache key for price history.
 * @param {string} tokenId  Contract address or token identifier.
 * @param {string} interval One of 1D, 1W, 1M, 1Y.
 * @returns {string}
 */
export function buildPriceHistoryKey(tokenId, interval) {
  return `price_history:${tokenId}:${interval}`;
}

/**
 * Fetch price history from the Redis cache.
 * Returns the cached array of price points or null on miss / error.
 * @param {string} tokenId
 * @param {string} interval
 * @returns {Promise<Array|null>}
 */
export async function getCachedPriceHistory(tokenId, interval) {
  if (!VALID_INTERVALS.has(interval)) return null;
  const key = buildPriceHistoryKey(tokenId, interval);
  return cacheGet(key);
}

/**
 * Store price history in the Redis cache with an interval-appropriate TTL.
 * @param {string} tokenId
 * @param {string} interval
 * @param {Array} pricePoints  Array of { timestamp, price } objects.
 */
export async function setCachedPriceHistory(tokenId, interval, pricePoints) {
  if (!VALID_INTERVALS.has(interval)) return;
  const key = buildPriceHistoryKey(tokenId, interval);
  const ttl = INTERVAL_TTL[interval];
  await cacheSet(key, pricePoints, ttl);
}

/**
 * Invalidate all cached price history for a given token.
 * Called when new trades finalize to ensure stale data is evicted.
 * @param {string} tokenId
 */
export async function invalidatePriceHistoryCache(tokenId) {
  const invalidations = Object.keys(INTERVAL_TTL).map((interval) =>
    cacheDel(buildPriceHistoryKey(tokenId, interval))
  );
  await Promise.allSettled(invalidations);
}

/**
 * High-level getter: check Redis first, fall back to the provided
 * fetchFn (typically a PostgreSQL query), cache the result, and return it.
 *
 * If Redis is unreachable the function transparently falls back to fetchFn.
 *
 * @param {string} tokenId
 * @param {string} interval
 * @param {function} fetchFn  () => Promise<Array<{timestamp, price}>>
 * @returns {Promise<Array>}
 */
export async function getPriceHistory(tokenId, interval, fetchFn) {
  // 1. Try Redis
  try {
    const cached = await getCachedPriceHistory(tokenId, interval);
    if (cached) return cached;
  } catch {
    // Redis unreachable — fall through to PostgreSQL
  }

  // 2. Fallback to PostgreSQL
  const data = await fetchFn();

  // 3. Populate cache (fire-and-forget on failure)
  try {
    await setCachedPriceHistory(tokenId, interval, data);
  } catch {
    // Cache write failure is non-fatal
  }

  return data;
}

export { INTERVAL_TTL, VALID_INTERVALS };
