// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/config.js — centralised environment variables and application constants.
 * All other modules should import from here rather than reading process.env directly.
 */

export const PORT = process.env.PORT || 3001;

export const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:4173'];

export const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Proxy chain Express is allowed to trust for X-Forwarded-For.
 *
 * Values (TRUST_PROXY env var):
 *   unset / "0" / "false"  → trust no proxy (safe default, direct connections)
 *   integer >= 1           → trust exactly this many hops in front of the app
 *   comma-separated IPs / CIDRs → trust only these proxy addresses
 *   "true"                 → development only; rejected in production
 */
function parseTrustProxy(value) {
  const raw = (value || '').trim();
  if (!raw || raw === '0' || raw === 'false') return false;
  if (raw === 'true') {
    if (NODE_ENV === 'production') {
      throw new Error(
        'TRUST_PROXY=true is unsafe in production: set an exact hop count or proxy CIDR list',
      );
    }
    return true;
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

export const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'test' ? 'silent' : 'info');

export const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-key-change-in-production';

export const DATA_FILE = process.env.DATA_FILE || 'data.json';

export const WEBHOOK_DATA_FILE = process.env.WEBHOOK_DATA_FILE || 'webhooks.json';

export const SENTRY_DSN = process.env.SENTRY_DSN || null;

export const SENTRY_TRACES_SAMPLE_RATE = process.env.SENTRY_TRACES_SAMPLE_RATE
  ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
  : 0.1;

export const SENTRY_PROFILES_SAMPLE_RATE = process.env.SENTRY_PROFILES_SAMPLE_RATE
  ? parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE)
  : 0.1;

export const REDIS_URL = process.env.REDIS_URL || null;

export const DEPLOYMENT_COLOR = process.env.DEPLOYMENT_COLOR || 'local';

export const SERVICE_NAME = process.env.SERVICE_NAME || 'backend';

export const BUILD_ID = process.env.BUILD_ID || process.env.GITHUB_SHA || 'local';

/** Asset lifecycle statuses */
export const ASSET_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/** Webhook event names */
export const WEBHOOK_EVENTS = {
  CREATED: 'asset.created',
  UPDATED: 'asset.updated',
  DELETED: 'asset.deleted',
  APPROVED: 'asset.approved',
  REJECTED: 'asset.rejected',
};

export const WEBHOOK_VALID_EVENTS = Object.values(WEBHOOK_EVENTS);
