// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/auth.js — admin API key authentication middleware.
 * Validates the x-api-key header against ADMIN_API_KEY.
 */

import { ADMIN_API_KEY } from '../config.js';

/**
 * Express middleware that requires a valid admin API key.
 * Rejects requests with 401 when the key is absent or incorrect.
 */
export function adminAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    req.log?.warn({ hasKey: !!apiKey }, 'Unauthorized API key attempt');
    return res.status(401).json({
      error: 'Unauthorized: invalid or missing API key',
      requestId: req.requestId,
    });
  }
  req.log?.info('Admin API key used');
  next();
}
