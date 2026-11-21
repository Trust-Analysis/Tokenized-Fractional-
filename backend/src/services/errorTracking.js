// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/errorTracking.js — error tracking and alerting (issue #703).
 *
 * Sentry is the alerting half of the observability stack: the structured logs
 * written by `logger.js` answer "what happened", Sentry answers "how often,
 * to whom, and who gets paged". It is opt-in — without a `SENTRY_DSN` every
 * function in this module is a no-op, so local development and the test suite
 * never talk to a third party.
 *
 * The module deliberately uses only long-lived, stable Sentry exports
 * (`init`, `withIsolationScope`, `captureException`, `flush`). The
 * `Sentry.Handlers.*` helpers were removed in @sentry/node v10, so request and
 * error wiring is done with our own middleware, which also lets us attach the
 * `X-Request-ID` of the failing request to every event.
 *
 * Configure with:
 *   SENTRY_DSN                    ingest DSN (enables tracking)
 *   SENTRY_ENVIRONMENT            overrides NODE_ENV
 *   SENTRY_RELEASE                release identifier, e.g. the git SHA
 *   SENTRY_TRACES_SAMPLE_RATE     performance monitoring sample rate (0..1)
 *   SENTRY_PROFILES_SAMPLE_RATE   profiling sample rate (0..1)
 */

import * as Sentry from '@sentry/node';
import { logger, getRequestContext, getRequestId, scrubSecrets, REDACTED } from '../../logger.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_TEST = NODE_ENV === 'test';

/**
 * Event paths dropped wholesale because they contain request payloads or
 * credentials. Paths are matched in full, so `request.headers` is *not* here:
 * individual header values are redacted by name instead, which keeps the
 * non-sensitive part of a request debuggable.
 */
const SENSITIVE_EVENT_PATHS = [
  'request.data',
  'request.body',
  'request.cookies',
  'user',
  'extra.body',
  'extra.password',
  'extra.secret',
  'extra.token',
  'extra.apiKey',
  'extra.api_key',
];

/**
 * Field names whose value is always credential material, matched at any depth.
 * Deliberately does not match the container name `headers`: only the individual
 * header values are sensitive.
 */
const SENSITIVE_EVENT_KEYS = /cookie|credential|passw|secret|token|api[_-]?key|authorization/i;

const state = {
  enabled: false,
  dsn: null,
  environment: NODE_ENV,
  release: null,
};

/** True when a Sentry DSN is configured and the current environment is not test. */
export function isErrorTrackingEnabled() {
  return state.enabled;
}

/** Current Sentry configuration summary (safe to log — no DSN, no secrets). */
export function errorTrackingStatus() {
  return {
    enabled: state.enabled,
    environment: state.environment,
    release: state.release,
  };
}

function sampleRate(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

/**
 * Remove credential material from a Sentry event. The event is a plain JSON
 * structure, so the same key-based rules as the logger apply.
 */
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  const scrub = (value, path, depth) => {
    if (depth > 8) return value;
    if (SENSITIVE_EVENT_PATHS.includes(path.join('.'))) return REDACTED;
    if (typeof value === 'string') return scrubSecrets(value);
    if (Array.isArray(value)) {
      return value.map((item, index) => scrub(item, [...path, index], depth + 1));
    }
    if (value === null || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const nextPath = [...path, key];
        if (SENSITIVE_EVENT_PATHS.includes(nextPath.join('.'))) return [key, REDACTED];
        if (SENSITIVE_EVENT_KEYS.test(key)) return [key, REDACTED];
        return [key, scrub(item, nextPath, depth + 1)];
      }),
    );
  };

  return scrub(event, [], 0);
}

/** Hostname of the Sentry ingest DSN — enough to verify wiring, no secret. */
function dsnHost(dsn) {
  try {
    return new URL(dsn).host;
  } catch {
    return null;
  }
}

/**
 * Initialise Sentry. Safe to call more than once and safe to call when no DSN
 * is configured, in which case tracking stays disabled and only structured
 * logging is used.
 *
 * @returns {boolean} whether error tracking is now enabled
 */
export function initErrorTracking(options = {}) {
  const dsn = options.dsn || process.env.SENTRY_DSN || null;

  if (!dsn || IS_TEST || state.enabled) return state.enabled;

  const environment = options.environment || process.env.SENTRY_ENVIRONMENT || NODE_ENV;
  const release = options.release || process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || null;

  Sentry.init({
    dsn,
    environment,
    ...(release ? { release } : {}),
    tracesSampleRate: options.tracesSampleRate ?? sampleRate('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    profilesSampleRate:
      options.profilesSampleRate ?? sampleRate('SENTRY_PROFILES_SAMPLE_RATE', 0.1),
    integrations: [Sentry.httpIntegration({ breadcrumbs: true }), Sentry.expressIntegration()],
    sendDefaultPii: false,
    // Never let credentials or request bodies reach Sentry, and drop 404s
    // which are noise for alerting purposes.
    beforeSend(event) {
      if (event?.request?.url && /\/health$/.test(event.request.url)) return null;
      return scrubEvent(event);
    },
  });

  state.enabled = true;
  state.dsn = dsn;
  state.environment = environment;
  state.release = release;

  Sentry.setContext('deployment', {
    service: process.env.SERVICE_NAME || 'backend',
    deploymentColor: process.env.DEPLOYMENT_COLOR || 'local',
    buildId: process.env.BUILD_ID || process.env.GITHUB_SHA || 'local',
  });

  logger.info(
    { errorTracking: errorTrackingStatus(), dsnHost: dsnHost(dsn) },
    'Sentry error tracking enabled',
  );

  return true;
}

/**
 * Express middleware that opens a Sentry isolation scope per request so events
 * raised while handling it are attributed to that request, and are annotated
 * with the request ID used by the structured logs.
 *
 * Register this before any route. A no-op when tracking is disabled.
 */
export function installErrorTrackingRequestScope(app) {
  if (!state.enabled) return false;

  app.use((req, _res, next) => {
    const requestId = req.requestId || req.headers['x-request-id'] || getRequestId();
    Sentry.withIsolationScope((scope) => {
      if (requestId) scope.setTag('requestId', String(requestId));
      scope.setTag('http.method', req.method);
      scope.setTag('service', process.env.SERVICE_NAME || 'backend');
      scope.setContext('http', {
        method: req.method,
        path: req.path,
        url: req.originalUrl,
        userAgent: req.get?.('user-agent') || null,
        ip: req.ip || null,
      });
      next();
    });
  });

  return true;
}

/**
 * Report an error to Sentry. Returns the event id, or `null` when tracking is
 * disabled, so the caller can fall back to log-only reporting.
 *
 * @param {Error|unknown} error
 * @param {object} [context] extra structured context (already scrubbed on send)
 */
export function captureException(error, context = {}) {
  if (!state.enabled) return null;

  const requestId = context.requestId || getRequestId();
  const { requestId: _ignored, ...extra } = context;

  return Sentry.withScope((scope) => {
    if (requestId) scope.setTag('requestId', String(requestId));
    Object.entries(extra).forEach(([key, value]) => scope.setExtra(key, value));
    return Sentry.captureException(error, {
      tags: { service: process.env.SERVICE_NAME || 'backend' },
    });
  });
}

/** Record a non-error event trail entry (webhook delivery, rate-limit trips). */
export function addErrorBreadcrumb(breadcrumb) {
  if (!state.enabled || !breadcrumb) return false;
  Sentry.addBreadcrumb({ ...breadcrumb, timestamp: Date.now() / 1000 });
  return true;
}

/**
 * Log an error through the structured logger and report it to Sentry.
 * This is the single call sites should use for unexpected failures so that the
 * log line and the alert always carry the same request ID.
 */
export function reportError(error, { message, level = 'error', ...context } = {}) {
  const requestId = getRequestId();
  const logMethod = typeof logger[level] === 'function' ? logger[level] : logger.error;
  logMethod({ err: error, requestId, ...context }, message || 'Unhandled error');
  captureException(error, { ...context, requestId });
  return error;
}

/** Flush pending events, e.g. from a graceful-shutdown hook. */
export async function flushErrorTracking(timeout = 2000) {
  if (!state.enabled) return false;
  try {
    await Sentry.flush(timeout);
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to flush Sentry events');
    return false;
  }
}

/** Current request context, re-exported for call sites that already import both. */
export function currentRequestId() {
  return getRequestId() || getRequestContext().correlationId || null;
}
