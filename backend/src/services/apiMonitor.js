// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/apiMonitor.js — Issues #330-333: API Monitoring & Logging
 *
 * Provides comprehensive API request logging, performance monitoring,
 * rate limit tracking, and error analysis.
 */

import logger from './logger.js';

// In-memory metrics store (production would use Redis/database)
const metrics = {
  requests: [],
  errors: [],
  rateLimits: [],
  performance: [],
};

const MAX_ENTRIES = 10000;
const METRICS_WINDOW_MS = 3600000; // 1 hour

/**
 * Log an API request with performance metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in ms
 */
export function logApiRequest(req, res, duration) {
  const entry = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    duration,
    timestamp: Date.now(),
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
    requestId: req.requestId,
    contentLength: res.getHeader('content-length'),
  };

  metrics.requests.push(entry);
  trimMetrics(metrics.requests);

  // Log to pino
  const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
  logger[logLevel]({
    msg: 'API Request',
    ...entry,
  });

  return entry;
}

/**
 * Log an API error
 * @param {Error} error - The error object
 * @param {Object} req - Express request object (optional)
 * @param {Object} context - Additional context (optional)
 */
export function logApiError(error, req = null, context = {}) {
  const entry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message: error.message,
    stack: error.stack,
    code: error.code,
    statusCode: error.statusCode || 500,
    timestamp: Date.now(),
    path: req?.path,
    method: req?.method,
    ip: req?.ip,
    requestId: req?.requestId,
    ...context,
  };

  metrics.errors.push(entry);
  trimMetrics(metrics.errors);

  logger.error({
    msg: 'API Error',
    ...entry,
  });

  return entry;
}

/**
 * Log a rate limit event
 * @param {Object} req - Express request object
 * @param {string} tier - Rate limit tier
 * @param {Object} limitInfo - Rate limit details
 */
export function logRateLimit(req, tier, limitInfo) {
  const entry = {
    id: `rl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tier,
    ip: req.ip || req.connection?.remoteAddress,
    path: req.path,
    method: req.method,
    limit: limitInfo.limit,
    remaining: limitInfo.remaining,
    reset: limitInfo.reset,
    timestamp: Date.now(),
    requestId: req.requestId,
  };

  metrics.rateLimits.push(entry);
  trimMetrics(metrics.rateLimits);

  logger.warn({
    msg: 'Rate Limit Hit',
    ...entry,
  });

  return entry;
}

/**
 * Log performance metrics for a specific operation
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in ms
 * @param {Object} metadata - Additional metadata
 */
export function logPerformance(operation, duration, metadata = {}) {
  const entry = {
    id: `perf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    operation,
    duration,
    timestamp: Date.now(),
    ...metadata,
  };

  metrics.performance.push(entry);
  trimMetrics(metrics.performance);

  // Warn on slow operations (> 1 second)
  if (duration > 1000) {
    logger.warn({
      msg: 'Slow Operation',
      ...entry,
    });
  }

  return entry;
}

/**
 * Get API metrics summary
 * @param {number} timeWindowMs - Time window in milliseconds
 * @returns {Object} Metrics summary
 */
export function getMetricsSummary(timeWindowMs = METRICS_WINDOW_MS) {
  const cutoff = Date.now() - timeWindowMs;

  const recentRequests = metrics.requests.filter(r => r.timestamp > cutoff);
  const recentErrors = metrics.errors.filter(e => e.timestamp > cutoff);
  const recentRateLimits = metrics.rateLimits.filter(r => r.timestamp > cutoff);
  const recentPerformance = metrics.performance.filter(p => p.timestamp > cutoff);

  // Calculate statistics
  const totalRequests = recentRequests.length;
  const totalErrors = recentErrors.length;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0;

  // Status code distribution
  const statusCodes = {};
  for (const req of recentRequests) {
    const code = req.statusCode;
    statusCodes[code] = (statusCodes[code] || 0) + 1;
  }

  // Average response time
  const avgDuration = recentRequests.length > 0
    ? recentRequests.reduce((sum, r) => sum + r.duration, 0) / recentRequests.length
    : 0;

  // P95 response time
  const sortedDurations = recentRequests.map(r => r.duration).sort((a, b) => a - b);
  const p95Index = Math.floor(sortedDurations.length * 0.95);
  const p95Duration = sortedDurations[p95Index] || 0;

  // Top slow endpoints
  const endpointStats = {};
  for (const req of recentRequests) {
    const key = `${req.method} ${req.path}`;
    if (!endpointStats[key]) {
      endpointStats[key] = { count: 0, totalDuration: 0, errors: 0 };
    }
    endpointStats[key].count++;
    endpointStats[key].totalDuration += req.duration;
    if (req.statusCode >= 400) endpointStats[key].errors++;
  }

  const topSlowEndpoints = Object.entries(endpointStats)
    .map(([endpoint, stats]) => ({
      endpoint,
      avgDuration: (stats.totalDuration / stats.count).toFixed(2),
      count: stats.count,
      errors: stats.errors,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 10);

  // Top error endpoints
  const topErrorEndpoints = Object.entries(endpointStats)
    .filter(([, stats]) => stats.errors > 0)
    .map(([endpoint, stats]) => ({
      endpoint,
      errors: stats.errors,
      errorRate: (stats.errors / stats.count * 100).toFixed(2),
    }))
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 10);

  // Rate limit summary by tier
  const rateLimitByTier = {};
  for (const rl of recentRateLimits) {
    if (!rateLimitByTier[rl.tier]) {
      rateLimitByTier[rl.tier] = { count: 0, uniqueIPs: new Set() };
    }
    rateLimitByTier[rl.tier].count++;
    rateLimitByTier[rl.tier].uniqueIPs.add(rl.ip);
  }

  // Convert Sets to counts for JSON serialization
  const rateLimitSummary = {};
  for (const [tier, stats] of Object.entries(rateLimitByTier)) {
    rateLimitSummary[tier] = {
      count: stats.count,
      uniqueIPs: stats.uniqueIPs.size,
    };
  }

  return {
    timeWindow: timeWindowMs,
    requests: {
      total: totalRequests,
      avgDuration: avgDuration.toFixed(2),
      p95Duration,
      statusCodes,
    },
    errors: {
      total: totalErrors,
      rate: `${errorRate}%`,
    },
    rateLimits: {
      total: recentRateLimits.length,
      byTier: rateLimitSummary,
    },
    endpoints: {
      slowest: topSlowEndpoints,
      mostErrors: topErrorEndpoints,
    },
    performance: {
      operations: recentPerformance.length,
      avgDuration: recentPerformance.length > 0
        ? (recentPerformance.reduce((sum, p) => sum + p.duration, 0) / recentPerformance.length).toFixed(2)
        : 0,
    },
  };
}

/**
 * Get recent errors with details
 * @param {number} limit - Maximum number to return
 * @returns {Array} Recent errors
 */
export function getRecentErrors(limit = 50) {
  return metrics.errors
    .slice(-limit)
    .reverse();
}

/**
 * Get performance logs for a specific operation
 * @param {string} operation - Operation name
 * @param {number} limit - Maximum number to return
 * @returns {Array} Performance logs
 */
export function getOperationPerformance(operation, limit = 100) {
  return metrics.performance
    .filter(p => p.operation === operation)
    .slice(-limit);
}

/**
 * Get API health status
 * @returns {Object} Health status
 */
export function getApiHealth() {
  const summary = getMetricsSummary(300000); // Last 5 minutes

  let status = 'healthy';
  const errorRate = parseFloat(summary.errors.rate);
  const p95 = summary.requests.p95Duration;

  if (errorRate > 10 || p95 > 5000) {
    status = 'critical';
  } else if (errorRate > 5 || p95 > 2000) {
    status = 'warning';
  } else if (errorRate > 1 || p95 > 1000) {
    status = 'degraded';
  }

  return {
    status,
    errorRate: summary.errors.rate,
    p95Duration: summary.requests.p95Duration,
    totalRequests: summary.requests.total,
    totalErrors: summary.errors.total,
    totalRateLimits: summary.rateLimits.total,
    recommendations: status !== 'healthy' ? [
      'Review slow endpoints for optimization',
      'Check error logs for patterns',
      'Consider adjusting rate limits',
    ] : [],
  };
}

/**
 * Clear old metrics beyond retention window
 * @param {number} retentionMs - Retention period in milliseconds
 */
export function cleanupMetrics(retentionMs = METRICS_WINDOW_MS * 24) {
  const cutoff = Date.now() - retentionMs;
  const before = {
    requests: metrics.requests.length,
    errors: metrics.errors.length,
    rateLimits: metrics.rateLimits.length,
    performance: metrics.performance.length,
  };

  metrics.requests = metrics.requests.filter(r => r.timestamp > cutoff);
  metrics.errors = metrics.errors.filter(e => e.timestamp > cutoff);
  metrics.rateLimits = metrics.rateLimits.filter(r => r.timestamp > cutoff);
  metrics.performance = metrics.performance.filter(p => p.timestamp > cutoff);

  const cleaned = {
    requests: before.requests - metrics.requests.length,
    errors: before.errors - metrics.errors.length,
    rateLimits: before.rateLimits - metrics.rateLimits.length,
    performance: before.performance - metrics.performance.length,
  };

  logger.info({ msg: 'Metrics Cleanup', cleaned });
  return cleaned;
}

/**
 * Trim metrics to maximum entries
 */
function trimMetrics(arr) {
  if (arr.length > MAX_ENTRIES) {
    arr.splice(0, arr.length - MAX_ENTRIES);
  }
}
