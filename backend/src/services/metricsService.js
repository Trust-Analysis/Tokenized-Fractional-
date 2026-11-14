// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/metricsService.js — Prometheus Metrics for Backend Observability (Issue #518)
 *
 * Exposes Prometheus metrics via /metrics:
 * - HTTP request durations & latencies (histogram per route/method/status)
 * - HTTP request counts & error rates (counters per route/method/status)
 * - Business metrics:
 *   - Total tokenized assets (gauge) & assets by type (gauge)
 *   - Total purchases proxied through the backend (gauge)
 *   - Total purchase volume in USD/payment tokens (gauge)
 *   - Total unique buyers (gauge)
 *   - Purchases processed counter (counter by status)
 * - Active WebSocket connections (gauge)
 * - Database connection pool utilization (gauges)
 * - Disk usage on the volume holding DATA_FILE (gauge, issue #801)
 * - WebSocket dead-letter-queue size, drops and failures (gauges, issue #902)
 * - Node.js default runtime metrics (memory, CPU, event loop lag)
 *
 * Production security:
 * - In production (NODE_ENV=production or METRICS_AUTH_REQUIRED=true),
 *   the /metrics endpoint requires authentication via Bearer token, Basic auth,
 *   or x-api-key header.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import prometheus from 'express-prom-bundle';
import { wsManager } from '../../websocket.js';
import { websocketDLQService } from './websocketDLQService.js';
import { getPoolStats, getDatabase } from './database.js';
import { readDiskUsageSync, resolveDataDirectory } from '../utils/diskUsage.js';
import { loadData } from './dataService.js';

const promClient = prometheus.promClient;
const register = promClient.register;

// Enable standard Node.js default runtime metrics (process memory, CPU, event loop, etc.)
try {
  promClient.collectDefaultMetrics({ register });
} catch {
  // Ignore if already registered during test re-runs
}

/**
 * Helper to safely get an existing metric or register a new one.
 * Prevents "A metric with the name ... has already been registered" error during test re-runs.
 */
function getOrRegister(MetricClass, config) {
  const existing = register.getSingleMetric(config.name);
  if (existing) {
    return existing;
  }
  return new MetricClass(config);
}

// ── 1. HTTP Request Durations ────────────────────────────────────────────────
export const httpRequestDuration = getOrRegister(promClient.Histogram, {
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ── 2. HTTP Request Counts & Error Rates ──────────────────────────────────────
export const httpRequestsTotal = getOrRegister(promClient.Counter, {
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestErrors = getOrRegister(promClient.Counter, {
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors (status >= 400)',
  labelNames: ['method', 'route', 'status_code'],
});

// ── 3. Active WebSocket Connections ──────────────────────────────────────────
export const websocketActiveConnections = getOrRegister(promClient.Gauge, {
  name: 'websocket_active_connections',
  help: 'Current number of active WebSocket client connections',
  collect() {
    try {
      const activeCount = wsManager && wsManager.clients ? wsManager.clients.size : 0;
      this.set(activeCount);
    } catch {
      this.set(0);
    }
  },
});

// ── 4. Database Connection Pool Utilization ──────────────────────────────────
export const dbPoolUtilization = getOrRegister(promClient.Gauge, {
  name: 'db_pool_utilization_ratio',
  help: 'Database connection pool utilization ratio (usedConnections / maxConnections)',
  collect() {
    try {
      const stats = getPoolStats();
      if (stats && stats.maxConnections > 0) {
        this.set(stats.usedConnections / stats.maxConnections);
      } else {
        this.set(0);
      }
    } catch {
      this.set(0);
    }
  },
});

export const dbPoolConnections = getOrRegister(promClient.Gauge, {
  name: 'db_pool_connections',
  help: 'Database connection pool connections count by state (used, free, pending)',
  labelNames: ['state'],
  collect() {
    try {
      const stats = getPoolStats();
      if (stats) {
        this.set({ state: 'used' }, stats.usedConnections || 0);
        this.set({ state: 'free' }, stats.freeConnections || 0);
        this.set({ state: 'pending' }, stats.pendingRequests || 0);
      }
    } catch {
      this.set({ state: 'used' }, 0);
      this.set({ state: 'free' }, 0);
      this.set({ state: 'pending' }, 0);
    }
  },
});

// ── 5. Disk usage (issue #801) ───────────────────────────────────────────────
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const diskUsageRatio = getOrRegister(promClient.Gauge, {
  name: 'disk_usage_ratio',
  help: 'Disk usage ratio (used / total) for the volume holding DATA_FILE',
  collect() {
    try {
      const usage = readDiskUsageSync(resolveDataDirectory(BACKEND_ROOT));
      if (usage.status === 'unknown' || !usage.totalBytes) {
        this.set(0);
      } else {
        this.set(usage.usedBytes / usage.totalBytes);
      }
    } catch {
      this.set(0);
    }
  },
});

export const diskAvailableBytes = getOrRegister(promClient.Gauge, {
  name: 'disk_available_bytes',
  help: 'Bytes available to this process on the volume holding DATA_FILE',
  collect() {
    try {
      const usage = readDiskUsageSync(resolveDataDirectory(BACKEND_ROOT));
      this.set(usage.availableBytes || 0);
    } catch {
      this.set(0);
    }
  },
});

// ── 6. WebSocket dead-letter queue (issue #902) ──────────────────────────────
let dlqStatsPromise = null;
function dlqStatsForScrape() {
  if (!dlqStatsPromise) {
    dlqStatsPromise = websocketDLQService.getStats().finally(() => {
      setTimeout(() => {
        dlqStatsPromise = null;
      }, 1000).unref();
    });
  }
  return dlqStatsPromise;
}

function dlqGauge(config, update) {
  return getOrRegister(promClient.Gauge, {
    ...config,
    async collect() {
      try {
        update(this, await dlqStatsForScrape());
      } catch {
        // Leave the previous value; a throwing collect() would fail the scrape.
      }
    },
  });
}

export const websocketDlqMessages = dlqGauge(
  {
    name: 'websocket_dlq_messages',
    help: 'Messages currently buffered in the WebSocket DLQ, by scope (total, largest_channel)',
    labelNames: ['scope'],
  },
  (g, stats) => {
    g.set({ scope: 'total' }, stats.totalMessages);
    g.set({ scope: 'largest_channel' }, stats.largestChannel);
  },
);

export const websocketDlqChannels = dlqGauge(
  {
    name: 'websocket_dlq_channels',
    help: 'Channels with at least one message buffered in the WebSocket DLQ',
  },
  (g, stats) => g.set(stats.channels),
);

export const websocketDlqRecentFailures = dlqGauge(
  {
    name: 'websocket_dlq_recent_delivery_failures',
    help: 'Entries in the WebSocket DLQ delivery-failure log (capped at 1000)',
  },
  (g, stats) => g.set(stats.recentFailures),
);

export const websocketDlqOverThreshold = dlqGauge(
  {
    name: 'websocket_dlq_over_threshold',
    help: '1 when buffered DLQ messages exceed WS_DLQ_ALERT_THRESHOLD, else 0',
  },
  (g, stats) => g.set(stats.overThreshold ? 1 : 0),
);

export const websocketDlqDropped = dlqGauge(
  {
    name: 'websocket_dlq_dropped_messages',
    help: 'Messages dropped by DLQ retention since process start, by reason (size, age)',
    labelNames: ['reason'],
  },
  (g, stats) => {
    g.set({ reason: 'size' }, stats.droppedMessages.size);
    g.set({ reason: 'age' }, stats.droppedMessages.age);
  },
);

// ── 7. Business Metrics ───────────────────────────────────────────────────────
let configuredTransactionService = null;
let configuredApiKeyService = null;

export function setMetricsTransactionService(service) {
  configuredTransactionService = service;
}

export function setMetricsApiKeyService(service) {
  configuredApiKeyService = service;
}

/**
 * Total tokenized real-world assets registered on the platform.
 */
export const rwaTotalAssets = getOrRegister(promClient.Gauge, {
  name: 'rwa_total_assets',
  help: 'Total number of tokenized fractional real-world assets registered on the platform',
  collect() {
    try {
      const data = loadData();
      const count = data && typeof data === 'object' ? Object.keys(data).length : 0;
      this.set(count);
    } catch {
      this.set(0);
    }
  },
});

/**
 * Assets breakdown by asset type (e.g. real_estate, art, commodity).
 */
export const rwaAssetsByType = getOrRegister(promClient.Gauge, {
  name: 'rwa_assets_by_type',
  help: 'Total number of tokenized fractional real-world assets by asset type',
  labelNames: ['asset_type'],
  collect() {
    try {
      const data = loadData();
      const counts = {};
      if (data && typeof data === 'object') {
        for (const asset of Object.values(data)) {
          const type = (asset && asset.assetType) || 'unknown';
          counts[type] = (counts[type] || 0) + 1;
        }
      }
      for (const [type, count] of Object.entries(counts)) {
        this.set({ asset_type: type }, count);
      }
    } catch {
      // Ignored during collection failure
    }
  },
});

/**
 * Total purchases proxied through the backend.
 */
export const rwaPurchasesTotal = getOrRegister(promClient.Gauge, {
  name: 'rwa_purchases_total',
  help: 'Total number of completed share purchases proxied through the backend',
  async collect() {
    try {
      if (configuredTransactionService && typeof configuredTransactionService.getAllTimeMetrics === 'function') {
        const m = await configuredTransactionService.getAllTimeMetrics();
        this.set(Number(m.totalTransactions || 0));
        return;
      }
      const db = getDatabase();
      const res = await db('transactions').where('status', 'completed').count('* as count').first();
      this.set(Number(res?.count || 0));
    } catch {
      // Database not yet initialized or table does not exist
    }
  },
});

/**
 * Total USD / payment volume of completed purchases proxied through the backend.
 */
export const rwaPurchaseVolumeTotal = getOrRegister(promClient.Gauge, {
  name: 'rwa_purchase_volume_total',
  help: 'Total volume (in payment units / USD) of completed purchases proxied through the backend',
  async collect() {
    try {
      if (configuredTransactionService && typeof configuredTransactionService.getAllTimeMetrics === 'function') {
        const m = await configuredTransactionService.getAllTimeMetrics();
        this.set(Number(m.totalVolume || 0));
        return;
      }
      const db = getDatabase();
      const res = await db('transactions').where('status', 'completed').sum('total_amount as volume').first();
      this.set(Number(res?.volume || 0));
    } catch {
      // Database not yet initialized
    }
  },
});

/**
 * Total unique buyers across all purchases.
 */
export const rwaUniqueBuyersTotal = getOrRegister(promClient.Gauge, {
  name: 'rwa_unique_buyers_total',
  help: 'Total number of unique buyers that have completed purchases',
  async collect() {
    try {
      if (configuredTransactionService && typeof configuredTransactionService.getAllTimeMetrics === 'function') {
        const m = await configuredTransactionService.getAllTimeMetrics();
        this.set(Number(m.uniqueBuyers || 0));
        return;
      }
      const db = getDatabase();
      const res = await db('transactions').where('status', 'completed').countDistinct('buyer_address as count').first();
      this.set(Number(res?.count || 0));
    } catch {
      // Database not yet initialized
    }
  },
});

/**
 * Real-time counter of purchase requests processed by the backend.
 */
export const rwaPurchasesProcessed = getOrRegister(promClient.Counter, {
  name: 'rwa_purchases_processed_total',
  help: 'Total number of purchase requests processed by the backend',
  labelNames: ['status'],
});

/**
 * Helper to record purchase metrics from transaction handlers
 */
export function recordPurchaseMetric(info = {}) {
  try {
    const status = info.status || 'completed';
    rwaPurchasesProcessed.inc({ status });
  } catch {
    // Metric recording should never throw
  }
}

// ── Route Normalization ───────────────────────────────────────────────────────
/**
 * Normalize express route path for high-cardinality metric label prevention
 */
export function normalizeRoute(req) {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    const routePath = req.route.path instanceof RegExp ? req.route.path.toString() : req.route.path;
    return `${base}${routePath}`;
  }
  // Mask variable IDs if route is not matched
  const rawUrl = req.originalUrl || req.path || req.url || '/';
  const url = rawUrl.split('?')[0];
  return url
    .replace(/\/C[A-Z0-9]{50,}/g, '/:contractId')
    .replace(/\/bafy[a-z0-9]+/g, '/:cid')
    .replace(/\/0x[a-fA-F0-9]+/g, '/:hash')
    .replace(/\/tx_[a-zA-Z0-9_-]+/g, '/:transactionId')
    .replace(/\/user_[a-zA-Z0-9_-]+/g, '/:userId')
    .replace(/\/G[A-Z0-9]{55}/g, '/:stellarAddress')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Express middleware to track HTTP request durations and error rates
 */
export function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') {
    return next();
  }

  const startHrTime = process.hrtime();

  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const durationInSeconds = elapsedHrTime[0] + elapsedHrTime[1] / 1e9;
    const method = req.method;
    const route = normalizeRoute(req);
    const statusCode = String(res.statusCode);

    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationInSeconds);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });

    if (res.statusCode >= 400) {
      httpRequestErrors.inc({ method, route, status_code: statusCode });
    }
  });

  next();
}

// ── Production Authentication ─────────────────────────────────────────────────
/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeTimingCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Factory for metrics authentication middleware
 */
export function createMetricsAuthMiddleware(options = {}) {
  return async function metricsAuthMiddleware(req, res, next) {
    const env = options.env || process.env;
    const apiKeyService = options.apiKeyService || configuredApiKeyService;

    // Allow explicit bypass if configured
    if (env.METRICS_AUTH_DISABLED === 'true') {
      return next();
    }

    // Enforce authentication in production or when explicitly configured
    const isRequired =
      options.authRequired !== undefined
        ? options.authRequired
        : env.NODE_ENV === 'production' || env.METRICS_AUTH_REQUIRED === 'true';

    if (!isRequired) {
      return next();
    }

    const expectedApiKey = env.METRICS_API_KEY || env.ADMIN_API_KEY;
    const expectedBearer = env.METRICS_BEARER_TOKEN || env.METRICS_TOKEN || env.ADMIN_API_KEY;
    const expectedUser = env.METRICS_USER || 'metrics';
    const expectedPassword = env.METRICS_PASSWORD || env.ADMIN_API_KEY;

    // 1. API Key via x-api-key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader) {
      if (expectedApiKey && safeTimingCompare(apiKeyHeader, expectedApiKey)) {
        return next();
      }
      if (apiKeyService && typeof apiKeyService.validate === 'function') {
        try {
          const validation = await apiKeyService.validate(apiKeyHeader);
          if (validation && validation.valid) {
            return next();
          }
        } catch {
          // Fall through to 401
        }
      }
    }

    // 2. Authorization header (Bearer or Basic)
    const authHeader = req.headers.authorization;
    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (expectedBearer && safeTimingCompare(token, expectedBearer)) {
          return next();
        }
      }

      if (authHeader.startsWith('Basic ')) {
        try {
          const b64 = authHeader.slice(6).trim();
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          const colonIdx = decoded.indexOf(':');
          if (colonIdx !== -1) {
            const user = decoded.slice(0, colonIdx);
            const pass = decoded.slice(colonIdx + 1);

            const passMatches =
              (expectedPassword && safeTimingCompare(pass, expectedPassword)) ||
              (expectedApiKey && safeTimingCompare(pass, expectedApiKey));

            if (passMatches) {
              const userMatches =
                !env.METRICS_USER ||
                safeTimingCompare(user, expectedUser) ||
                user === 'admin' ||
                user === 'prometheus';

              if (userMatches) {
                return next();
              }
            }
          }
        } catch {
          // Invalid base64, fall through
        }
      }
    }

    // Reject unauthenticated requests in production
    res.setHeader('WWW-Authenticate', 'Basic realm="Prometheus Metrics", Bearer realm="Prometheus Metrics"');
    return res.status(401).json({
      status: 401,
      error: 'Unauthorized',
      message: 'Authentication required to access /metrics in production',
      code: 'METRICS_AUTHENTICATION_REQUIRED',
    });
  };
}

export const metricsAuthMiddleware = createMetricsAuthMiddleware();

/**
 * Controller handler for GET /metrics
 */
export async function metricsHandler(_req, res) {
  try {
    res.setHeader('Content-Type', register.contentType);
    const metricsData = await register.metrics();
    res.send(metricsData);
  } catch (error) {
    res.status(500).send(error.message);
  }
}

export { register, promClient };
