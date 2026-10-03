/**
 * Secure Query Lookup System
 * Handles secure retrieval of persisted queries by hash or ID
 */

import crypto from 'crypto';
import { Logger } from '../utils/logger.js';

const logger = new Logger('QueryLookup');

/**
 * Query Lookup Service
 */
export class QueryLookupService {
  constructor(store, cache) {
    this.store = store;
    this.cache = cache;
    this.maxCacheSize = 1000;
    this.lookupMetrics = new Map();
  }

  /**
   * Lookup query by hash
   */
  async getQueryByHash(hash) {
    try {
      // Validate hash format (SHA-256 hex string)
      if (!this.isValidHash(hash)) {
        logger.warn('Invalid hash format', { hash });
        return null;
      }

      // Check cache first
      const cacheKey = `query:hash:${hash}`;
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.recordMetric('cache_hit', hash);
        return JSON.parse(cached);
      }

      // Query database
      const query = await this.store.getQueryByHash(hash);
      if (!query) {
        this.recordMetric('not_found', hash);
        logger.debug('Query not found by hash', { hash });
        return null;
      }

      // Cache result
      if (query.isActive && !query.isDeprecated) {
        await this.cache.set(cacheKey, JSON.stringify(query), query.cacheTTL || 300);
      }

      this.recordMetric('cache_miss', hash);
      return query;
    } catch (error) {
      logger.error('Query lookup by hash failed', { hash, error: error.message });
      throw error;
    }
  }

  /**
   * Lookup query by ID
   */
  async getQueryById(queryId) {
    try {
      // Validate ID format
      if (!this.isValidQueryId(queryId)) {
        logger.warn('Invalid query ID format', { queryId });
        return null;
      }

      // Check cache
      const cacheKey = `query:id:${queryId}`;
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.recordMetric('cache_hit', queryId);
        return JSON.parse(cached);
      }

      // Query database
      const query = await this.store.getQuery(queryId);
      if (!query) {
        this.recordMetric('not_found', queryId);
        logger.debug('Query not found by ID', { queryId });
        return null;
      }

      // Cache result
      if (query.isActive && !query.isDeprecated) {
        await this.cache.set(cacheKey, JSON.stringify(query), query.cacheTTL || 300);
      }

      this.recordMetric('cache_miss', queryId);
      return query;
    } catch (error) {
      logger.error('Query lookup by ID failed', { queryId, error: error.message });
      throw error;
    }
  }

  /**
   * Resolve query by hash or ID with automatic retry
   */
  async resolveQuery(hashOrId) {
    try {
      // Try as hash first
      if (this.isValidHash(hashOrId)) {
        const query = await this.getQueryByHash(hashOrId);
        if (query) return query;
      }

      // Try as ID
      if (this.isValidQueryId(hashOrId)) {
        const query = await this.getQueryById(hashOrId);
        if (query) return query;
      }

      logger.warn('Query not found for hash or ID', { hashOrId });
      return null;
    } catch (error) {
      logger.error('Query resolution failed', { hashOrId, error: error.message });
      return null;
    }
  }

  /**
   * Batch lookup queries
   */
  async batchGetQueries(hashes) {
    try {
      const results = new Map();

      for (const hash of hashes) {
        const query = await this.getQueryByHash(hash);
        if (query) {
          results.set(hash, query);
        }
      }

      logger.info('Batch query lookup complete', {
        requested: hashes.length,
        found: results.size,
      });

      return results;
    } catch (error) {
      logger.error('Batch query lookup failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get query with authorization check
   */
  async getQueryWithAuth(hashOrId, user, requiredRole = null) {
    try {
      const query = await this.resolveQuery(hashOrId);
      if (!query) {
        return { success: false, error: 'Query not found', code: 'NOT_FOUND' };
      }

      // Check if active
      if (!query.isActive) {
        return { success: false, error: 'Query is inactive', code: 'INACTIVE' };
      }

      // Check if deprecated
      if (query.isDeprecated) {
        return {
          success: true,
          query,
          warning: `Query is deprecated. ${query.deprecationReason || ''}`,
          deprecationCode: 'DEPRECATED',
        };
      }

      // Check authentication requirement
      if (query.requiresAuthentication && !user) {
        return {
          success: false,
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        };
      }

      // Check role authorization
      if (query.allowedRoles && query.allowedRoles.length > 0) {
        const userRoles = user?.roles || [];
        const hasRole = query.allowedRoles.some(r => userRoles.includes(r));

        if (!hasRole) {
          return {
            success: false,
            error: 'Insufficient permissions',
            code: 'FORBIDDEN',
            requiredRoles: query.allowedRoles,
          };
        }
      }

      // Check required role parameter
      if (requiredRole && query.allowedRoles && !query.allowedRoles.includes(requiredRole)) {
        return {
          success: false,
          error: `Role "${requiredRole}" not allowed`,
          code: 'ROLE_MISMATCH',
        };
      }

      this.recordMetric('auth_success', hashOrId);

      return {
        success: true,
        query,
      };
    } catch (error) {
      logger.error('Authorized query lookup failed', { hashOrId, error: error.message });
      return {
        success: false,
        error: error.message,
        code: 'LOOKUP_ERROR',
      };
    }
  }

  /**
   * Search queries by criteria
   */
  async searchQueries(criteria) {
    try {
      const results = await this.store.searchQueries(criteria);

      // Add cache keys
      for (const query of results) {
        query._cacheKey = `query:id:${query.id}`;
      }

      logger.info('Query search complete', {
        criteria,
        resultCount: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Query search failed', { criteria, error: error.message });
      throw error;
    }
  }

  /**
   * Validate hash format
   */
  isValidHash(hash) {
    // SHA-256 hash is 64 hex characters
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  }

  /**
   * Validate query ID format
   */
  isValidQueryId(id) {
    // UUID v4 format
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  /**
   * Record lookup metrics
   */
  recordMetric(type, hashOrId) {
    const key = `${type}:${hashOrId}`;
    if (!this.lookupMetrics.has(key)) {
      this.lookupMetrics.set(key, 0);
    }
    this.lookupMetrics.set(key, this.lookupMetrics.get(key) + 1);

    // Cleanup old metrics if cache gets too large
    if (this.lookupMetrics.size > this.maxCacheSize) {
      const oldestKeys = Array.from(this.lookupMetrics.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, 100)
        .map(e => e[0]);

      oldestKeys.forEach(k => this.lookupMetrics.delete(k));
    }
  }

  /**
   * Get lookup statistics
   */
  getLookupStatistics() {
    const stats = {
      totalLookups: 0,
      cacheHits: 0,
      cacheMisses: 0,
      notFound: 0,
      authSuccesses: 0,
      queries: {},
    };

    for (const [key, count] of this.lookupMetrics.entries()) {
      const [type, hashOrId] = key.split(':');
      stats.totalLookups += count;

      if (type === 'cache_hit') stats.cacheHits += count;
      if (type === 'cache_miss') stats.cacheMisses += count;
      if (type === 'not_found') stats.notFound += count;
      if (type === 'auth_success') stats.authSuccesses += count;

      if (!stats.queries[hashOrId]) {
        stats.queries[hashOrId] = { hits: 0, misses: 0, notFound: 0 };
      }

      if (type === 'cache_hit') stats.queries[hashOrId].hits += count;
      if (type === 'cache_miss') stats.queries[hashOrId].misses += count;
      if (type === 'not_found') stats.queries[hashOrId].notFound += count;
    }

    stats.hitRate = stats.totalLookups > 0 ? stats.cacheHits / stats.totalLookups : 0;

    return stats;
  }

  /**
   * Clear cache
   */
  async clearCache() {
    try {
      await this.cache.clear();
      this.lookupMetrics.clear();
      logger.info('Query cache cleared');
      return { success: true };
    } catch (error) {
      logger.error('Cache clear failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Warm cache with active queries
   */
  async warmCache(limit = 100) {
    try {
      const queries = await this.store.getActiveQueries(limit);

      for (const query of queries) {
        const cacheKey = `query:id:${query.id}`;
        await this.cache.set(cacheKey, JSON.stringify(query), query.cacheTTL || 300);
      }

      logger.info('Query cache warmed', { queriesLoaded: queries.length });
      return { success: true, queriesLoaded: queries.length };
    } catch (error) {
      logger.error('Cache warming failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

export default QueryLookupService;
