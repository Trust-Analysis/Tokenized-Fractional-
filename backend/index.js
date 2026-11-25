// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * backend/index.js — compatibility re-export, NOT a server entry point.
 *
 * The only deployed entry point is src/server.js, which boots the single
 * Express application defined in src/app.js. This file exists solely so that
 * existing imports of `../index.js` keep resolving to the same app and helpers.
 * Do not add routes, middleware or app.listen() here — use src/app.js.
 */

import { logger } from './logger.js';
import { RateLimiterService } from './src/services/rateLimiterService.js';
import { AnomalyDetector } from './src/services/anomalyDetector.js';
import { GeoLimiter } from './src/services/geoLimiter.js';
import { RateLimitAnalytics } from './src/services/rateLimitAnalytics.js';
import { BillingService } from './src/services/billingService.js';

export { app, initializeApp, closeApp } from './src/app.js';
export { logger };
export {
  validateContractId,
  validateRwaBody,
  validateWebhookBody,
} from './src/validators/rwaValidator.js';
export {
  tokenize,
  buildSearchIndex,
  syncSearchIndex,
  scoreSearch,
} from './src/services/dataService.js';

export const rateLimitAnalytics = new RateLimitAnalytics({ logger });
export const anomalyDetector = new AnomalyDetector({ logger });
export const geoLimiter = new GeoLimiter({ logger });
export const billingService = new BillingService({ logger });
export const rateLimiterService = new RateLimiterService({
  logger,
  analytics: rateLimitAnalytics,
  anomalyDetector,
  geoLimiter,
  billingService,
});

rateLimiterService.configureApiKey(
  process.env.ADMIN_API_KEY || 'dev-key-change-in-production',
  'enterprise',
  { email: process.env.ADMIN_EMAIL },
);
