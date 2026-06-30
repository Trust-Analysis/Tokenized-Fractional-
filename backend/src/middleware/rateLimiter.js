// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/rateLimiter.js — rate limiting middleware for the API.
 * Exports two limiters: one for general API reads and one for write operations.
 */

import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config.js';

/**
 * General API limiter — applied to all /api/* routes.
 * 200 requests per 15 minutes.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/**
 * Write operation limiter — applied to POST / PATCH / DELETE routes.
 * In test mode the limit is relaxed so tests run without throttling.
 */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later' },
});
