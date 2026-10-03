// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/rateLimiting.js — Admin endpoints for rate limit management
 *
 * Endpoints:
 * - GET /rate-limiting/config — View current rate limit configuration
 * - GET /rate-limiting/stats — Get rate limiter statistics
 * - POST /rate-limiting/reset — Reset rate limits for a user
 * - GET /rate-limiting/status — Get current rate limit status
 */

import { Router } from 'express';
import {
  getRateLimitStats,
  resetRateLimitForUser,
  RATE_LIMIT_TIERS,
  checkRateLimiterHealth,
} from '../middleware/tieredRateLimiter.js';

/**
 * Factory function to create rate limiting routes
 * @param {Object} logger
 * @param {Function} adminAuth - Admin auth middleware
 * @returns {Router}
 */
export function createRateLimitingRoutes(logger, adminAuth) {
  const router = Router();

  /**
   * GET /rate-limiting/config (Admin)
   * View current rate limit configuration by tier
   */
  router.get('/config', adminAuth, (req, res) => {
    try {
      const config = Object.entries(RATE_LIMIT_TIERS).map(([tier, limits]) => ({
        tier,
        name: limits.name,
        read: {
          windowMs: limits.read.windowMs,
          windowMinutes: limits.read.windowMs / (60 * 1000),
          maxRequests: limits.read.max,
          requestsPerSecond: (limits.read.max * 1000) / limits.read.windowMs,
        },
        write: {
          windowMs: limits.write.windowMs,
          windowMinutes: limits.write.windowMs / (60 * 1000),
          maxRequests: limits.write.max,
          requestsPerSecond: (limits.write.max * 1000) / limits.write.windowMs,
        },
      }));

      logger.info({ requestId: req.requestId }, 'Rate limit config retrieved');
      res.json({ data: config });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get rate limit config');
      res.status(500).json({ error: 'Failed to retrieve rate limit configuration', message: error.message });
    }
  });

  /**
   * GET /rate-limiting/stats (Admin)
   * Get rate limiter statistics and backend info
   */
  router.get('/stats', adminAuth, async (req, res) => {
    try {
      const stats = await getRateLimitStats();
      const health = await checkRateLimiterHealth();

      logger.info({ requestId: req.requestId }, 'Rate limit stats retrieved');
      res.json({
        data: {
          stats,
          health,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get rate limit stats');
      res.status(500).json({ error: 'Failed to retrieve rate limit statistics', message: error.message });
    }
  });

  /**
   * POST /rate-limiting/reset (Admin)
   * Reset rate limits for a specific user or IP
   *
   * Body:
   * - identifier: IP address or user identifier (required)
   * - tier: 'anonymous', 'authenticated', 'admin', or 'all' (optional, default: 'all')
   * - type: 'read', 'write', or 'all' (optional, default: 'all')
   */
  router.post('/reset', adminAuth, async (req, res) => {
    try {
      const { identifier, tier = 'all', type = 'all' } = req.body;

      if (!identifier) {
        return res.status(400).json({ error: 'identifier is required' });
      }

      if (tier !== 'all' && !['anonymous', 'authenticated', 'admin'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be: all, anonymous, authenticated, or admin' });
      }

      if (type !== 'all' && !['read', 'write'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Must be: all, read, or write' });
      }

      const success = await resetRateLimitForUser(identifier, tier, type);

      if (!success) {
        return res.status(500).json({ error: 'Failed to reset rate limits' });
      }

      logger.info(
        {
          identifier,
          tier,
          type,
          requestKey: req.apiKey?.id,
          requestId: req.requestId,
        },
        'Rate limit reset'
      );

      res.json({
        message: 'Rate limits reset successfully',
        identifier,
        tier,
        type,
      });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to reset rate limits');
      res.status(500).json({ error: 'Failed to reset rate limits', message: error.message });
    }
  });

  /**
   * GET /rate-limiting/status (Public)
   * Get current rate limit status for this request
   */
  router.get('/status', (req, res) => {
    try {
      const rateLimit = req.rateLimit;

      if (!rateLimit) {
        return res.json({
          data: {
            message: 'No rate limit active for this request',
            ip: req.ip,
          },
        });
      }

      logger.info({ tier: rateLimit.tier, requestId: req.requestId }, 'Rate limit status retrieved');
      res.json({
        data: {
          tier: rateLimit.tier,
          type: rateLimit.type,
          limit: rateLimit.limit,
          current: rateLimit.current,
          remaining: rateLimit.remaining,
          resetInSeconds: rateLimit.resetIn,
          percentageUsed: ((rateLimit.current / rateLimit.limit) * 100).toFixed(2) + '%',
        },
      });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get rate limit status');
      res.status(500).json({ error: 'Failed to retrieve rate limit status', message: error.message });
    }
  });

  /**
   * GET /rate-limiting/health (Admin)
   * Check rate limiter backend health
   */
  router.get('/health', adminAuth, async (req, res) => {
    try {
      const health = await checkRateLimiterHealth();

      logger.info({ health, requestId: req.requestId }, 'Rate limiter health checked');
      res.json({
        data: {
          health,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to check rate limiter health');
      res.status(500).json({ error: 'Failed to check rate limiter health', message: error.message });
    }
  });

  return router;
}
