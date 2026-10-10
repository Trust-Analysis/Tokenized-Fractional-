// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/requestId.js — Request ID Middleware
 *
 * Attaches a unique request ID to each incoming request for
 * distributed tracing and log correlation.
 */

import { randomUUID } from 'crypto';

/**
 * Express middleware to attach a unique request ID
 * Uses existing X-Request-ID header if present, otherwise generates one
 */
export function requestId(req, res, next) {
  // Use existing request ID from header or generate new one
  const requestId = req.headers['x-request-id'] || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  req.requestId = requestId;

  // Attach to response headers for client correlation
  res.setHeader('X-Request-ID', requestId);

  next();
}
