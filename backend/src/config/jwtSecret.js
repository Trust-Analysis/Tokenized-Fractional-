// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/config/jwtSecret.js — single source of truth for JWT signing secrets.
 *
 * Issue #1144: never fall back to a value committed to the repository. A
 * deployment without JWT_SECRET must fail loudly at boot instead of silently
 * accepting tokens signed with a publicly known string.
 *
 * Rotation: sign with JWT_SECRET, and optionally keep the retiring key in
 * JWT_SECRET_PREVIOUS so tokens issued before the swap stay valid until they
 * expire. Verification tries the current key first, then the previous one.
 */

import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

/** HS256 keys shorter than the SHA-256 block size weaken the signature. */
export const MIN_JWT_SECRET_BYTES = 32;

/**
 * Process-local key used only when NODE_ENV=test and no secret is supplied.
 * It is random per process, so it cannot forge tokens outside this process,
 * and it is never a value that could be committed or reused in production.
 */
let testOnlySecret = null;

function isTestEnv(env) {
  return env.NODE_ENV === 'test';
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function readTrimmed(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function assertStrongSecret(value, name, env) {
  // Tests inject short, intentional secrets; production and every other
  // environment must meet the strength bar.
  if (isTestEnv(env)) return value;

  if (byteLength(value) < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `${name} must be at least ${MIN_JWT_SECRET_BYTES} bytes (received ${byteLength(value)}). ` +
        'Generate one with: openssl rand -hex 32',
    );
  }

  return value;
}

/**
 * Resolve the JWT signing secret for an environment.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 * @throws when the secret is missing or too short outside NODE_ENV=test
 */
export function resolveJwtSecret(env = process.env) {
  const configured = readTrimmed(env, 'JWT_SECRET');

  if (configured) {
    return assertStrongSecret(configured, 'JWT_SECRET', env);
  }

  if (isTestEnv(env)) {
    testOnlySecret ??= randomBytes(48).toString('hex');
    return testOnlySecret;
  }

  throw new Error(
    'JWT_SECRET is required and was not set. Refusing to start with an insecure, ' +
      'publicly known signing key. Generate one with: openssl rand -hex 32',
  );
}

/**
 * Secrets used for verification, newest first. The previous key is optional
 * and only exists during a rotation grace window.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string[]}
 */
export function resolveJwtVerificationSecrets(env = process.env) {
  const secrets = [resolveJwtSecret(env)];
  const previous = readTrimmed(env, 'JWT_SECRET_PREVIOUS');

  if (previous) {
    assertStrongSecret(previous, 'JWT_SECRET_PREVIOUS', env);
    if (!secrets.includes(previous)) secrets.push(previous);
  }

  return secrets;
}

/** Secret used for signing (and the first verification attempt). */
export function getJwtSecret() {
  return resolveJwtSecret(process.env);
}

/** Current secret followed by the rotation grace-window secret, if any. */
export function getJwtVerificationSecrets() {
  return resolveJwtVerificationSecrets(process.env);
}

/**
 * Verify a token against an ordered list of secrets, accepting the first key
 * that validates it.
 *
 * @param {string} token
 * @param {string[]} secrets
 * @param {jwt.VerifyOptions} [options]
 */
export function verifyJwt(token, secrets, options = {}) {
  const attempts = secrets.map((secret) => {
    try {
      return { ok: true, value: jwt.verify(token, secret, options) };
    } catch (error) {
      return { ok: false, error };
    }
  });

  const match = attempts.find((attempt) => attempt.ok);
  if (match) return match.value;

  throw attempts.at(-1)?.error || new Error('No JWT signing secret configured');
}
