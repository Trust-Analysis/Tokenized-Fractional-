/**
 * GraphQL Persisted Query Execution Engine
 * Handles execution of persisted queries with caching and monitoring
 */

import { graphql } from 'graphql';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ExecutionEngine');

/**
 * GraphQL Persisted Query Executor
 */
export class PersistedQueryExecutor {
  constructor(schema, lookup, cache, analytics) {
    this.schema = schema;
    this.lookup = lookup;
    this.cache = cache;
    this.analytics = analytics;
    this.executionTimeout = 30000; // 30 seconds default
  }

  /**
   * Execute persisted query by hash or ID
   */
  async executeQuery(hashOrId, variables = {}, context = {}, operationName = null) {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();

    try {
      logger.info('Executing persisted query', { hashOrId, executionId });

      // Step 1: Lookup query
      const lookupResult = await this.lookup.getQueryWithAuth(
        hashOrId,
        context.user,
        context.requiredRole
      );

      if (!lookupResult.success) {
        return this.formatError(lookupResult, startTime, executionId);
      }

      const query = lookupResult.query;

      // Step 2: Check cache for result
      const cacheKey = this.generateCacheKey(query.id, variables);
      const cachedResult = await this.getFromCache(cacheKey, query.cacheStrategy);

      if (cachedResult) {
        logger.info('Returning cached result', { queryId: query.id, executionId });
        this.recordExecution(query.id, {
          executionTime: Date.now() - startTime,
          status: 'success',
          cacheHit: true,
          userId: context.user?.id,
          executionId,
        });
        return {
          ...cachedResult,
          _cached: true,
          _executionId: executionId,
        };
      }

      // Step 3: Validate variables against query
      const validationResult = this.validateVariables(variables, query);
      if (!validationResult.isValid) {
        return this.formatError({
          success: false,
          error: validationResult.error,
          code: 'INVALID_VARIABLES',
        }, startTime, executionId);
      }

      // Step 4: Execute query with timeout
      const executionResult = await Promise.race([
        graphql(this.schema, query.queryString, null, context, variables, operationName),
        this.createTimeoutPromise(query.maxExecutionTimeMs || this.executionTimeout),
      ]);

      // Step 5: Cache result if successful
      if (!executionResult.errors && query.cacheStrategy !== 'no-cache') {
        const ttl = this.getCacheTTL(query.cacheStrategy, query.cacheTTL);
        await this.cache.set(cacheKey, JSON.stringify(executionResult), ttl);
      }

      // Step 6: Record execution metrics
      const executionTime = Date.now() - startTime;
      this.recordExecution(query.id, {
        executionTime,
        resultSize: JSON.stringify(executionResult).length,
        status: executionResult.errors ? 'error' : 'success',
        userId: context.user?.id,
        variables,
        errorMessage: executionResult.errors?.[0]?.message,
        executionId,
      });

      // Step 7: Add metadata to response
      return {
        ...executionResult,
        _queryId: query.id,
        _executionTime: executionTime,
        _cached: false,
        _executionId: executionId,
      };
    } catch (error) {
      logger.error('Query execution error', { hashOrId, error: error.message, executionId });

      const executionTime = Date.now() - startTime;
      this.recordExecution(hashOrId, {
        executionTime,
        status: 'error',
        userId: context.user?.id,
        errorMessage: error.message,
        executionId,
      });

      return {
        errors: [
          {
            message: error.message,
            extensions: {
              code: 'EXECUTION_ERROR',
              executionId,
            },
          },
        ],
        _executionId: executionId,
        _executionTime: executionTime,
      };
    }
  }

  /**
   * Batch execute multiple persisted queries
   */
  async batchExecuteQueries(queries) {
    const results = [];

    for (const { hashOrId, variables, operationName } of queries) {
      const result = await this.executeQuery(
        hashOrId,
        variables,
        {},
        operationName
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Execute with authentication enforcement
   */
  async executeAuthenticatedQuery(hashOrId, variables = {}, user = {}, requiredRole = null) {
    if (!user) {
      return {
        errors: [{
          message: 'Authentication required',
          extensions: { code: 'UNAUTHENTICATED' },
        }],
      };
    }

    return this.executeQuery(hashOrId, variables, { user, requiredRole });
  }

  /**
   * Validate variables against query
   */
  validateVariables(variables, query) {
    try {
      // Check required variables
      for (const varDef of query.variables || []) {
        if (varDef.required && !variables[varDef.name]) {
          return {
            isValid: false,
            error: `Required variable "${varDef.name}" is missing`,
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  /**
   * Get result from cache
   */
  async getFromCache(cacheKey, cacheStrategy) {
    if (cacheStrategy === 'no-cache') {
      return null;
    }

    try {
      const cached = await this.cache.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Cache retrieval error', { error: error.message });
      return null;
    }
  }

  /**
   * Get cache TTL based on strategy
   */
  getCacheTTL(strategy, customTTL) {
    const ttlMap = {
      'no-cache': 0,
      'short': customTTL || 300,        // 5 minutes
      'long': customTTL || 3600,        // 1 hour
      'permanent': customTTL || 86400,  // 1 day
    };

    return ttlMap[strategy] || 300;
  }

  /**
   * Generate cache key from query and variables
   */
  generateCacheKey(queryId, variables) {
    const crypto = require('crypto');
    const varString = JSON.stringify(variables);
    const hash = crypto.createHash('sha256').update(varString).digest('hex');
    return `result:${queryId}:${hash}`;
  }

  /**
   * Create timeout promise
   */
  createTimeoutPromise(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Query execution timeout')), ms)
    );
  }

  /**
   * Record execution metrics
   */
  async recordExecution(queryId, metrics) {
    try {
      await this.analytics.recordExecution(queryId, {
        executionTime: metrics.executionTime,
        resultSize: metrics.resultSize,
        cacheHit: metrics.cacheHit,
        status: metrics.status,
        userId: metrics.userId,
        variables: metrics.variables,
        errorMessage: metrics.errorMessage,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.warn('Failed to record execution', { error: error.message });
    }
  }

  /**
   * Format error response
   */
  formatError(result, startTime, executionId) {
    return {
      errors: [{
        message: result.error || 'Query execution failed',
        extensions: {
          code: result.code || 'INTERNAL_ERROR',
          executionId,
        },
      }],
      _executionTime: Date.now() - startTime,
      _executionId: executionId,
    };
  }

  /**
   * Generate unique execution ID
   */
  generateExecutionId() {
    const { randomUUID } = require('crypto');
    return randomUUID().split('-')[0];
  }

  /**
   * Get execution statistics
   */
  getExecutionStatistics() {
    return {
      totalExecutions: this.analytics.totalExecutions,
      averageExecutionTime: this.analytics.averageExecutionTime,
      cacheHitRate: this.analytics.cacheHitRate,
      errorRate: this.analytics.errorRate,
    };
  }

  /**
   * Clear execution statistics
   */
  clearStatistics() {
    this.analytics.clearStatistics();
  }
}

export default PersistedQueryExecutor;
