// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/batchHandler.js — REST API Batch Query Support (#256)
 *
 * Enables multiple API operations in a single HTTP request.
 */

import supertest from 'supertest';

const DEFAULT_MAX_BATCH_SIZE = 20;

/**
 * Create the batch handler middleware
 */
export function createBatchHandler(app, options = {}) {
  const maxBatchSize = options.maxBatchSize || DEFAULT_MAX_BATCH_SIZE;
  const { logger } = options;
  const request = supertest(app);

  function buildHeaders(op, originalReq) {
    const headers = {};
    const inheritHeaders = [
      'x-api-key',
      'x-request-id',
      'x-wallet-address',
      'authorization',
      'content-type',
    ];
    for (const h of inheritHeaders) {
      const val = originalReq.headers[h];
      if (val) headers[h] = Array.isArray(val) ? val[0] : val;
    }
    if (op.headers) {
      const keys = Object.keys(op.headers);
      for (let k = 0; k < keys.length; k += 1) {
        const key = keys[k];
        const value = op.headers[key];
        headers[key.toLowerCase()] = typeof value === 'string' ? value : String(value);
      }
    }
    if (['POST', 'PATCH', 'PUT'].includes(op.method?.toUpperCase()) && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    headers['x-batch-internal'] = '1';
    return headers;
  }

  function getNestedValue(obj, path) {
    if (obj == null || typeof obj !== 'object') return undefined;
    const parts = path.split('.');
    let current = obj;
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p];
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current !== undefined ? String(current) : undefined;
  }

  function resolvePath(path, results) {
    return path.replace(/\{(\d+)\.(.+?)\}/g, (_match, opIndex, field) => {
      const idx = parseInt(opIndex, 10);
      if (results[idx] && results[idx].status === 'fulfilled') {
        const data = results[idx].body;
        return getNestedValue(data, field);
      }
      return _match;
    });
  }

  async function executeOperation(op, resolvedPath, headers) {
    const method = op.method.toUpperCase();
    let chain;
    const methodMap = {
      GET: () => request.get(resolvedPath),
      POST: () => request.post(resolvedPath),
      PATCH: () => request.patch(resolvedPath),
      PUT: () => request.put(resolvedPath),
      DELETE: () => request.delete(resolvedPath),
    };
    chain = (methodMap[method] || methodMap.GET)();

    const headerKeys = Object.keys(headers);
    for (let h = 0; h < headerKeys.length; h += 1) {
      chain = chain.set(headerKeys[h], headers[headerKeys[h]]);
    }
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      chain = chain.send(op.body || {});
    }
    return chain;
  }

  return async (req, res) => {
    try {
      const ops = req.body;

      if (!ops || !Array.isArray(ops)) {
        return res.status(400).json({
          error: 'Batch request body must be an array of operations',
          code: 'INVALID_BATCH_FORMAT',
          requestId: req.requestId,
        });
      }

      if (ops.length === 0) {
        return res.status(400).json({
          error: 'Batch request must contain at least one operation',
          code: 'EMPTY_BATCH',
          requestId: req.requestId,
        });
      }

      if (ops.length > maxBatchSize) {
        return res.status(400).json({
          error: `Batch size exceeds maximum of ${maxBatchSize} operations`,
          code: 'BATCH_TOO_LARGE',
          maxBatchSize,
          receivedSize: ops.length,
          requestId: req.requestId,
        });
      }

      const validMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
      for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        if (!op || typeof op !== 'object') {
          return res.status(400).json({
            error: 'Batch operation validation failed',
            code: 'INVALID_OPERATIONS',
            details: [`Operation at index ${i}: must be an object`],
            requestId: req.requestId,
          });
        }
        if (!op.method || !validMethods.includes(op.method.toUpperCase())) {
          return res.status(400).json({
            error: 'Batch operation validation failed',
            code: 'INVALID_OPERATIONS',
            details: [`Operation at index ${i}: "method" must be GET, POST, PATCH, PUT, or DELETE`],
            requestId: req.requestId,
          });
        }
        if (!op.path || typeof op.path !== 'string' || !op.path.startsWith('/')) {
          return res.status(400).json({
            error: 'Batch operation validation failed',
            code: 'INVALID_OPERATIONS',
            details: [`Operation at index ${i}: "path" must be a string starting with /`],
            requestId: req.requestId,
          });
        }
        if (
          op.dependsOn !== undefined &&
          (typeof op.dependsOn !== 'number' || op.dependsOn < 0 || op.dependsOn >= i)
        ) {
          return res.status(400).json({
            error: 'Batch operation validation failed',
            code: 'INVALID_OPERATIONS',
            details: [
              `Operation at index ${i}: "dependsOn" must reference a valid previous operation index`,
            ],
            requestId: req.requestId,
          });
        }
      }

      const results = [];
      const batchStartTime = Date.now();
      let hasFailures = false;

      for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        const opStartTime = Date.now();

        const depFailed =
          op.dependsOn !== undefined &&
          results[op.dependsOn] &&
          results[op.dependsOn].status === 'rejected';

        if (depFailed) {
          results.push({
            status: 'skipped',
            index: i,
            method: op.method.toUpperCase(),
            path: op.path,
            statusCode: null,
            body: {
              error: `Skipped: dependency on operation ${op.dependsOn} which failed`,
              code: 'DEPENDENCY_FAILED',
              dependencyIndex: op.dependsOn,
            },
            duration: Date.now() - opStartTime,
          });
          hasFailures = true;
        } else {
          try {
            const resolvedPath = resolvePath(op.path, results);
            const headers = buildHeaders(op, req);
            const chain = await executeOperation(op, resolvedPath, headers);
            const response = await chain;
            const opDuration = Date.now() - opStartTime;
            const fulfilled = response.status >= 200 && response.status < 300;

            if (!fulfilled) hasFailures = true;

            results.push({
              status: fulfilled ? 'fulfilled' : 'rejected',
              index: i,
              method: op.method.toUpperCase(),
              path: resolvedPath,
              statusCode: response.status,
              body: response.body,
              headers: {
                'x-request-id': response.headers['x-request-id'],
                'content-type': response.headers['content-type'],
              },
              duration: opDuration,
            });
          } catch (error) {
            hasFailures = true;
            results.push({
              status: 'rejected',
              index: i,
              method: op.method.toUpperCase(),
              path: op.path,
              statusCode: error.status || 502,
              body: {
                error: error.message || 'Batch operation failed',
                code: 'BATCH_OPERATION_ERROR',
              },
              duration: Date.now() - opStartTime,
            });
          }
        }
      }

      const batchDuration = Date.now() - batchStartTime;
      const summary = {
        total: ops.length,
        fulfilled: results.filter((r) => r.status === 'fulfilled').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        duration: batchDuration,
      };

      logger?.info({ ...summary, requestId: req.requestId }, 'Batch operation completed');

      res.status(hasFailures ? 207 : 200).json({ data: results, meta: summary });
    } catch (error) {
      logger?.error({ error: error.message, requestId: req.requestId }, 'Batch handler error');
      res.status(500).json({
        error: 'Batch processing failed',
        message: error.message,
        code: 'BATCH_INTERNAL_ERROR',
        requestId: req.requestId,
      });
    }
  };
}

export { DEFAULT_MAX_BATCH_SIZE };
