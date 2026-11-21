// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import Redis from 'ioredis';
import { readFileSync } from 'fs';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 60;

let client = null;

/**
 * Build ioredis TLS options from environment variables.
 *
 * Relevant env vars:
 *   REDIS_TLS=true                       — enable TLS (required to activate)
 *   REDIS_TLS_CA=/path/to/ca.crt         — CA certificate for server validation
 *   REDIS_TLS_CERT=/path/to/client.crt   — client certificate (mTLS)
 *   REDIS_TLS_KEY=/path/to/client.key    — client private key (mTLS)
 *   REDIS_TLS_REJECT_UNAUTHORIZED=true   — reject connections with invalid certs
 *                                          (default: true; set false only in dev)
 */
export function buildTlsOptions() {
  if (process.env.REDIS_TLS !== 'true') return null;

  // Default to strict validation; allow override for local dev with self-signed certs
  const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

  const tls = { rejectUnauthorized };

  // CA certificate — validate Redis server identity
  if (process.env.REDIS_TLS_CA) {
    tls.ca = readFileSync(process.env.REDIS_TLS_CA);
  }

  // Client certificate + key for mutual TLS (mTLS)
  if (process.env.REDIS_TLS_CERT) {
    tls.cert = readFileSync(process.env.REDIS_TLS_CERT);
  }
  if (process.env.REDIS_TLS_KEY) {
    tls.key = readFileSync(process.env.REDIS_TLS_KEY);
  }

  return tls;
}

function connect() {
  const tlsOptions = buildTlsOptions();

  const c = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    ...(tlsOptions && { tls: tlsOptions }),
  });
  c.on('error', () => {}); // suppress unhandled error events
  c.connect().catch(() => {});
  return c;
}

// Called once at startup (non-test environments)
export function initClient() {
  if (!client) client = connect();
}

// Allow tests to inject a mock or null (disabled)
export function setClient(mock) {
  client = mock;
}

export async function cacheGet(key) {
  if (!client) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', CACHE_TTL);
  } catch {
    // silent fallback
  }
}

export async function cacheDel(...keys) {
  if (!client) return;
  try {
    await client.del(...keys);
  } catch {
    // silent fallback
  }
}
