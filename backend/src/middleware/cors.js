// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/cors.js — single source of truth for CORS (issue: audit).
 *
 * Both backend entrypoints (`backend/index.js` and `backend/src/app.js`) must
 * mount `corsMiddleware` so a browser call that passes preflight against one
 * entrypoint cannot fail against the other. Allowed headers cover everything
 * the frontend and the SDK actually send:
 *
 *   - Content-Type / Accept        — every JSON request (SDK `rest.ts`, fetch calls)
 *   - Authorization                — Bearer JWT from `frontend/src/apollo/client.js`
 *   - X-API-Key                    — admin/SDK auth (`x-api-key`)
 *   - X-Request-ID                 — request correlation (`apollo/client.js`,
 *                                    `middleware/requestId.js`, `correlationId.js`)
 *   - X-Tenant-ID                  — multi-tenant routing (`middleware/tenantContext.js`)
 *
 * Production safety: `validateEnv()` (env.js) refuses to boot when
 * NODE_ENV=production and CORS_ORIGINS is empty or contains '*'.
 */

import cors from 'cors';

/** Origins allowed when CORS_ORIGINS is unset (local Vite dev/preview servers). */
export const DEFAULT_CORS_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://localhost:4173',
]);

/** HTTP methods the API surface uses. OPTIONS is handled by the cors package. */
export const CORS_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

/** Request headers the frontend and SDK send that require preflight approval. */
export const CORS_ALLOWED_HEADERS = Object.freeze([
  'Content-Type',
  'Accept',
  'Authorization',
  'X-API-Key',
  'X-Request-ID',
  'X-Tenant-ID',
]);

/** Parse a comma-separated CORS_ORIGINS value into a trimmed origin list. */
export function parseCorsOrigins(raw) {
  if (!raw || String(raw).trim() === '') return [...DEFAULT_CORS_ORIGINS];
  const origins = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS];
}

/** Parsed allowed origins for the current process environment. */
export const CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS);

/**
 * cors options shared by every entrypoint. `credentials` stays off: clients
 * authenticate with the Authorization / X-API-Key headers, not cookies.
 */
export const CORS_OPTIONS = Object.freeze({
  origin: CORS_ORIGINS,
  methods: [...CORS_METHODS],
  allowedHeaders: [...CORS_ALLOWED_HEADERS],
});

/**
 * Express middleware implementing the shared CORS policy. Throws at startup
 * in production when the origin list is empty or contains '*' — a wildcard or
 * missing allowlist must never reach a production deploy.
 */
export function createCorsMiddleware(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction) {
    const raw = String(env.CORS_ORIGINS || '').trim();
    const origins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (origins.length === 0 || origins.includes('*')) {
      throw new Error(
        'CORS_ORIGINS must be a non-empty comma-separated list of explicit origins in production ("*" is not allowed)',
      );
    }
  }
  return cors(CORS_OPTIONS);
}
