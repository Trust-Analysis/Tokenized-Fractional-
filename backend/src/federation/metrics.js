// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/metrics.js
 *
 * Prometheus instrumentation for the GraphQL Federation layer.
 *
 * Exported metrics:
 *   - graphql_federation_query_duration_seconds  (histogram)  — total gateway request duration
 *   - graphql_federation_subgraph_duration_seconds (histogram) — per-subgraph request duration
 *   - graphql_federation_entity_cache_hits_total  (counter)   — entity cache hits
 *   - graphql_federation_entity_cache_misses_total (counter)  — entity cache misses
 *   - graphql_federation_subgraph_errors_total    (counter)   — per-subgraph error count
 */

import { register, Histogram, Counter } from 'prom-client';

// ── Gateway-level query duration ──────────────────────────────────────────────

export const federationQueryDuration = new Histogram({
  name: 'graphql_federation_query_duration_seconds',
  help: 'Duration of federated GraphQL operations from gateway receipt to response',
  labelNames: ['operation_type', 'operation_name'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// ── Per-subgraph request duration ─────────────────────────────────────────────

export const subgraphQueryDuration = new Histogram({
  name: 'graphql_federation_subgraph_duration_seconds',
  help: 'Duration of individual subgraph requests during query planning',
  labelNames: ['subgraph', 'operation_type'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

// ── Entity cache counters ─────────────────────────────────────────────────────

export const entityCacheHits = new Counter({
  name: 'graphql_federation_entity_cache_hits_total',
  help: 'Number of entity lookups served from the in-memory cache',
  labelNames: ['entity_type'],
  registers: [register],
});

export const entityCacheMisses = new Counter({
  name: 'graphql_federation_entity_cache_misses_total',
  help: 'Number of entity lookups that required a subgraph fetch',
  labelNames: ['entity_type'],
  registers: [register],
});

// ── Subgraph error counter ────────────────────────────────────────────────────

export const subgraphErrors = new Counter({
  name: 'graphql_federation_subgraph_errors_total',
  help: 'Number of errors returned by individual subgraph services',
  labelNames: ['subgraph', 'error_type'],
  registers: [register],
});

/**
 * Express middleware that records the overall gateway query duration.
 * Attach to the /graphql route before the Apollo Server handler.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
export function federationMetricsMiddleware(req, res, next) {
  if (req.method !== 'POST') return next();

  const end = federationQueryDuration.startTimer({
    operation_type: 'unknown',
    operation_name: 'unknown',
  });

  // Patch res.json to capture operation info from the response body
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      // Apollo Server always returns { data, errors } — use query body if present
      if (req.body?.operationName) {
        end({
          operation_type: req.body.query?.trimStart().startsWith('mutation')
            ? 'mutation'
            : 'query',
          operation_name: req.body.operationName || 'anonymous',
        });
      } else {
        end({ operation_type: 'query', operation_name: 'anonymous' });
      }
    } catch {
      end({ operation_type: 'unknown', operation_name: 'unknown' });
    }
    return originalJson(body);
  };

  next();
}
