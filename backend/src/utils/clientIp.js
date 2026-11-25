// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/utils/clientIp.js — single source of truth for client IP addresses.
 *
 * Express computes req.ip from X-Forwarded-For only when `trust proxy` is
 * configured (see src/config.js TRUST_PROXY). Never parse the header here:
 * a direct client can spoof it. For non-Express requests (raw http/OTEL),
 * req.ip is undefined and the socket address is used instead.
 */

/**
 * @param {object} req - Express request (or raw IncomingMessage)
 * @returns {string|null} normalized client IP
 */
export function getClientIp(req) {
  if (!req) return null;
  if (typeof req.clientIp === 'string') return req.clientIp;

  const raw = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || null;
  if (!raw) return null;

  const ip = String(raw).startsWith('::ffff:') ? String(raw).slice(7) : String(raw);
  req.clientIp = ip;
  return ip;
}

/**
 * Resolve the IP once per request so limiters, tracing, monitoring and audit
 * logs all observe exactly the same value.
 */
export function createClientIpMiddleware() {
  return (req, _res, next) => {
    getClientIp(req);
    next();
  };
}
