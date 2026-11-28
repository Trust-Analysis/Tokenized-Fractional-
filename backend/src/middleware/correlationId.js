// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/correlationId.js — Correlation ID middleware for request tracing.
 *
 * Attaches unique correlation IDs to HTTP requests and WebSocket sessions
 * for distributed tracing across microservices, GraphQL resolvers, and handlers.
 */

import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { createLoggerWithCorrelation } from '../services/logger.js';
import { runWithRequestContext, getRequestContext } from '../../logger.js';

/**
 * Generate or retrieve correlation ID from request
 */
function getCorrelationId(req) {
  // Check for existing correlation ID in headers
  const existingId = req.headers['x-request-id'] || 
                     req.headers['x-correlation-id'] ||
                     req.headers['correlation-id'];
  
  if (existingId) {
    return existingId;
  }

  // Generate new correlation ID
  return randomUUID();
}

/**
 * Express middleware to attach correlation ID to requests
 */
export function correlationIdMiddleware(req, res, next) {
  const correlationId = getCorrelationId(req);

  // Attach correlation ID to request
  req.correlationId = correlationId;
  req.id = correlationId;

  // Add correlation ID to response headers
  res.setHeader('x-request-id', correlationId);
  res.setHeader('x-correlation-id', correlationId);

  // Create child logger with correlation ID
  req.log = createLoggerWithCorrelation(correlationId);

  // Open the shared request context so that every log line emitted while
  // handling the request — handlers, services, background promises — carries
  // the correlation ID without having to thread `req.log` through.
  runWithRequestContext({ correlationId }, next);
}

/**
 * Pino HTTP middleware with correlation ID support
 */
export function pinoCorrelationMiddleware() {
  return pinoHttp({
    logger: createLoggerWithCorrelation('http'),
    useLevel: 'info',
    serializers: {
      req: pinoHttp.stdSerializers.req,
      res: pinoHttp.stdSerializers.res,
      err: pinoHttp.stdSerializers.err,
    },
    redact: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.body.password',
      'req.body.secret',
      'req.body.token',
      'req.body.privateKey',
    ],
    customProps: (req, res) => ({
      correlationId: req.correlationId || req.id,
    }),
  });
}

/**
 * WebSocket correlation ID attachment
 */
export function attachWebSocketCorrelationId(ws, req) {
  const correlationId = getCorrelationId(req);
  
  ws.correlationId = correlationId;
  ws.id = correlationId;
  
  // Attach to WebSocket for use in handlers
  ws.log = createLoggerWithCorrelation(correlationId);
  
  return correlationId;
}

/**
 * Run a function with correlation ID context.
 *
 * Backed by the canonical request context in `logger.js` (issue #703) so that
 * request IDs and correlation IDs share a single async context instead of
 * competing AsyncLocalStorage instances.
 */
export function withCorrelationId(correlationId, fn) {
  return runWithRequestContext({ correlationId }, fn);
}

/**
 * Get current correlation ID from context
 */
export function getCurrentCorrelationId() {
  return getRequestContext().correlationId || null;
}

/**
 * Wrap database queries with correlation ID logging
 */
export function wrapDbQuery(db, queryName) {
  return async (...args) => {
    const correlationId = getCurrentCorrelationId();
    const log = correlationId ? createLoggerWithCorrelation(correlationId) : createLoggerWithCorrelation('db');
    
    log.debug({ query: queryName, args: args.slice(0, 2) }, `Executing DB query: ${queryName}`);
    
    try {
      const result = await db(...args);
      log.debug({ query: queryName, rowsAffected: result?.length || 0 }, `DB query completed: ${queryName}`);
      return result;
    } catch (error) {
      log.error({ query: queryName, error: error.message }, `DB query failed: ${queryName}`);
      throw error;
    }
  };
}

/**
 * Wrap external RPC calls with correlation ID logging
 */
export function wrapRpcCall(rpcFn, serviceName) {
  return async (...args) => {
    const correlationId = getCurrentCorrelationId();
    const log = correlationId ? createLoggerWithCorrelation(correlationId) : createLoggerWithCorrelation('rpc');
    
    log.debug({ service: serviceName, method: args[0] }, `RPC call: ${serviceName}`);
    
    try {
      const result = await rpcFn(...args);
      log.debug({ service: serviceName }, `RPC call completed: ${serviceName}`);
      return result;
    } catch (error) {
      log.error({ service: serviceName, error: error.message }, `RPC call failed: ${serviceName}`);
      throw error;
    }
  };
}

export default correlationIdMiddleware;
