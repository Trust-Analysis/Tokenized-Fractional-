// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Express Middleware for OpenTelemetry Tracing
 * 
 * Automatically creates spans for HTTP requests with:
 * - Request/response attributes
 * - Performance metrics
 * - Error tracking
 * - Request correlation IDs
 */

import { trace, context } from '@opentelemetry/api';
import { randomUUID } from 'crypto';

const tracer = trace.getTracer('express-tracing');

/**
 * Express middleware for request tracing
 * 
 * Adds trace ID and span ID to request and response headers
 * Creates spans for request processing
 */
export function createTracingMiddleware() {
  return (req, res, next) => {
    // Generate or extract trace ID
    const traceId = req.headers['x-trace-id'] || req.headers['traceparent'] || randomUUID();
    const spanId = randomUUID();

    // Attach to request for use in downstream code
    req.traceId = traceId;
    req.spanId = spanId;

    // Add to response headers for client correlation
    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-span-id', spanId);

    // Create root span for this request
    const spanName = `${req.method} ${req.path}`;
    const span = tracer.startSpan(spanName, {
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.target': req.path,
        'http.scheme': req.protocol,
        'http.host': req.hostname,
        'http.user_agent': req.headers['user-agent'],
        'http.client_ip': getClientIp(req),
        'http.request_id': req.id, // From requestId middleware
        'trace.id': traceId,
        'span.id': spanId,
      },
    });

    // Record start time for duration
    const startTime = Date.now();

    // Wrap res.end to record response details
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;

      // Add response attributes
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_content_length': res.getHeaders()['content-length'] || 0,
        'http.duration_ms': duration,
      });

      // Record status code range as event
      const statusRange = Math.floor(res.statusCode / 100);
      const statusEvent = {
        '1': 'info',
        '2': 'success',
        '3': 'redirect',
        '4': 'client_error',
        '5': 'server_error',
      }[statusRange] || 'unknown';

      span.addEvent('http_response', {
        'http.status_code': res.statusCode,
        'http.status_class': statusEvent,
        'http.duration_ms': duration,
      });

      // Mark as error if status >= 400
      if (res.statusCode >= 400) {
        span.setStatus({ code: 2 }); // ERROR
      }

      span.end();
      return originalEnd.apply(res, args);
    };

    // Run in span context
    context.with(trace.setSpan(context.active(), span), () => {
      next();
    });
  };
}

/**
 * Middleware to add spans for specific route handlers
 */
export function createRouteTracing(routeName) {
  return (req, res, next) => {
    const span = tracer.startSpan(routeName, {
      attributes: {
        'route.name': routeName,
        'http.method': req.method,
      },
    });

    const originalNext = next;
    const newNext = (err) => {
      if (err) {
        span.recordException(err);
        span.setStatus({ code: 2 }); // ERROR
      }
      span.end();
      return originalNext(err);
    };

    context.with(trace.setSpan(context.active(), span), () => {
      next = newNext;
      next();
    });
  };
}

/**
 * Middleware for GraphQL-specific tracing
 */
export function createGraphQLTracing() {
  return (req, res, next) => {
    if (!req.body || !req.body.query) {
      return next();
    }

    // Extract operation name from query
    const operationName = extractOperationName(req.body.query);
    const operationType = extractOperationType(req.body.query);

    const span = tracer.startSpan(`graphql.${operationType}.${operationName}`, {
      attributes: {
        'graphql.operation.name': operationName,
        'graphql.operation.type': operationType,
        'graphql.query_complexity': req.body.query.length,
      },
    });

    const originalEnd = res.end;
    res.end = function(...args) {
      if (res.locals?.graphqlErrors?.length > 0) {
        span.addEvent('graphql_errors', {
          'error.count': res.locals.graphqlErrors.length,
        });
        span.setStatus({ code: 2 }); // ERROR
      }

      span.end();
      return originalEnd.apply(res, args);
    };

    context.with(trace.setSpan(context.active(), span), () => {
      next();
    });
  };
}

/**
 * Extract GraphQL operation name from query
 */
function extractOperationName(query) {
  if (!query) return 'anonymous';

  // Match operation name: query GetUser(...) or mutation CreateAsset(...) etc
  const match = query.match(/(query|mutation|subscription)\s+(\w+)/i);
  return match ? match[2] : 'anonymous';
}

/**
 * Extract operation type (query, mutation, subscription)
 */
function extractOperationType(query) {
  if (!query) return 'unknown';

  if (query.includes('subscription')) return 'subscription';
  if (query.includes('mutation')) return 'mutation';
  return 'query';
}

/**
 * Extract client IP from request
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Middleware to add span attributes for authenticated requests
 */
export function createAuthTracingMiddleware() {
  return (req, res, next) => {
    const span = trace.getActiveSpan();
    if (span && req.user) {
      span.setAttributes({
        'user.id': req.user.id,
        'user.email': req.user.email,
        'authenticated': true,
      });
    }
    next();
  };
}

/**
 * Middleware to add database operation spans
 */
export function withDatabaseSpan(operationName, table, operation = 'query') {
  return async (req, res, next) => {
    const span = tracer.startSpan(`db.${operation}.${table}`, {
      attributes: {
        'db.operation': operation,
        'db.table': table,
        'db.system': 'postgres',
      },
    });

    const originalQuery = req.query;
    req.query = async (...args) => {
      try {
        const start = Date.now();
        const result = await originalQuery(...args);
        span.setAttribute('db.duration_ms', Date.now() - start);
        span.setAttribute('db.rows_affected', result?.rowCount || 0);
        span.end();
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2 });
        span.end();
        throw error;
      }
    };

    context.with(trace.setSpan(context.active(), span), () => {
      next();
    });
  };
}
