// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Persisted-query enforcement middleware (Issue #885).
 *
 * The persisted-query system (registration / lookup / execution under
 * `graphql/`) is an *additional* access path by default: the GraphQL
 * endpoints keep serving arbitrary ad-hoc documents even when persisted
 * queries are registered. This middleware is the switch that turns the
 * platform into persisted-query-only mode: when enabled, any GraphQL
 * request that does not reference a registered persisted query is
 * rejected with HTTP 403 (`PERSISTED_QUERY_NOT_REGISTERED`) before it
 * reaches the GraphQL server.
 *
 * Configuration (read at request time so it can be toggled per environment):
 *   PERSISTED_QUERY_ENFORCEMENT=true   enable enforcement (default: disabled)
 *   PERSISTED_QUERIES_FILE=/path.json  allowlist file of registered queries
 *
 * The allowlist file is a JSON array, or an object with a `queries` array,
 * whose entries are either raw query strings or objects:
 *   { "hash": "<sha256hex>" }
 *   { "operationName": "GetAssetsCount", "queryString": "query GetAssetsCount { assetsCount }" }
 *
 * Enforcement fails closed: if it is enabled but no allowlist file is
 * configured (or the file cannot be read), every query-carrying request is
 * rejected.
 */

import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { logger as defaultLogger } from '../services/logger.js';

export const PERSISTED_QUERY_ENFORCEMENT_CODE = 'PERSISTED_QUERY_NOT_REGISTERED';

/**
 * Normalize a GraphQL document the same way query registration does so the
 * computed hash matches. Must stay in sync with
 * `QueryRegistrationManager.calculateHash` in
 * `graphql/registration/queryRegistration.js`.
 */
export function normalizeQuery(queryString) {
  return queryString.replace(/\s+/g, ' ').trim();
}

/** SHA-256 hash of the normalized query string. */
export function hashQuery(queryString) {
  return crypto.createHash('sha256').update(normalizeQuery(queryString)).digest('hex');
}

/** Whether enforcement is active (explicit option wins over env var). */
export function isPersistedQueryEnforcementEnabled(options = {}) {
  if (typeof options.enabled === 'boolean') return options.enabled;
  return process.env.PERSISTED_QUERY_ENFORCEMENT === 'true';
}

/**
 * Build an in-memory registry of allowed query hashes.
 * @param {Array<string|{hash?: string, queryString?: string, query?: string}>} entries
 */
export function createPersistedQueryRegistry(entries = []) {
  const hashes = new Set();
  for (const entry of entries) {
    if (typeof entry === 'string') {
      hashes.add(hashQuery(entry));
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.hash === 'string' && entry.hash.length > 0) {
      hashes.add(entry.hash.toLowerCase());
    }
    const queryString = entry.queryString ?? entry.query;
    if (typeof queryString === 'string' && queryString.length > 0) {
      hashes.add(hashQuery(queryString));
    }
  }
  return {
    size: hashes.size,
    isRegistered(hash) {
      return typeof hash === 'string' && hashes.has(hash.toLowerCase());
    },
  };
}

/** Load a registry from a JSON allowlist file (see module doc for format). */
export function loadPersistedQueryRegistryFile(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (Array.isArray(raw.queries) ? raw.queries : []);
  return createPersistedQueryRegistry(entries);
}

function rejectRequest(res, message) {
  return res.status(403).json({
    errors: [
      {
        message,
        extensions: { code: PERSISTED_QUERY_ENFORCEMENT_CODE },
      },
    ],
  });
}

/**
 * Create the enforcement Express middleware.
 * @param {object} [options]
 * @param {boolean} [options.enabled] Force-enable/disable (default: env var).
 * @param {object}  [options.registry] Pre-built registry (skips file loading).
 * @param {string} [options.registryFile] Allowlist file path (default: PERSISTED_QUERIES_FILE).
 * @param {object} [options.logger] Logger override.
 */
export function createPersistedQueryEnforcementMiddleware(options = {}) {
  const log = options.logger ?? defaultLogger;
  let cachedRegistry = null;
  let cachedFile = null;
  let warned = false;

  const resolveRegistry = () => {
    if (options.registry) return options.registry;

    const file = options.registryFile ?? process.env.PERSISTED_QUERIES_FILE ?? null;
    if (!file) {
      if (!warned) {
        log.warn(
          'Persisted-query enforcement is enabled but PERSISTED_QUERIES_FILE is not set; all GraphQL requests will be rejected (fail closed)',
        );
        warned = true;
      }
      return createPersistedQueryRegistry([]);
    }

    if (cachedRegistry && cachedFile === file) return cachedRegistry;

    if (!existsSync(file)) {
      if (!warned) {
        log.error(
          { file },
          'Persisted-query allowlist file not found; all GraphQL requests will be rejected (fail closed)',
        );
        warned = true;
      }
      cachedRegistry = createPersistedQueryRegistry([]);
      cachedFile = file;
      return cachedRegistry;
    }

    cachedRegistry = loadPersistedQueryRegistryFile(file);
    cachedFile = file;
    log.info(
      { file, registeredQueries: cachedRegistry.size },
      'Persisted-query enforcement allowlist loaded',
    );
    return cachedRegistry;
  };

  return function persistedQueryEnforcement(req, res, next) {
    if (!isPersistedQueryEnforcementEnabled(options)) return next();

    // Only JSON GraphQL operation bodies can carry an ad-hoc document.
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return next();

    const registry = resolveRegistry();

    // Automatic-persisted-query protocol: the hash must be registered.
    const apqHash = body.extensions?.persistedQuery?.sha256Hash;
    if (typeof apqHash === 'string' && apqHash.length > 0) {
      if (!registry.isRegistered(apqHash)) {
        log.warn({ apqHash }, 'Rejected unregistered persisted-query hash');
        return rejectRequest(
          res,
          `Persisted-query enforcement: hash "${apqHash}" is not a registered persisted query`,
        );
      }
      // Execute only the registered document, never an inline variant.
      delete body.query;
      return next();
    }

    // Inline document: its normalized hash must match a registered query.
    if (typeof body.query === 'string' && body.query.trim().length > 0) {
      const hash = hashQuery(body.query);
      if (!registry.isRegistered(hash)) {
        log.warn({ hash }, 'Rejected arbitrary (unregistered) GraphQL query');
        return rejectRequest(
          res,
          'Persisted-query enforcement: arbitrary ad-hoc queries are disabled. '
            + 'Register the query and send its hash via extensions.persistedQuery.sha256Hash, '
            + 'or send the exact registered document.',
        );
      }
      return next();
    }

    // No query and no hash: nothing to execute here; the GraphQL server
    // produces its own standard "query missing" error downstream.
    return next();
  };
}

export default createPersistedQueryEnforcementMiddleware;
