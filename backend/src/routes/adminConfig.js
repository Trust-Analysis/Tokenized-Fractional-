// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/adminConfig.js — Issues #321-323, #329: Admin Configuration Panel
 *
 * Provides endpoints for managing contract parameters, platform settings,
 * and admin configuration with full validation and audit logging.
 */

import { Router } from 'express';
import { adminAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { createAuditLogService } from '../services/auditLogService.js';

const auditLogService = createAuditLogService();

// In-memory config store (production would use database)
let platformConfig = {
  // Contract parameters
  pricePerShare: 1000000, // in smallest token units
  totalShares: 100000,
  maxSharesPerUser: 10000,
  dividendInterval: 604800, // 7 days in seconds
  dividendAmountPerShare: 100,

  // Platform settings
  minPurchaseAmount: 1,
  maxPurchaseAmount: 50000,
  allowWhitelistOnly: false,
  enableFlashLoanProtection: true,
  flashLoanMinHoldTime: 600, // seconds

  // Fee settings
  platformFeePercent: 250, // 2.5% = 250 basis points
  royaltyPercent: 100, // 1%

  // Pause state
  buyPaused: false,
  sellPaused: false,
  transferPaused: false,

  // Metadata
  lastUpdated: new Date().toISOString(),
  updatedBy: null,
};

// Validation helpers
const validators = {
  pricePerShare: (v) => typeof v === 'number' && v > 0 && v <= 1000000000,
  totalShares: (v) => typeof v === 'number' && v > 0 && v <= 1000000000,
  maxSharesPerUser: (v) => typeof v === 'number' && v >= 0 && v <= 1000000000,
  dividendInterval: (v) => typeof v === 'number' && v >= 60 && v <= 31536000, // 1 min to 1 year
  dividendAmountPerShare: (v) => typeof v === 'number' && v >= 0 && v <= 1000000000,
  minPurchaseAmount: (v) => typeof v === 'number' && v >= 1,
  maxPurchaseAmount: (v) => typeof v === 'number' && v >= 1,
  allowWhitelistOnly: (v) => typeof v === 'boolean',
  enableFlashLoanProtection: (v) => typeof v === 'boolean',
  flashLoanMinHoldTime: (v) => typeof v === 'number' && v >= 0 && v <= 86400,
  platformFeePercent: (v) => typeof v === 'number' && v >= 0 && v <= 10000,
  royaltyPercent: (v) => typeof v === 'number' && v >= 0 && v <= 5000,
  buyPaused: (v) => typeof v === 'boolean',
  sellPaused: (v) => typeof v === 'boolean',
  transferPaused: (v) => typeof v === 'boolean',
};

const validationMessages = {
  pricePerShare: 'Price must be a positive number up to 1 billion',
  totalShares: 'Total shares must be a positive number up to 1 billion',
  maxSharesPerUser: 'Max shares per user must be 0 (unlimited) or up to 1 billion',
  dividendInterval: 'Dividend interval must be between 60 seconds and 1 year',
  dividendAmountPerShare: 'Dividend amount per share must be between 0 and 1 billion',
  minPurchaseAmount: 'Minimum purchase must be at least 1',
  maxPurchaseAmount: 'Maximum purchase must be at least 1',
  allowWhitelistOnly: 'Allow whitelist only must be a boolean',
  enableFlashLoanProtection: 'Flash loan protection setting must be a boolean',
  flashLoanMinHoldTime: 'Flash loan min hold time must be between 0 and 86400 seconds',
  platformFeePercent: 'Platform fee must be between 0 and 100% (0-10000 basis points)',
  royaltyPercent: 'Royalty must be between 0 and 50% (0-5000 basis points)',
  buyPaused: 'Buy paused must be a boolean',
  sellPaused: 'Sell paused must be a boolean',
  transferPaused: 'Transfer paused must be a boolean',
};

export function createAdminConfigRoutes() {
  const router = Router();

  // GET /admin/config - Get current configuration
  router.get('/config', adminAuth, (req, res) => {
    res.json({
      config: platformConfig,
      lastUpdated: platformConfig.lastUpdated,
    });
  });

  // PATCH /admin/config - Update configuration (partial update)
  router.patch('/config', adminAuth, writeLimiter, (req, res) => {
    const updates = req.body;
    const errors = [];
    const changedFields = {};

    // Validate each field
    for (const [key, value] of Object.entries(updates)) {
      if (validators[key]) {
        if (!validators[key](value)) {
          errors.push({
            field: key,
            message: validationMessages[key],
            value,
          });
        } else {
          changedFields[key] = { old: platformConfig[key], new: value };
        }
      } else {
        errors.push({
          field: key,
          message: `Unknown configuration field: ${key}`,
        });
      }
    }

    // Business logic validation
    if (updates.minPurchaseAmount && updates.maxPurchaseAmount) {
      if (updates.minPurchaseAmount > updates.maxPurchaseAmount) {
        errors.push({
          field: 'maxPurchaseAmount',
          message: 'Maximum purchase must be greater than minimum purchase',
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Apply updates
    const adminKey = req.headers['x-api-key'] || 'unknown';
    Object.assign(platformConfig, updates);
    platformConfig.lastUpdated = new Date().toISOString();
    platformConfig.updatedBy = adminKey;

    // Log audit
    auditLogService.logAction('config_update', adminKey, changedFields, req);

    res.json({
      config: platformConfig,
      changed: Object.keys(changedFields),
    });
  });

  // PUT /admin/config - Full configuration replace
  router.put('/config', adminAuth, writeLimiter, (req, res) => {
    const newConfig = req.body;
    const errors = [];

    // Validate all fields
    for (const [key, value] of Object.entries(newConfig)) {
      if (validators[key]) {
        if (!validators[key](value)) {
          errors.push({
            field: key,
            message: validationMessages[key],
            value,
          });
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Replace config
    const adminKey = req.headers['x-api-key'] || 'unknown';
    const oldConfig = { ...platformConfig };
    platformConfig = {
      ...newConfig,
      lastUpdated: new Date().toISOString(),
      updatedBy: adminKey,
    };

    // Log audit
    auditLogService.logAction('config_replace', adminKey, { old: oldConfig, new: platformConfig }, req);

    res.json({
      config: platformConfig,
    });
  });

  // GET /admin/config/validate - Validate configuration without applying
  router.get('/config/validate', adminAuth, (req, res) => {
    const errors = [];

    for (const [key, value] of Object.entries(req.query)) {
      if (validators[key]) {
        const numValue = Number(value);
        if (!validators[key](numValue)) {
          errors.push({
            field: key,
            message: validationMessages[key],
            value: numValue,
          });
        }
      }
    }

    res.json({
      valid: errors.length === 0,
      errors,
    });
  });

  // POST /admin/config/reset - Reset to default configuration
  router.post('/config/reset', adminAuth, writeLimiter, (req, res) => {
    const adminKey = req.headers['x-api-key'] || 'unknown';
    const oldConfig = { ...platformConfig };

    platformConfig = {
      pricePerShare: 1000000,
      totalShares: 100000,
      maxSharesPerUser: 10000,
      dividendInterval: 604800,
      dividendAmountPerShare: 100,
      minPurchaseAmount: 1,
      maxPurchaseAmount: 50000,
      allowWhitelistOnly: false,
      enableFlashLoanProtection: true,
      flashLoanMinHoldTime: 600,
      platformFeePercent: 250,
      royaltyPercent: 100,
      buyPaused: false,
      sellPaused: false,
      transferPaused: false,
      lastUpdated: new Date().toISOString(),
      updatedBy: adminKey,
    };

    auditLogService.logAction('config_reset', adminKey, { old: oldConfig }, req);

    res.json({
      config: platformConfig,
      message: 'Configuration reset to defaults',
    });
  });

  // GET /admin/config/audit - Get audit log
  router.get('/config/audit', adminAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;

    const result = await auditLogService.getLogs({
      action: req.query.action,
      userId: req.query.userId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit,
      offset,
    });

    res.json(result);
  });

  // POST /admin/config/export - Export configuration
  router.post('/config/export', adminAuth, (req, res) => {
    const { includeAudit = false } = req.body || {};

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      config: { ...platformConfig },
    };

    if (includeAudit) {
      const { entries } = await auditLogService.getLogs({ limit: 100 });
      exportData.auditLog = entries;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="admin-config-${Date.now()}.json"`);
    res.json(exportData);
  });

  // POST /admin/config/import - Import configuration
  router.post('/config/import', adminAuth, writeLimiter, (req, res) => {
    const { config: importedConfig, overwrite = false } = req.body;

    if (!importedConfig || typeof importedConfig !== 'object') {
      return res.status(400).json({ error: 'Invalid configuration format' });
    }

    const errors = [];
    for (const [key, value] of Object.entries(importedConfig)) {
      if (validators[key] && !validators[key](value)) {
        errors.push({
          field: key,
          message: validationMessages[key],
          value,
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const adminKey = req.headers['x-api-key'] || 'unknown';
    const oldConfig = { ...platformConfig };

    if (overwrite) {
      platformConfig = {
        ...importedConfig,
        lastUpdated: new Date().toISOString(),
        updatedBy: adminKey,
      };
    } else {
      Object.assign(platformConfig, importedConfig, {
        lastUpdated: new Date().toISOString(),
        updatedBy: adminKey,
      });
    }

    auditLogService.logAction('config_import', adminKey, { old: oldConfig, imported: importedConfig }, req);

    res.json({
      config: platformConfig,
      imported: Object.keys(importedConfig),
      overwrite,
    });
  });

  return router;
}
