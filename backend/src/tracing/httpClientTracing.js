// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * HTTP Client Tracing
 * 
 * Wraps HTTP calls (including Soroban RPC) with OpenTelemetry spans
 * Captures request/response details, headers, and errors
 */

import { trace, context } from '@opentelemetry/api';

const tracer = trace.getTracer('http-client-tracing');

/**
 * Trace a fetch/HTTP request
 * 
 * Usage:
 *   const response = await traceHttpRequest('soroban.getRpcVersion', async () => {
 *     return fetch(url, options);
 *   });
 */
export async function traceHttpRequest(operationName, requestFn, options = {}) {
  const span = tracer.startSpan(`http.client.${operationName}`, {
    attributes: {
      'http.request.name': operationName,
      'http.request.timeout_ms': options.timeout || 30000,
    },
  });

  const startTime = Date.now();

  try {
    const response = await context.with(
      trace.setSpan(context.active(), span),
      () => requestFn()
    );

    const duration = Date.now() - startTime;

    // Add response details
    span.setAttributes({
      'http.response.status_code': response.status,
      'http.response.headers_count': response.headers?.size || 0,
      'http.duration_ms': duration,
    });

    // Mark errors
    if (response.status >= 400) {
      span.setStatus({ code: 2 }); // ERROR
      span.addEvent('http_error', {
        'status_code': response.status,
        'duration_ms': duration,
      });
    } else {
      span.addEvent('http_success', {
        'status_code': response.status,
        'duration_ms': duration,
      });
    }

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    span.recordException(error);
    span.setStatus({ code: 2 }); // ERROR
    span.setAttribute('http.duration_ms', duration);
    span.setAttribute('error.message', error.message);
    span.setAttribute('error.type', error.constructor.name);

    span.addEvent('http_error', {
      'error': error.message,
      'duration_ms': duration,
    });

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace a Soroban RPC call
 * 
 * Specific for blockchain RPC calls with method name and parameters
 */
export async function traceSorobanRpc(method, params, rpcClient) {
  const spanName = `soroban.${method}`;

  const span = tracer.startSpan(spanName, {
    attributes: {
      'rpc.service': 'soroban',
      'rpc.method': method,
      'rpc.param_count': Array.isArray(params) ? params.length : Object.keys(params || {}).length,
      'blockchain.network': process.env.SOROBAN_NETWORK || 'testnet',
    },
  });

  const startTime = Date.now();

  try {
    let result;

    if (typeof rpcClient === 'function') {
      result = await context.with(
        trace.setSpan(context.active(), span),
        () => rpcClient(method, params)
      );
    } else {
      result = await context.with(
        trace.setSpan(context.active(), span),
        () => rpcClient[method](params)
      );
    }

    const duration = Date.now() - startTime;

    span.setAttributes({
      'rpc.duration_ms': duration,
      'rpc.result_type': typeof result,
      'rpc.success': true,
    });

    span.addEvent('rpc_success', {
      'method': method,
      'duration_ms': duration,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    span.recordException(error);
    span.setStatus({ code: 2 }); // ERROR
    span.setAttributes({
      'rpc.duration_ms': duration,
      'rpc.error': error.message,
      'rpc.error_code': error.code,
    });

    span.addEvent('rpc_error', {
      'method': method,
      'error': error.message,
      'duration_ms': duration,
    });

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace webhook delivery
 */
export async function traceWebhookDelivery(webhookUrl, payload, deliveryFn) {
  const span = tracer.startSpan('webhook.delivery', {
    attributes: {
      'webhook.url': maskUrl(webhookUrl),
      'webhook.payload_size': JSON.stringify(payload).length,
    },
  });

  const startTime = Date.now();
  const attempts = [];

  try {
    // Track attempts
    const retryableDeliveryFn = async () => {
      let lastError;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const attemptSpan = tracer.startSpan('webhook.attempt', {
            attributes: {
              'webhook.attempt': attempt,
              'webhook.url': maskUrl(webhookUrl),
            },
          });

          const attemptStart = Date.now();

          try {
            const result = await context.with(
              trace.setSpan(context.active(), attemptSpan),
              () => deliveryFn()
            );

            attemptSpan.setAttribute('webhook.attempt_duration_ms', Date.now() - attemptStart);
            attemptSpan.end();

            attempts.push({
              attempt,
              success: true,
              duration: Date.now() - attemptStart,
            });

            return result;
          } catch (error) {
            lastError = error;
            attemptSpan.recordException(error);
            attemptSpan.setAttribute('webhook.attempt_duration_ms', Date.now() - attemptStart);
            attemptSpan.end();

            attempts.push({
              attempt,
              success: false,
              duration: Date.now() - attemptStart,
              error: error.message,
            });

            if (attempt < 3) {
              // Exponential backoff: 1s, 2s, 4s
              await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
            }
          }
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError;
    };

    const result = await retryableDeliveryFn();
    const duration = Date.now() - startTime;

    span.setAttributes({
      'webhook.duration_ms': duration,
      'webhook.delivery_success': true,
      'webhook.attempts': attempts.length,
    });

    span.addEvent('webhook_delivered', {
      'duration_ms': duration,
      'attempts': attempts.length,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    span.recordException(error);
    span.setStatus({ code: 2 }); // ERROR
    span.setAttributes({
      'webhook.duration_ms': duration,
      'webhook.delivery_error': error.message,
      'webhook.attempts': attempts.length,
    });

    span.addEvent('webhook_failed', {
      'error': error.message,
      'duration_ms': duration,
      'attempts': attempts.length,
    });

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace external API calls
 */
export async function traceExternalApi(serviceName, endpoint, requestFn) {
  const span = tracer.startSpan(`external_api.${serviceName}`, {
    attributes: {
      'external_api.service': serviceName,
      'external_api.endpoint': maskUrl(endpoint),
    },
  });

  const startTime = Date.now();

  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      () => requestFn()
    );

    span.setAttribute('external_api.duration_ms', Date.now() - startTime);
    span.setAttribute('external_api.success', true);

    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2 });
    span.setAttribute('external_api.duration_ms', Date.now() - startTime);
    span.setAttribute('external_api.error', error.message);

    throw error;
  } finally {
    span.end();
  }
}

/**
 * Mask URL for privacy (remove credentials/sensitive params)
 */
function maskUrl(url) {
  if (!url) return 'unknown';

  try {
    const urlObj = new URL(url);

    // Remove sensitive query params
    const sensitiveParams = ['token', 'key', 'secret', 'password', 'api_key'];
    sensitiveParams.forEach(param => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***');
      }
    });

    // Remove credentials from URL
    if (urlObj.username) {
      urlObj.username = '***';
    }
    if (urlObj.password) {
      urlObj.password = '***';
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return a shortened version
    return url.substring(0, 50) + '...';
  }
}

/**
 * Batch HTTP requests with tracing
 */
export async function traceBatchHttpRequests(operationName, requests) {
  const span = tracer.startSpan(`http.batch.${operationName}`, {
    attributes: {
      'http.batch_size': requests.length,
    },
  });

  const startTime = Date.now();
  const results = [];
  const errors = [];

  try {
    const promises = requests.map(async (req, idx) => {
      const reqSpan = tracer.startSpan(`http.batch_request.${idx}`, {
        attributes: {
          'http.batch_index': idx,
          'http.request.name': req.name,
        },
      });

      try {
        const result = await context.with(
          trace.setSpan(context.active(), reqSpan),
          () => req.fn()
        );

        results.push({ index: idx, result, success: true });
        reqSpan.end();

        return result;
      } catch (error) {
        reqSpan.recordException(error);
        reqSpan.setStatus({ code: 2 });
        reqSpan.end();

        errors.push({ index: idx, error: error.message });
        return null;
      }
    });

    await Promise.all(promises);

    const duration = Date.now() - startTime;

    span.setAttributes({
      'http.batch_duration_ms': duration,
      'http.batch_success_count': results.length,
      'http.batch_error_count': errors.length,
    });

    if (errors.length > 0) {
      span.setStatus({ code: 2 }); // ERROR
      span.addEvent('batch_http_partial_error', {
        'success': results.length,
        'failed': errors.length,
      });
    }

    return { results, errors };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2 });
    span.setAttribute('http.batch_duration_ms', Date.now() - startTime);

    throw error;
  } finally {
    span.end();
  }
}
