// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/validate.js — Advanced Request Validation Middleware (#260)
 * Pure-JS schema validation for all API endpoints.
 */

import { routeSchemas, SCHEMA_VERSION, ValidationError, s } from '../validators/schemas.js';

function formatValidationError(err) {
  if (err instanceof ValidationError) {
    return {
      error: 'Validation failed', code: 'VALIDATION_ERROR',
      message: err.message, fieldErrors: err.fieldErrors,
      fields: err.fieldErrors.reduce((acc, fe) => {
        if (!acc[fe.field]) acc[fe.field] = [];
        acc[fe.field].push({ message: fe.message, code: fe.code });
        return acc;
      }, {}),
      schemaVersion: SCHEMA_VERSION,
      hint: 'Check the "fieldErrors" array for details on each invalid field.',
    };
  }
  return { error: 'Validation failed', code: 'VALIDATION_ERROR', message: err.message, schemaVersion: SCHEMA_VERSION };
}

function matchRoutePattern(method, path) {
  const exactKey = `${method} ${path}`;
  if (routeSchemas[exactKey]) return { schema: routeSchemas[exactKey], params: {} };

  const pathSegments = path.split('/').filter(Boolean);
  const methodPrefix = `${method} /`;
  const routeKeys = Object.keys(routeSchemas);
  for (let r = 0; r < routeKeys.length; r += 1) {
    const routeKey = routeKeys[r];
    if (!routeKey.startsWith(methodPrefix)) continue;
    const routePath = routeKey.slice(method.length + 1);
    const routeSegments = routePath.split('/').filter(Boolean);
    if (routeSegments.length !== pathSegments.length) continue;

    const params = {};
    let matches = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      if (routeSegments[i].startsWith(':')) {
        params[routeSegments[i].slice(1)] = pathSegments[i];
      } else if (routeSegments[i] !== pathSegments[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return { schema: routeSchemas[routeKey], params };
  }
  return null;
}

export function createValidationMiddleware(options = {}) {
  const { strict = false } = options;

  return (req, res, next) => {
    const method = req.method.toUpperCase();
    const path = req.path;

    if (!path.startsWith('/api/') && path !== '/api') return next();

    const skipPrefixes = ['/health', '/metrics', '/api-docs', '/graphql',
      '/api/admin/verify', '/api/v1/admin/verify', '/api/batch'];
    if (skipPrefixes.some((sp) => path.startsWith(sp))) return next();

    let schemaPath = path;
    if (schemaPath.startsWith('/api/v1/')) schemaPath = schemaPath.slice('/api/v1'.length);
    else if (schemaPath.startsWith('/api/')) schemaPath = schemaPath.slice('/api'.length);

    if (req.headers['x-batch-internal'] === '1') return next();

    const match = matchRoutePattern(method, schemaPath);
    if (!match) {
      if (strict) return res.status(400).json({ error: 'No validation schema found for this route', code: 'NO_SCHEMA', method, path: schemaPath, requestId: req.requestId });
      return next();
    }

    const { schema } = match;
    if (schema.body) {
      const error = s.validate(schema.body, req.body);
      if (error) return res.status(400).json({ ...formatValidationError(error), requestId: req.requestId });
    }
    if (schema.query) {
      const error = s.validate(schema.query, req.query);
      if (error) return res.status(400).json({ ...formatValidationError(error), requestId: req.requestId });
    }
    if (schema.params) {
      const error = s.validate(schema.params, req.params);
      if (error) return res.status(400).json({ ...formatValidationError(error), requestId: req.requestId });
    }
    if (schema.headers) {
      const error = s.validate(schema.headers, req.headers);
      if (error) return res.status(400).json({ ...formatValidationError(error), requestId: req.requestId });
    }
    next();
  };
}

export function composeValidators(...validators) {
  return async (req, res, next) => {
    for (let i = 0; i < validators.length; i += 1) {
      try {
        const result = await validators[i](req);
        if (result !== true && result !== undefined) {
          return res.status(400).json({ error: 'Validation failed', code: 'CUSTOM_VALIDATION_ERROR', message: typeof result === 'string' ? result : result.message, requestId: req.requestId });
        }
      } catch (error) {
        return res.status(400).json({ error: 'Validation failed', code: 'CUSTOM_VALIDATION_ERROR', message: error.message, requestId: req.requestId });
      }
    }
    next();
  };
}

export { SCHEMA_VERSION, formatValidationError };
