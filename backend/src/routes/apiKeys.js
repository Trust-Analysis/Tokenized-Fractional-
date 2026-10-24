// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/apiKeys.js — API key management routes
 * 
 * Admin endpoints for managing API keys:
 * - POST /api-keys — Create a new API key
 * - GET /api-keys — List all API keys
 * - GET /api-keys/:id — Get details about a specific API key
 * - GET /api-keys/:id/usage — Get usage statistics
 * - POST /api-keys/:id/rotate — Rotate an API key
 * - DELETE /api-keys/:id — Revoke/delete an API key
 */

import { Router } from 'express';

/**
 * Factory function to create the API keys router
 * @param {ApiKeyService} apiKeyService - The API key service instance
 * @param {Object} logger - Logger instance
 * @returns {Router} Express router
 */
export function createApiKeysRouter(apiKeyService, logger) {
  const router = Router();

  /**
   * POST /api-keys
   * Create a new API key
   */
  router.post('/', async (req, res) => {
    try {
      const { name, expiresAt, description } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          error: 'API key name is required and must be a non-empty string',
          code: 'INVALID_NAME',
        });
      }

      // Validate expiresAt if provided
      if (expiresAt) {
        const expiry = new Date(expiresAt);
        if (isNaN(expiry.getTime())) {
          return res.status(400).json({
            error: 'Invalid expiresAt date format. Use ISO 8601 format.',
            code: 'INVALID_DATE',
          });
        }
        if (expiry <= new Date()) {
          return res.status(400).json({
            error: 'Expiration date must be in the future',
            code: 'DATE_IN_PAST',
          });
        }
      }

      const result = await apiKeyService.create({
        name,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        description,
      });

      logger.info({
        keyId: result.id,
        keyName: result.name,
        requestKey: req.apiKey?.id,
      }, 'API key created via admin API');

      res.status(201).json(result);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to create API key');
      res.status(500).json({
        error: 'Failed to create API key',
        message: error.message,
      });
    }
  });

  /**
   * GET /api-keys
   * List all API keys (metadata only, not the secret)
   */
  router.get('/', async (req, res) => {
    try {
      const { includeRevoked } = req.query;
      const keys = await apiKeyService.list({
        includeRevoked: includeRevoked === 'true',
      });

      logger.info({
        count: keys.length,
        requestKey: req.apiKey?.id,
      }, 'API keys listed');

      res.json({
        data: keys,
        count: keys.length,
        note: 'API keys are returned with metadata only. The actual key material is never returned after creation.',
      });
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to list API keys');
      res.status(500).json({
        error: 'Failed to list API keys',
        message: error.message,
      });
    }
  });

  /**
   * GET /api-keys/:id
   * Get details about a specific API key
   */
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const key = await apiKeyService.getById(id);

      if (!key) {
        return res.status(404).json({
          error: 'API key not found',
          code: 'NOT_FOUND',
        });
      }

      logger.info({
        keyId: id,
        requestKey: req.apiKey?.id,
      }, 'API key details retrieved');

      res.json(key);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to retrieve API key');
      res.status(500).json({
        error: 'Failed to retrieve API key',
        message: error.message,
      });
    }
  });

  /**
   * GET /api-keys/:id/usage
   * Get usage statistics for an API key
   */
  router.get('/:id/usage', async (req, res) => {
    try {
      const { id } = req.params;
      const stats = await apiKeyService.getUsageStats(id);

      if (!stats) {
        return res.status(404).json({
          error: 'API key not found',
          code: 'NOT_FOUND',
        });
      }

      logger.info({
        keyId: id,
        usageCount: stats.usageCount,
        requestKey: req.apiKey?.id,
      }, 'API key usage stats retrieved');

      res.json(stats);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to retrieve usage stats');
      res.status(500).json({
        error: 'Failed to retrieve usage statistics',
        message: error.message,
      });
    }
  });

  /**
   * POST /api-keys/:id/rotate
   * Rotate an API key (revoke old, create new)
   */
  router.post('/:id/rotate', async (req, res) => {
    try {
      const { id } = req.params;
      const { expiresAt, description } = req.body;

      // Validate new expiresAt if provided
      if (expiresAt) {
        const expiry = new Date(expiresAt);
        if (isNaN(expiry.getTime())) {
          return res.status(400).json({
            error: 'Invalid expiresAt date format. Use ISO 8601 format.',
            code: 'INVALID_DATE',
          });
        }
        if (expiry <= new Date()) {
          return res.status(400).json({
            error: 'Expiration date must be in the future',
            code: 'DATE_IN_PAST',
          });
        }
      }

      const result = await apiKeyService.rotate(id, {
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        description,
      });

      logger.info({
        oldKeyId: id,
        newKeyId: result.newKey.id,
        requestKey: req.apiKey?.id,
      }, 'API key rotated via admin API');

      res.json(result);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to rotate API key');

      if (error.message === 'API key not found') {
        return res.status(404).json({
          error: error.message,
          code: 'NOT_FOUND',
        });
      }

      res.status(400).json({
        error: error.message,
        code: 'ROTATION_FAILED',
      });
    }
  });

  /**
   * DELETE /api-keys/:id
   * Revoke or delete an API key
   */
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { hardDelete } = req.query;

      if (hardDelete === 'true') {
        // Hard delete (remove from database)
        await apiKeyService.delete(id);
        logger.info({
          keyId: id,
          requestKey: req.apiKey?.id,
        }, 'API key hard deleted via admin API');

        res.json({
          message: 'API key deleted permanently',
          id,
        });
      } else {
        // Soft delete / revoke (mark as revoked)
        const result = await apiKeyService.revoke(id);
        logger.info({
          keyId: id,
          revokedAt: result.revokedAt,
          requestKey: req.apiKey?.id,
        }, 'API key revoked via admin API');

        res.json({
          message: 'API key revoked',
          ...result,
        });
      }
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to delete API key');

      if (error.message === 'API key not found') {
        return res.status(404).json({
          error: error.message,
          code: 'NOT_FOUND',
        });
      }

      res.status(400).json({
        error: error.message,
        code: 'DELETION_FAILED',
      });
    }
  });

  return router;
}
