// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/logger.js — re-export of the canonical backend logger.
 *
 * The logging contract (levels, request IDs, redaction) lives in
 * `backend/logger.js` so that the entry point, the services under `src/` and
 * the background workers all emit the exact same JSON shape — see
 * `docs/OBSERVABILITY.md`. This module is kept as the import path used
 * throughout `src/` so existing `import { logger } from './logger.js'`
 * statements keep working.
 *
 * Redaction is applied centrally, so callers no longer need to remember to
 * route values through a "redacting" helper: anything shaped like a
 * credential (`password`, `secret`, `token`, `apiKey`, `authorization`,
 * `cookie`, …) is replaced with `[REDACTED]` before serialisation, and the
 * literal value of ADMIN_API_KEY is masked on the way out.
 */

import {
  logger,
  scrubValue,
  runWithRequestContext,
  getRequestId,
  createRequestLogger,
  REDACTED,
} from '../../logger.js';

/**
 * Create a child logger bound to a correlation ID.
 * Correlation IDs propagate across service boundaries, whereas request IDs
 * identify a single inbound HTTP request.
 */
export function createLoggerWithCorrelation(correlationId) {
  return logger.child({ correlationId });
}

/**
 * Log with automatic sensitive-data redaction.
 * Retained for call-site compatibility: redaction is now unconditional.
 */
export function logWithRedaction(level, message, data = {}) {
  const logMethod = typeof logger[level] === 'function' ? logger[level] : logger.info;
  logMethod(scrubValue(data), message);
}

export { logger, scrubValue, runWithRequestContext, getRequestId, createRequestLogger, REDACTED };

export default logger;
