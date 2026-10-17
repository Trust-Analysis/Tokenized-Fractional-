// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/entityCache.js
 *
 * A lightweight, TTL-based in-memory entity cache for GraphQL Federation.
 *
 * Purpose
 * ───────
 * Apollo Gateway resolves cross-service entity references by calling the
 * owning subgraph's `_entities` resolver for each representation it needs.
 * When multiple operations require the same entity (e.g. the same RWA asset
 * referenced by ten transactions), this generates redundant subgraph calls.
 *
 * This cache intercepts those lookups and returns a cached copy when the
 * entity was recently fetched, dramatically reducing redundant I/O under
 * typical read workloads.
 *
 * Configuration
 * ─────────────
 * TTL defaults to 30 seconds — suitable for near-real-time asset data.
 * Max cache size is 500 entries per entity type to bound memory use.
 *
 * Usage
 * ─────
 *   import { entityCache } from './entityCache.js';
 *
 *   // In an _entities resolver:
 *   const cached = entityCache.get('RWA', contractId);
 *   if (cached) return cached;
 *   const entity = await loadAssetById(contractId);
 *   entityCache.set('RWA', contractId, entity);
 *   return entity;
 */

import { entityCacheHits, entityCacheMisses } from './metrics.js';

const DEFAULT_TTL_MS = 30_000;  // 30 seconds
const MAX_ENTRIES     = 500;    // per entity type

class EntityCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES } = {}) {
    this._ttlMs      = ttlMs;
    this._maxEntries = maxEntries;
    /** @type {Map<string, Map<string, { value: unknown, expiresAt: number }>>} */
    this._stores = new Map();
  }

  /**
   * Returns (or creates) the store for a given entity type.
   * @param {string} typeName
   * @returns {Map<string, { value: unknown, expiresAt: number }>}
   */
  _storeFor(typeName) {
    if (!this._stores.has(typeName)) {
      this._stores.set(typeName, new Map());
    }
    return this._stores.get(typeName);
  }

  /**
   * Retrieve an entity from cache.
   *
   * @param {string} typeName  - GraphQL entity type name, e.g. 'RWA'
   * @param {string} key       - Unique identifier (e.g. contractId, walletAddress)
   * @returns {unknown | null}  Cached entity or null on miss / expiry
   */
  get(typeName, key) {
    const store = this._storeFor(typeName);
    const entry = store.get(key);

    if (!entry) {
      entityCacheMisses.inc({ entity_type: typeName });
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      entityCacheMisses.inc({ entity_type: typeName });
      return null;
    }

    entityCacheHits.inc({ entity_type: typeName });
    return entry.value;
  }

  /**
   * Store an entity in cache.
   *
   * Evicts the oldest entry when the store is at capacity (simple LRU
   * approximation — evict first inserted key).
   *
   * @param {string}  typeName
   * @param {string}  key
   * @param {unknown} value
   * @param {number}  [ttlMs] - Override default TTL for this entry
   */
  set(typeName, key, value, ttlMs = this._ttlMs) {
    const store = this._storeFor(typeName);

    // Evict oldest when at capacity
    if (store.size >= this._maxEntries && !store.has(key)) {
      const firstKey = store.keys().next().value;
      store.delete(firstKey);
    }

    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Explicitly invalidate a cached entity (e.g. on mutation).
   * @param {string} typeName
   * @param {string} key
   */
  invalidate(typeName, key) {
    this._storeFor(typeName).delete(key);
  }

  /**
   * Invalidate all cached entries for a given entity type.
   * @param {string} typeName
   */
  invalidateType(typeName) {
    this._storeFor(typeName).clear();
  }

  /** Remove all expired entries across all types. */
  purgeExpired() {
    const now = Date.now();
    for (const store of this._stores.values()) {
      for (const [key, entry] of store.entries()) {
        if (now > entry.expiresAt) store.delete(key);
      }
    }
  }

  /** Return cache statistics for observability. */
  stats() {
    const result = {};
    for (const [typeName, store] of this._stores.entries()) {
      result[typeName] = store.size;
    }
    return result;
  }
}

// Singleton instance shared across subgraph resolvers
export const entityCache = new EntityCache();

// Periodically purge stale entries to avoid memory leaks
setInterval(() => entityCache.purgeExpired(), 60_000).unref();
