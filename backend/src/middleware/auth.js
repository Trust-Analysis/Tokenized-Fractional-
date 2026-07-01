// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/auth.js — admin API key authentication middleware.
 * Validates the x-api-key header using the ApiKeyService.
 */

/**
 * Factory function to create the adminAuth middleware
 * @param {ApiKeyService} apiKeyService - The API key service instance
 * @returns {Function} Express middleware
 */
export function createAdminAuth(apiKeyService) {
  /**
   * Express middleware that requires a valid, non-revoked, non-expired admin API key.
   * Rejects requests with 401 when the key is absent, invalid, revoked, or expired.
   */
  return async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      req.log?.warn('Missing API key header');
      return res.status(401).json({
        error: 'Unauthorized: API key required',
        code: 'MISSING_API_KEY',
        requestId: req.requestId,
      });
    }

    try {
      const validation = await apiKeyService.validate(apiKey);

      if (!validation.valid) {
        req.log?.warn({ keyId: validation.id, reason: validation.reason }, 'Invalid API key');
        return res.status(401).json({
          error: `Unauthorized: ${validation.reason}`,
          code: 'INVALID_API_KEY',
          requestId: req.requestId,
        });
      }

      // Attach key metadata to request for logging
      req.apiKey = {
        id: validation.id,
        name: validation.name,
      };

      req.log?.info({ keyId: validation.id, keyName: validation.name }, 'Admin API key validated');
      next();
    } catch (error) {
      req.log?.error({ error: error.message }, 'API key validation error');
      res.status(500).json({
        error: 'Internal server error during authentication',
        requestId: req.requestId,
      });
    }
  };
}

/**
 * Legacy export for backward compatibility.
 * This will be initialized in app.js with the actual service.
 * @deprecated Use createAdminAuth(apiKeyService) instead
 */
export const adminAuth = (_req, res, _next) => {
  res.status(500).json({ error: 'adminAuth middleware not initialized' });
};
