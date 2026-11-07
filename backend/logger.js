// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * logger.js — the single structured logger for the backend (issue #703).
 *
 * Every process writes newline-delimited JSON to stdout. `elk/filebeat` tails the
 * container log, Logstash maps the fields to ECS, and Elasticsearch stores them
 * under `rwa-logs-*`. Nothing here formats strings for humans: `LOG_LEVEL` selects
 * one of the levels in `LOG_LEVELS` and every record carries the same fields
 * (`level`, `time`, `msg`, `service`, `environment`, `requestId` when in a
 * request, plus whatever the call site attaches).
 *
 * Request correlation is ambient: `runWithRequestContext({ requestId }, fn)` binds
 * the identifier to an AsyncLocalStorage, so every log written anywhere inside
 * `fn` — including inside services, cache helpers and detached promises — is
 * tagged without threading `req` through the call stack.
 *
 * Secrets never reach the output. Redaction happens in three independent layers,
 * so a mistake in one of them is not enough to leak a credential:
 *   1. pino `redact` paths cover serialised Express requests/responses/errors,
 *   2. `scrubValue` rewrites credential-shaped keys at any nesting depth,
 *   3. `createScrubbingStream` masks the literal value of every secret in the
 *      environment, which catches secrets interpolated into free text.
 *
 * Usage:
 *   import { logger, runWithRequestContext } from './logger.js';
 *
 *   app.use((req, res, next) => {
 *     runWithRequestContext({ requestId: req.requestId }, next);
 *   });
 *
 *   runWithRequestContext({ requestId: 'req_abc123' }, () => {
 *     logger.info({ contractId }, 'asset created');   // includes requestId
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import os from 'os';
import { Writable } from 'stream';
import pino from 'pino';

/** Placeholder written instead of any redacted value. */
export const REDACTED = '[REDACTED]';

/** Log levels accepted by LOG_LEVEL, ordered from most to least verbose. */
export const LOG_LEVELS = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_TEST = NODE_ENV === 'test';

/** Deepest object nesting that is scrubbed before serialisation. */
const MAX_SCRUB_DEPTH = 8;

/** Shortest environment value still treated as a secret. */
const MIN_SECRET_LENGTH = 8;

/**
 * Log-record keys that must never be emitted verbatim. Matched
 * case-insensitively against the key name, so `apiKey`, `api_key` and
 * `x-api-key` are all covered.
 */
const SENSITIVE_KEY_PATTERNS = [
  /passw(or)?d/i,
  /secret/i,
  /token/i,
  /credential/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /mnemonic/i,
  /seed[_-]?phrase/i,
  /\bcvv\b/i,
  /(?:^|[-_.])dsn(?:$|[-_.])/i,
  /(?:^|[-_.])pin(?:$|[-_.])/i,
];

/**
 * pino `redact` paths, applied after serialisation. They cover the objects pino
 * builds itself (Express requests/responses and errors), which are class
 * instances and therefore skipped by the deep scrub.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["x-api-key"]',
  'req.headers["X-Api-Key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'err.config.headers',
  'err.config.headers.authorization',
  'error.config.headers',
  'req.body.password',
  'req.body.token',
  'req.body.apiKey',
  'body.password',
  'password',
  'apiKey',
  'api_key',
  'token',
  'secret',
  'authorization',
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.privateKey',
  '*.private_key',
];

/** Environment variables that are always scrubbed, listed for documentation. */
const DOCUMENTED_SECRET_KEYS = Object.freeze([
  'ADMIN_API_KEY',
  'API_KEY',
  'DATABASE_URL',
  'DB_PASSWORD',
  'JWT_SECRET',
  'SENTRY_DSN',
  'SOLANA_RPC_URL',
  'WALLET_PRIVATE_KEY',
  'WEBHOOK_SECRET',
]);

/** Additional environment variables treated as secret when their name looks like one. */
const SECRET_NAME_PATTERN =
  /passw|secret|token|api[_-]?key|private[_-]?key|mnemonic|seed|credential|dsn|encryption/i;

/** `scheme://user:password@host` — the password is masked wherever it appears. */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi;

let cachedSecretPattern = null;
let cachedSecretKey = null;

/** Names of every environment variable whose value must never be logged. */
export function secretEnvKeys() {
  return Array.from(
    new Set([
      ...DOCUMENTED_SECRET_KEYS,
      ...Object.keys(process.env).filter((name) => SECRET_NAME_PATTERN.test(name)),
    ]),
  );
}

/** Current values of the secret environment variables, longest first. */
function collectSecretValues() {
  return secretEnvKeys()
    .map((name) => process.env[name])
    .filter((value) => typeof value === 'string' && value.trim().length >= MIN_SECRET_LENGTH)
    .map((value) => value.trim());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lazily build (and cache) one alternation regex over every known secret value. */
function secretPattern() {
  const values = collectSecretValues();
  const key = values.join(' ');
  if (key !== cachedSecretKey || !cachedSecretPattern) {
    cachedSecretKey = key;
    cachedSecretPattern = values.length
      ? new RegExp(values.map(escapeRegExp).join('|'), 'g')
      : null;
  }
  return cachedSecretPattern;
}

/** True when a key name looks like it holds credential material. */
export function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Mask secret values (and URL credentials) inside an arbitrary string. This is
 * applied to every log message and to every string that reaches the output
 * stream, so a secret can never escape even when it is interpolated into free
 * text by mistake.
 */
export function scrubSecrets(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const pattern = secretPattern();
  const masked = pattern ? text.replace(pattern, REDACTED) : text;
  return masked.replace(URL_CREDENTIALS, `$1:${REDACTED}@`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively copy a log payload, redacting credential-shaped keys and
 * scrubbing secret values out of strings. Non-plain objects (Express requests,
 * Errors, Buffers, streams, Dates) are passed through untouched so that
 * pino's own serializers keep working.
 */
export function scrubValue(value, depth = 0) {
  if (depth >= MAX_SCRUB_DEPTH) return value;

  if (typeof value === 'string') return scrubSecrets(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : scrubValue(item, depth + 1),
      ]),
    );
  }

  return value;
}

// ── Request context ───────────────────────────────────────────────────────────

/**
 * Async context holding the current request identifiers. Every logger call made
 * anywhere inside `runWithRequestContext` — including inside services, cache
 * helpers and fire-and-forget promises — is tagged with these values.
 */
const requestContextStorage = new AsyncLocalStorage();

/** Run `fn` with `context` bound as the ambient request context. */
export function runWithRequestContext(context, fn) {
  return requestContextStorage.run({ ...requestContextStorage.getStore(), ...context }, fn);
}

/** Current request context, or an empty object outside of a request. */
export function getRequestContext() {
  return requestContextStorage.getStore() || {};
}

/** Current request ID, or `null` outside of a request. */
export function getRequestId() {
  return requestContextStorage.getStore()?.requestId || null;
}

// ── Logger factory ────────────────────────────────────────────────────────────

/** Resolve the effective log level, falling back when LOG_LEVEL is invalid. */
export function resolveLogLevel(level = process.env.LOG_LEVEL) {
  const configured = typeof level === 'string' ? level.trim().toLowerCase() : '';
  if (LOG_LEVELS.includes(configured)) return configured;
  return IS_TEST ? 'silent' : 'info';
}

/** pino-pretty is an optional developer dependency: use it only when installed. */
function canUsePrettyPrinter() {
  if (process.env.LOG_PRETTY === 'false') return false;
  if (NODE_ENV !== 'development') return false;
  try {
    if (typeof import.meta.resolve !== 'function') return false;
    import.meta.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap a writable stream so that no line leaves the process with a secret in
 * it. This is the final safety net for values that were interpolated into
 * messages (for example `logger.info('key ' + process.env.ADMIN_API_KEY)`) and
 * therefore never went through key-based redaction.
 */
export function createScrubbingStream(target) {
  return new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString('utf8');
      let output = null;
      try {
        output = scrubSecrets(text);
      } catch {
        // Never forward a line we could not verify.
      }
      if (output !== null) {
        try {
          target.write(output);
        } catch {
          // Logging must never take the process down.
        }
      }
      callback();
    },
  });
}

/**
 * Create a pino logger with the project's standard configuration.
 *
 * @param {object}  [options]        pino option overrides
 * @param {string}  [options.level]  explicit level, else LOG_LEVEL
 * @param {object}  [options.base]   extra fields merged into every record
 * @param {Writable}[options.stream] destination, else stdout
 * @param {boolean} [options.pretty] force-enable the pino-pretty transport
 */
export function createLogger(options = {}) {
  const level = resolveLogLevel(options.level);
  const base = {
    service: process.env.SERVICE_NAME || 'backend',
    environment: NODE_ENV,
    pid: process.pid,
    hostname: os.hostname(),
    deploymentColor: process.env.DEPLOYMENT_COLOR || 'local',
    buildId: process.env.BUILD_ID || process.env.GITHUB_SHA || 'local',
    ...(options.base || {}),
  };

  const pinoOptions = {
    level,
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
    redact: { paths: REDACT_PATHS, censor: REDACTED, remove: false },
    mixin() {
      const context = requestContextStorage.getStore();
      if (!context) return {};
      const { requestId, correlationId } = context;
      const bindings = {};
      if (requestId) bindings.requestId = requestId;
      if (correlationId) bindings.correlationId = correlationId;
      return bindings;
    },
    hooks: {
      logMethod(inputArgs, method) {
        // pino's hook contract is to transform the argument list and then
        // delegate to the original method.
        const args = inputArgs.map((arg) => scrubValue(arg));
        return method.apply(this, args);
      },
    },
    ...((options.pretty ?? canUsePrettyPrinter()) && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' },
      },
    }),
  };

  return options.stream ? pino(pinoOptions, options.stream) : pino(pinoOptions);
}

/**
 * Shared logger instance. Writes newline-delimited JSON to stdout, which
 * `elk/filebeat` tails from the container log and forwards to Logstash.
 */
export const logger = createLogger({ stream: createScrubbingStream(process.stdout) });

/**
 * Create a child logger bound to a request. Prefer the ambient context
 * (`runWithRequestContext`); use this when a log is emitted for a different
 * request than the one currently in scope.
 *
 * @param {string} requestId
 * @param {object} [bindings] extra fields added to every record
 * @param {object} [base]     logger to derive from, defaults to the shared one
 */
export function createRequestLogger(requestId, bindings = {}, base = logger) {
  return base.child({ requestId, ...bindings });
}

/**
 * Log an error and return it, so callers can `throw logError(err, 'context')`.
 * Error tracking is reported by `src/services/errorTracking.js`, which imports
 * this module; importing it here instead would create a cycle.
 */
export function logError(err, message, bindings = {}) {
  logger.error({ err, ...bindings }, message);
  return err;
}
