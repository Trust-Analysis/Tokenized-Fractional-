// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/problemDetails.js — global error exception filter/interceptor
 * (Issue #519).
 *
 * Provides three building blocks:
 *
 *   1. createProblemDetailsInterceptor() — an express middleware that patches
 *      `res.json` so that any legacy error payload (an object carrying `error`,
 *      `code`, `reason`, or `message`) returned by ANY handler is transparently
 *      normalized to an RFC 7807 `application/problem+json` document.
 *
 *      This guarantees a consistent shape for the ~200 inline
 *      `res.status(4xx/5xx).json({ error, code, ... })` responses across the
 *      codebase without editing each handler.
 *
 *   2. problemDetailsNotFoundHandler() — 404 handler producing RFC 7807 output.
 *
 *   3. problemDetailsErrorHandler() — the catch-all 4-arg express error handler
 *      that formats any thrown/unhandled error (ProblemError, validation
 *      errors, rate limit errors, etc.) into RFC 7807 output.
 *
 * Every problem response includes the mandatory fields:
 *   type, title, status, detail, instance
 */
import { PROBLEM_CONTENT_TYPE, toProblemResponse, toProblemErrorResponse } from '../utils/httpProblem.js';

/**
 * Whether `payload` looks like a legacy error object that should be normalized.
 * Successful payloads (arrays, strings, or objects without any of these keys)
 * pass through unchanged.
 */
function looksLikeErrorPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return (
    payload.error !== undefined || payload.code !== undefined || payload.message !== undefined
  );
}

/**
 * Middleware factory. Register EARLY (before routing) so every downstream
 * `res.json` call is wrapped.
 */
export function createProblemDetailsInterceptor() {
  return (req, res, next) => {
    if (!res.__problemDetailsWrapped) {
      const originalJson = res.json.bind(res);
      res.__problemDetailsWrapped = true;

      res.json = (payload) => {
        // Only error responses are normalized; a 2xx body such as
        // `{ message: 'Asset metadata deleted' }` is a success, not a problem.
        if (res.statusCode >= 400 && looksLikeErrorPayload(payload)) {
          const problem = toProblemResponse(payload, req, res.statusCode);
          res.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
          return originalJson(problem);
        }
        return originalJson(payload);
      };
    }
    next();
  };
}

/**
 * 404 handler producing an RFC 7807 `not-found` problem.
 */
export function problemDetailsNotFoundHandler() {
  return (req, res) => {
    if (!res.__problemDetailsWrapped) {
      res.json = res.json.bind(res);
    }
    const problem = {
      type: 'about:blank#not-found',
      title: 'Not Found',
      status: 404,
      detail: 'The requested resource could not be found.',
      instance: req.requestId ? `${req.originalUrl || req.url}#${req.requestId}` : req.originalUrl || req.url,
      ...(req.requestId ? { requestId: req.requestId } : {}),
    };
    res.status(404).setHeader('Content-Type', PROBLEM_CONTENT_TYPE).json(problem);
  };
}

/**
 * Global 4-arg express error handler. Must be registered LAST (after routes,
 * the 404 handler, and with Sentry's errorHandler preceding it).
 */
export function problemDetailsErrorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const production = process.env.NODE_ENV === 'production';
    // Preserve logging (callers may not have req.log if app didn't set it).
    if (req.log?.error) {
      req.log.error({ err }, 'Unhandled error');
    }

    const status = Number(err.status) || Number(err.statusCode) || 500;

    // SQL injection guard (Issue #356) maps to a 403 security block.
    let problem;
    if (err.code === 'SQL_INJECTION_BLOCKED') {
      problem = {
        type: 'about:blank#forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Invalid request',
        instance: req.requestId ? `${req.originalUrl}#${req.requestId}` : req.originalUrl,
        code: 'SECURITY_BLOCK',
        ...(req.requestId ? { requestId: req.requestId } : {}),
      };
    } else {
      problem = toProblemErrorResponse(err, req, production);
    }

    if (!res.headersSent) {
      res.status(status).setHeader('Content-Type', PROBLEM_CONTENT_TYPE).json(problem);
    } else if (req.log?.error) {
      req.log.error({ err }, 'Error handler invoked after headers sent');
    }
  };
}
