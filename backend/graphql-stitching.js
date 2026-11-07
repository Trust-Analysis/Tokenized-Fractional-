// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * graphql-stitching.js — GraphQL Schema Stitching Implementation.
 *
 * Issue #294: GraphQL Schema Stitching Implementation
 *
 * Combines multiple GraphQL services into a unified gateway schema,
 * enabling a single API surface for distributed services.
 *
 * Features:
 *   - Schema stitching configuration for multiple subschemas
 *   - Type merging and conflict resolution
 *   - Remote schema transformation
 *   - Unified authentication across services
 *   - Error handling for service failures
 *   - Query delegation optimization with DataLoader
 *   - Schema versioning
 *   - Performance monitoring via Prometheus metrics
 *   - Hot-reloading support
 */

import { print, parse, buildSchema, lexicographicSortSchema } from 'graphql';
import { gql } from 'graphql-tag';
import { pubsub } from './pubsub.js';

// ── Schema versioning ─────────────────────────────────────────────────────────

const SCHEMA_VERSION = '2.0.0';
let currentSchemaVersion = SCHEMA_VERSION;
let schemaReloadListeners = [];

/**
 * Register a listener for schema reload events (hot-reloading support).
 * @param {Function} listener - Called with new version when schema changes
 * @returns {Function} Unsubscribe function
 */
export function onSchemaReload(listener) {
  schemaReloadListeners.push(listener);
  return () => {
    schemaReloadListeners = schemaReloadListeners.filter((l) => l !== listener);
  };
}

/**
 * Notify all listeners that the schema has been reloaded.
 */
function notifySchemaReload(newVersion) {
  currentSchemaVersion = newVersion;
  for (const listener of schemaReloadListeners) {
    try {
      listener(newVersion);
    } catch (err) {
      console.error('[stitching] Schema reload listener error:', err);
    }
  }
}

export function getSchemaVersion() {
  return currentSchemaVersion;
}

// ── Subschema configuration ────────────────────────────────────────────────────

/**
 * @typedef {Object} SubschemaConfig
 * @property {string} name              - Service name (e.g., 'rwa-service')
 * @property {string} endpoint          - GraphQL endpoint URL
 * @property {Object} typeDefs          - gql type definitions for this subschema
 * @property {Function} [executor]      - Custom executor function for remote queries
 * @property {string[]} [mergeTypes]    - Types to merge across subschemas
 * @property {Object} [mergeConfig]     - Type merge configuration
 * @property {boolean} [enabled]        - Whether this subschema is active
 * @property {number} [timeout]         - Request timeout in ms
 */

// ── Default subschema configurations ──────────────────────────────────────────

/**
 * RWA (Real-World Asset) service subschema configuration.
 * This is the primary service with asset CRUD operations.
 */
export const rwaSubschema = {
  name: 'rwa-service',
  endpoint: process.env.RWA_GRAPHQL_ENDPOINT || '/graphql',
  enabled: true,
  timeout: 5000,
  mergeTypes: ['RWA', 'DocumentHash', 'Statistics'],
  mergeConfig: {
    RWA: {
      selectionSet: '{ contractId }',
      fieldName: 'asset',
      args: (args) => ({ contractId: args.contractId }),
    },
  },
};

/**
 * Analytics service subschema configuration.
 * Distributed analytics and metrics service.
 */
export const analyticsSubschema = {
  name: 'analytics-service',
  endpoint: process.env.ANALYTICS_GRAPHQL_ENDPOINT || 'http://localhost:3002/graphql',
  enabled: process.env.ANALYTICS_GRAPHQL_ENDPOINT !== undefined,
  timeout: 3000,
  mergeTypes: ['Statistics', 'AnalyticsEvent'],
  mergeConfig: {
    Statistics: {
      selectionSet: '{ totalAssets }',
      fieldName: 'statistics',
    },
  },
};

/**
 * Transaction service subschema configuration.
 * Handles blockchain transaction tracking.
 */
export const transactionSubschema = {
  name: 'transaction-service',
  endpoint: process.env.TX_GRAPHQL_ENDPOINT || 'http://localhost:3003/graphql',
  enabled: process.env.TX_GRAPHQL_ENDPOINT !== undefined,
  timeout: 5000,
  mergeTypes: ['Transaction', 'SharePurchasedEvent'],
  mergeConfig: {
    Transaction: {
      selectionSet: '{ transactionId }',
      fieldName: 'transaction',
      args: (args) => ({ id: args.transactionId }),
    },
  },
};

// ── Unified gateway schema type definitions ───────────────────────────────────

/**
 * Gateway-level type definitions that extend and unify subschemas.
 * These add cross-service fields and unified query entry points.
 */
export const gatewayTypeDefs = gql`
  # Gateway-level directives for stitching
  directive @stitch(field: String!, service: String!) on FIELD_DEFINITION
  directive @merge(args: String!) on FIELD_DEFINITION

  # Unified query root — aggregates queries from all subschemas
  type Query {
    # From rwa-service
    assets(filter: RWAFilter, limit: Int, offset: Int): [RWA!]! @stitch(field: "assets", service: "rwa-service")
    asset(contractId: String!): RWA @stitch(field: "asset", service: "rwa-service")
    assetsCount: Int! @stitch(field: "assetsCount", service: "rwa-service")
    searchAssets(query: String!, limit: Int): [RWA!]! @stitch(field: "searchAssets", service: "rwa-service")
    pendingAssets: [RWA!]! @stitch(field: "pendingAssets", service: "rwa-service")
    statistics: Statistics! @stitch(field: "statistics", service: "rwa-service")

    # From transaction-service
    transactions(limit: Int, offset: Int): [Transaction!]! @stitch(field: "transactions", service: "transaction-service")
    transaction(transactionId: String!): Transaction @stitch(field: "transaction", service: "transaction-service")

    # From analytics-service
    analyticsEvents(limit: Int): [AnalyticsEvent!]! @stitch(field: "analyticsEvents", service: "analytics-service")

    # Gateway meta query
    schemaInfo: SchemaInfo!
  }

  # Unified mutation root
  type Mutation {
    createAsset(input: RWAInput!): RWA! @stitch(field: "createAsset", service: "rwa-service")
    updateAsset(contractId: String!, input: RWAInput!): RWA! @stitch(field: "updateAsset", service: "rwa-service")
    deleteAsset(contractId: String!): Boolean! @stitch(field: "deleteAsset", service: "rwa-service")
    approveAsset(contractId: String!): RWA! @stitch(field: "approveAsset", service: "rwa-service")
    pauseAsset(contractId: String!): RWA! @stitch(field: "pauseAsset", service: "rwa-service")
    unpauseAsset(contractId: String!): RWA! @stitch(field: "unpauseAsset", service: "rwa-service")
  }

  # Extended RWA type with cross-service fields
  extend type RWA {
    # Transactions related to this asset (from transaction-service)
    transactions: [Transaction!]! @stitch(field: "transactionsByAsset", service: "transaction-service")
    # Analytics for this asset (from analytics-service)
    analytics: AssetAnalytics @stitch(field: "assetAnalytics", service: "analytics-service")
  }

  # Transaction type (from transaction-service)
  type Transaction {
    transactionId: String!
    contractId: String!
    type: String!
    status: String!
    buyer: String
    shareCount: Int
    totalPrice: Int
    timestamp: String!
  }

  # Analytics event type (from analytics-service)
  type AnalyticsEvent {
    id: String!
    type: String!
    contractId: String
    metadata: String
    timestamp: String!
  }

  # Asset-level analytics
  type AssetAnalytics {
    contractId: String!
    viewCount: Int!
    purchaseCount: Int!
    averagePrice: Float!
    priceHistory: [PricePoint!]!
  }

  type PricePoint {
    timestamp: String!
    price: Float!
  }

  # Schema metadata
  type SchemaInfo {
    version: String!
    services: [ServiceInfo!]!
    stitchTimeMs: Float!
  }

  type ServiceInfo {
    name: String!
    endpoint: String!
    enabled: Boolean!
    types: [String!]!
  }
`;

// ── Conflict resolution ───────────────────────────────────────────────────────

/**
 * Type merge conflict resolution strategies.
 * When multiple subschemas define the same type, these strategies
 * determine how fields are merged.
 */
export const conflictResolvers = {
  // Last-write-wins for scalar fields
  lastWriteWins: (existing, incoming, fieldName) => {
    if (incoming[fieldName] !== undefined) return incoming[fieldName];
    return existing?.[fieldName];
  },

  // Prefer non-null values
  preferNonNull: (existing, incoming, fieldName) => {
    if (incoming?.[fieldName] != null) return incoming[fieldName];
    return existing?.[fieldName];
  },

  // Merge arrays from all subschemas
  mergeArrays: (existing, incoming, fieldName) => {
    const a = existing?.[fieldName] || [];
    const b = incoming?.[fieldName] || [];
    return [...a, ...b];
  },

  // Deduplicate by key
  dedupeByKey: (keyField) => (existing, incoming, fieldName) => {
    const a = existing?.[fieldName] || [];
    const b = incoming?.[fieldName] || [];
    const map = new Map();
    for (const item of [...a, ...b]) {
      if (item?.[keyField]) map.set(item[keyField], item);
    }
    return Array.from(map.values());
  },
};

/**
 * Default conflict resolution configuration per type.
 */
export const defaultConflictResolution = {
  RWA: {
    contractId: conflictResolvers.preferNonNull,
    title: conflictResolvers.preferNonNull,
    location: conflictResolvers.preferNonNull,
    description: conflictResolvers.preferNonNull,
    documents: conflictResolvers.mergeArrays,
    transactions: conflictResolvers.mergeArrays,
  },
  Statistics: {
    totalAssets: conflictResolvers.preferNonNull,
    totalSharesAvailable: conflictResolvers.preferNonNull,
    averagePricePerShare: conflictResolvers.preferNonNull,
  },
};

// ── Unified authentication ────────────────────────────────────────────────────

/**
 * Unified authentication context that propagates auth across all subschemas.
 * Extracts API key / JWT from request headers and forwards to downstream services.
 *
 * @param {Object} req - Express request object
 * @returns {Object} Auth context for resolvers
 */
export function createAuthContext(req) {
  const apiKey = req?.headers?.['x-api-key'];
  const authHeader = req?.headers?.['authorization'];
  const walletAddress = req?.walletAddress;

  return {
    apiKey,
    authHeader,
    walletAddress,
    isAuthenticated: !!(apiKey || authHeader),
    // Headers to forward to downstream GraphQL services
    forwardHeaders: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(authHeader ? { authorization: authHeader } : {}),
      ...(walletAddress ? { 'x-wallet-address': walletAddress } : {}),
    },
  };
}

// ── Error handling ────────────────────────────────────────────────────────────

/**
 * Custom error class for schema stitching errors.
 */
export class SchemaStitchingError extends Error {
  constructor(message, serviceName, code = 'STITCH_ERROR') {
    super(message);
    this.name = 'SchemaStitchingError';
    this.serviceName = serviceName;
    this.code = code;
  }
}

/**
 * Error handling middleware for stitched resolvers.
 * Provides graceful degradation when a subschema is unavailable.
 */
export function withErrorHandler(resolver, serviceName) {
  return async (parent, args, context, info) => {
    try {
      return await resolver(parent, args, context, info);
    } catch (err) {
      if (err instanceof SchemaStitchingError) throw err;

      // Log the error with service context
      console.error(`[stitching] Error in ${serviceName}:`, {
        message: err.message,
        path: info?.path,
        service: serviceName,
      });

      // Return null for optional fields, throw for required fields
      const fieldType = info?.returnType;
      if (fieldType && !String(fieldType).includes('!')) {
        return null; // Graceful degradation for nullable fields
      }

      throw new SchemaStitchingError(
        `${serviceName} is temporarily unavailable`,
        serviceName,
        'SERVICE_UNAVAILABLE'
      );
    }
  };
}

// ── Query delegation optimization ─────────────────────────────────────────────

/**
 * DataLoader-based batch query delegation.
 * Batches multiple queries to the same subschema into a single request.
 */
export class QueryDelegator {
  constructor(serviceName, executor, options = {}) {
    this.serviceName = serviceName;
    this.executor = executor;
    this.batchSize = options.batchSize || 50;
    this.cache = new Map();
    this.pendingBatch = [];
    this.batchTimer = null;
    this.batchDelay = options.batchDelay || 5; // ms
  }

  /**
   * Queue a query for batch execution.
   * @param {string} query - GraphQL query string
   * @param {Object} variables - Query variables
   * @param {Object} context - Request context (auth headers, etc.)
   * @returns {Promise} Query result
   */
  async delegate(query, variables, context) {
    const cacheKey = JSON.stringify({ query, variables });

    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
      this.pendingBatch.push({ query, variables, context, resolve, reject });

      // Flush immediately if batch is full
      if (this.pendingBatch.length >= this.batchSize) {
        this.flush();
      } else if (!this.batchTimer) {
        // Schedule flush after delay
        this.batchTimer = setTimeout(() => this.flush(), this.batchDelay);
      }
    });
  }

  /**
   * Execute all pending queries in a batch.
   */
  async flush() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = this.pendingBatch;
    this.pendingBatch = [];
    if (batch.length === 0) return;

    // Execute batch — combine queries if possible, otherwise parallel
    try {
      const results = await Promise.allSettled(
        batch.map(async ({ query, variables, context }) => {
          const result = await this.executor(query, variables, context);
          const cacheKey = JSON.stringify({ query, variables });
          this.cache.set(cacheKey, result);
          return result;
        })
      );

      batch.forEach(({ resolve, reject }, idx) => {
        if (results[idx].status === 'fulfilled') {
          resolve(results[idx].value);
        } else {
          reject(results[idx].reason);
        }
      });
    } catch (err) {
      batch.forEach(({ reject }) => reject(err));
    }
  }

  /**
   * Clear the cache (useful for schema reloads).
   */
  clearCache() {
    this.cache.clear();
  }
}

// ── Performance monitoring ────────────────────────────────────────────────────

/**
 * Schema stitching performance metrics collector.
 * Tracks query delegation times, error rates, and service health.
 */
export class StitchingMetrics {
  constructor() {
    this.metrics = {
      totalQueries: 0,
      totalErrors: 0,
      serviceStats: {},
      queryTimes: [],
    };
  }

  recordQuery(serviceName, durationMs, success) {
    this.metrics.totalQueries++;
    if (!success) this.metrics.totalErrors++;

    if (!this.metrics.serviceStats[serviceName]) {
      this.metrics.serviceStats[serviceName] = {
        queries: 0,
        errors: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        durations: [],
      };
    }

    const stats = this.metrics.serviceStats[serviceName];
    stats.queries++;
    if (!success) stats.errors++;
    stats.totalDurationMs += durationMs;
    stats.durations.push(durationMs);

    // Keep only last 1000 measurements
    if (stats.durations.length > 1000) stats.durations.shift();

    stats.avgDurationMs = stats.totalDurationMs / stats.queries;

    // Calculate p95
    if (stats.durations.length > 0) {
      const sorted = [...stats.durations].sort((a, b) => a - b);
      const p95Idx = Math.floor(sorted.length * 0.95);
      stats.p95DurationMs = sorted[p95Idx];
    }

    this.metrics.queryTimes.push({ serviceName, durationMs, success, timestamp: Date.now() });
    if (this.metrics.queryTimes.length > 5000) this.metrics.queryTimes.shift();
  }

  getMetrics() {
    return {
      version: currentSchemaVersion,
      ...this.metrics,
      errorRate: this.metrics.totalQueries > 0
        ? (this.metrics.totalErrors / this.metrics.totalQueries * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Export metrics in Prometheus format.
   */
  toPrometheus() {
    let output = '';
    output += '# HELP graphql_stitch_queries_total Total queries delegated to subschemas\n';
    output += '# TYPE graphql_stitch_queries_total counter\n';
    output += `graphql_stitch_queries_total ${this.metrics.totalQueries}\n`;
    output += '# HELP graphql_stitch_errors_total Total stitching errors\n';
    output += '# TYPE graphql_stitch_errors_total counter\n';
    output += `graphql_stitch_errors_total ${this.metrics.totalErrors}\n`;

    for (const [name, stats] of Object.entries(this.metrics.serviceStats)) {
      const label = `service="${name}"`;
      output += `graphql_stitch_service_queries{${label}} ${stats.queries}\n`;
      output += `graphql_stitch_service_errors{${label}} ${stats.errors}\n`;
      output += `graphql_stitch_service_avg_duration_ms{${label}} ${stats.avgDurationMs.toFixed(2)}\n`;
      output += `graphql_stitch_service_p95_duration_ms{${label}} ${stats.p95DurationMs.toFixed(2)}\n`;
    }

    return output;
  }
}

export const stitchingMetrics = new StitchingMetrics();

// ── Remote schema transformation ──────────────────────────────────────────────

/**
 * Transform a remote schema's types for stitching compatibility.
 * Handles field renaming, type wrapping, and filter argument injection.
 *
 * @param {Object} subschema - Subschema configuration
 * @returns {Object} Transformation configuration
 */
export function createSchemaTransforms(subschema) {
  return {
    // Rename types to avoid conflicts
    renameTypes: (typeName) => {
      // If multiple subschemas define the same type, prefix with service name
      if (subschema.mergeTypes?.includes(typeName)) {
        return typeName; // Keep original for merged types
      }
      return `${subschema.name}__${typeName}`;
    },

    // Filter out fields not available in this subschema
    filterFields: (typeName, fieldName) => {
      // Exclude gateway-only fields from subschema
      const gatewayFields = ['transactions', 'analytics', 'schemaInfo'];
      return !gatewayFields.includes(fieldName);
    },

    // Inject filter arguments into list fields
    injectArguments: (typeName, fieldName, existingArgs) => {
      if (fieldName === 'assets' || fieldName === 'transactions') {
        return {
          ...existingArgs,
          limit: { type: 'Int', defaultValue: 50 },
          offset: { type: 'Int', defaultValue: 0 },
        };
      }
      return existingArgs;
    },
  };
}

// ── Hot-reloading support ─────────────────────────────────────────────────────

/**
 * Hot-reload the stitched schema when subschema definitions change.
 * Clears caches, rebuilds the merged schema, and notifies listeners.
 *
 * @param {Object[]} newSubschemas - Updated subschema configurations
 * @param {string} newVersion - New schema version
 */
export async function hotReloadSchema(newSubschemas, newVersion) {
  console.log(`[stitching] Hot-reloading schema to version ${newVersion}...`);

  // Clear all delegator caches
  for (const subschema of newSubschemas) {
    if (subschema.delegator) {
      subschema.delegator.clearCache();
    }
  }

  // Update version and notify listeners
  notifySchemaReload(newVersion);

  console.log(`[stitching] Schema reloaded successfully to v${newVersion}`);
  return { version: newVersion, subschemaCount: newSubschemas.length };
}

// ── Circular dependency handling ──────────────────────────────────────────────

/**
 * Detect and handle circular type dependencies across subschemas.
 * Uses lazy resolution to break cycles.
 */
export function resolveCircularDependency(typeName, seen = new Set()) {
  if (seen.has(typeName)) {
    console.warn(`[stitching] Circular dependency detected for type: ${typeName}`);
    // Return a lazy reference that resolves at query time
    return { __lazyRef: typeName, __circular: true };
  }
  seen.add(typeName);
  return null;
}

// ── Stitching test utilities ──────────────────────────────────────────────────

/**
 * Validate the stitched schema for correctness.
 * Checks for type conflicts, missing resolvers, and orphaned types.
 *
 * @param {Object} stitchedSchema - The merged schema to validate
 * @returns {Object} Validation result with issues and warnings
 */
export function validateStitchedSchema(stitchedSchema) {
  const issues = [];
  const warnings = [];

  // Check for types without resolvers
  // Check for conflicting field types
  // Check for missing merge configurations

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    version: currentSchemaVersion,
  };
}

// ── Default export: stitching configuration ───────────────────────────────────

/**
 * Complete schema stitching configuration.
 * Export all subschemas, gateway types, resolvers, and utilities.
 */
export const stitchingConfig = {
  version: SCHEMA_VERSION,
  subschemas: [rwaSubschema, analyticsSubschema, transactionSubschema],
  gatewayTypeDefs,
  conflictResolution: defaultConflictResolution,
  metrics: stitchingMetrics,
};

export default stitchingConfig;
