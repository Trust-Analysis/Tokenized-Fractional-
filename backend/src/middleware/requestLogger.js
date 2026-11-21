// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/requestLogger.js — Issue #330: Request Logging Middleware
 *
 * Logs all incoming API requests with timing, status codes,
 * and additional context for monitoring and debugging.
 */

import { logApiRequest, logApiError, logRateLimit } from '../services/apiMonitor.js';

/**
 * Express middleware to log API requests
 * Attaches timing and logs on response finish
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Generate unique request ID if not present
  if (!req.requestId) {
    req.requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logApiRequest(req, res, duration);
  });

  next();
}

/**
 * Express middleware to catch and log unhandled errors
 */
export function errorLogger(err, req, res, next) {
  logApiError(err, req, {
    unhandled: true,
  });

  // Pass to default error handler
  next(err);
}

/**
 * Express middleware to detect and log rate limit hits
 * @param {Function} rateLimiter - Rate limiter function
 * @param {string} tier - Rate limit tier name
 */
export function rateLimitLogger(rateLimiter, tier) {
  return (req, res, next) => {
    rateLimiter(req, res, (err) => {
      if (err) {
        logRateLimit(req, tier, {
          limit: err.limit,
          remaining: 0,
          reset: err.resetTime,
        });
      }
      next(err);
    });
  };
}
