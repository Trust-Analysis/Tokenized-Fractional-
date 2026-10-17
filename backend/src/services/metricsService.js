// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/metricsService.js — Prometheus Metrics for Backend Observability (Issue #518)
 *
 * Exposes Prometheus metrics via /metrics:
 * - HTTP request durations (histogram)
 * - Error rates (counters & status tracking)
 * - Active WebSocket connections (gauge)
 * - Database connection pool utilization (gauges)
 * - Disk usage on the volume holding DATA_FILE (gauge, issue #801)
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import prometheus from 'express-prom-bundle';
import { wsManager } from '../../websocket.js';
import { getPoolStats } from './database.js';
import { readDiskUsageSync, resolveDataDirectory } from '../utils/diskUsage.js';

const promClient = prometheus.promClient;
const register = promClient.register;

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
// The backend writes `data.json` to the instance's local disk. Scraping the
// ratio here means the existing Prometheus/Grafana stack can alert on it with a
// rule of its own, without the backend polling in the background: `collect()`
// runs only when /metrics is scraped.
//
// BACKEND_ROOT is two levels up from this file (backend/src/services).
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Disk usage ratio (used / total) for the volume holding DATA_FILE.
 *
 * Reports 0 when the filesystem cannot be measured. That is deliberate — a
 * gauge that throws would fail the whole /metrics scrape and take every other
 * metric down with it — but it does mean a monitoring rule should treat "ratio
 * == 0 unexpectedly" as a measurement failure. The `available` bytes and the
 * explicit status are surfaced on GET /health for that case.
 */
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

/**
 * Bytes available to the backend on the volume holding DATA_FILE.
 *
 * `bavail` semantics: space an unprivileged process can actually write to, not
 * the total free space including the root-reserved blocks.
 */
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

/**
 * Normalize express route path for high-cardinality metric label prevention
 */
function normalizeRoute(req) {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  // Mask variable IDs if route is not matched
  const url = req.path || req.url || '/';
  return url
    .replace(/\/C[A-Z0-9]{50,}/g, '/:contractId')
    .replace(/\/bafy[a-z0-9]+/g, '/:cid')
    .replace(/\/0x[a-fA-F0-9]+/g, '/:hash')
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
