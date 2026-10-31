// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * graphql/etag.js
 *
 * Deterministic ETag caching for GraphQL responses (Issue #413).
 *
 * Repeatedly polling the identical state of a fractional vault wastes
 * database/file I/O and increases client wait times. By hashing the current
 * ledger sequence together with the requested Vault ID, the server can answer
 * with `304 Not Modified` when the data has not changed, letting browsers and
 * API clients reuse their cached copy.
 *
 * Design notes:
 *  - ETags are derived from `crypto.createHash('sha256')` over the ledger
 *    revision and the requested Vault ID, so they are deterministic and can be
 *    recomputed in O(1) without touching the underlying data store.
 *  - A cheap `If-None-Match` check short-circuits the request entirely,
 *    bypassing the resolver / data-layer query.
 *  - The ledger revision is bumped on every mutation so a changed vault yields
 *    a new ETag, while an unchanged vault keeps producing the same ETag.
 */

import { createHash } from 'crypto';
import { statSync } from 'fs';

let mutationCounter = 0;

/**
 * Return the current ledger revision.
 *
 * The revision combines the underlying data file's last-modified timestamp
 * (deterministic across process restarts) with an in-process mutation counter
 * so every write produces a strictly new revision.
 */
export function getLedgerRevision() {
  let base = '0';
  const dataFile = process.env.DATA_FILE || 'data.json';
  try {
    base = String(statSync(dataFile).mtimeMs);
  } catch {
    // Data file is absent — fall back to a fixed base revision.
  }
  return `${base}:${mutationCounter}`;
}

/**
 * Bump the ledger revision. Called after any data mutation so that caches
 * supplied with stale ETags are invalidated deterministically.
 */
export function invalidateLedger() {
  mutationCounter += 1;
  return getLedgerRevision();
}

/**
 * Compute a deterministic, quoted ETag for a given vault/asset ID.
 *
 * @param {string} vaultId The requested vault (contract) ID.
 * @returns {string} A quoted, 64-hex-char SHA-256 ETag.
 */
export function computeETag(vaultId) {
  const payload = `${getLedgerRevision()}:${vaultId || ''}`;
  const digest = createHash('sha256').update(payload).digest('hex');
  return `"${digest}"`;
}

/**
 * Normalise an `If-None-Match` header value into a list of ETags with any
 * weakness `W/` prefix and surrounding whitespace removed.
 *
 * @param {string|undefined} headerValue
 * @returns {string[]}
 */
export function parseIfNoneMatch(headerValue) {
  if (!headerValue) return [];
  return headerValue
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/**
 * Extract the targeted vault/asset ID from a GraphQL request body.
 *
 * Recognises the `asset(contractId: "C...")` query form used for single-vault
 * reads. Returns null when the request does not target a single vault so the
 * middleware can fall through to normal execution.
 *
 * @param {object} req Express request.
 * @returns {string|null}
 */
export function extractVaultId(req) {
  const body = req.body || {};
  const query = body.query || body.operations;
  if (!query || typeof query !== 'string') return null;
  const match = query.match(/asset\s*\(\s*contractId\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Build an Express middleware that implements conditional GraphQL caching.
 *
 * For single-vault read requests:
 *  1. Computes the deterministic ETag for the requested vault.
 *  2. Emits the `ETag` response header so clients can send it back.
 *  3. If the client's `If-None-Match` matches, replies `304 Not Modified`
 *     immediately — bypassing the GraphQL resolver and data-layer query.
 *
 * Mutations and non-vault queries fall through untouched.
 *
 * @param {object} [options]
 * @param {object} [options.logger]
 * @returns {import('express').RequestHandler}
 */
export function createETagMiddleware({ logger = console } = {}) {
  const measure = (name, fn) => {
    const start = process.hrtime.bigint();
    const result = fn();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (elapsedMs > 5) {
      logger?.warn?.({ name, elapsedMs }, 'ETag generation exceeded 5ms budget');
    }
    return result;
  };

  return (req, res, next) => {
    if (!req.path || /\/api\/graphql$/i.test(req.path) === false) return next();
    if (req.method !== 'POST' && req.method !== 'GET') return next();

    const vaultId = measure('extractVaultId', () => extractVaultId(req));
    if (!vaultId) return next();

    const etag = measure('computeETag', () => computeETag(vaultId));
    res.setHeader('ETag', etag);

    const inm = req.headers['if-none-match'];
    if (inm) {
      const send304 = parseIfNoneMatch(inm).some((tag) => tag === etag.replace(/^"|"$/g, ''));
      if (send304) {
        res.status(304).end();
        return undefined;
      }
    }

    return next();
  };
}
