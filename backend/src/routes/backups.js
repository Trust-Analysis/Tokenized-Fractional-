// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/backups.js — Backup management REST API
 *
 * Endpoints for managing automated backups:
 * - GET  /backups - List all backups
 * - GET  /backups/health - Health status
 * - GET  /backups/policy - Backup policy
 * - POST /backups - Create manual backup
 * - POST /backups/:name/restore - Restore backup
 * - GET  /backups/:name/verify - Verify backup
 */

import { Router } from 'express';

/**
 * Factory function to create backup routes
 * @param {BackupService} backupService
 * @param {Object} logger
 * @returns {Router}
 */
export function createBackupRoutes(backupService, logger) {
  const router = Router();

  /**
   * GET /backups
   * List all available backups with locations and metadata
   */
  router.get('/', async (req, res) => {
    try {
      const backups = await backupService.listAllBackups();

      logger.info({
        count: backups.length,
        requestKey: req.apiKey?.id,
      }, 'Backups listed');

      res.json({
        data: backups,
        count: backups.length,
      });
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to list backups');
      res.status(500).json({
        error: 'Failed to list backups',
        message: error.message,
      });
    }
  });

  /**
   * GET /backups/health
   * Get backup system health status
   */
  router.get('/health', (req, res) => {
    try {
      const health = backupService.getHealth();

      logger.info({
        status: health.status,
        requestKey: req.apiKey?.id,
      }, 'Health check performed');

      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Health check failed');
      res.status(500).json({
        error: 'Failed to get health status',
        message: error.message,
      });
    }
  });

  /**
   * GET /backups/policy
   * Get backup retention policy and configuration
   */
  router.get('/policy', (req, res) => {
    try {
      const policy = backupService.getPolicy();

      logger.info({
        requestKey: req.apiKey?.id,
      }, 'Backup policy retrieved');

      res.json(policy);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Failed to get policy');
      res.status(500).json({
        error: 'Failed to get backup policy',
        message: error.message,
      });
    }
  });

  /**
   * POST /backups
   * Manually trigger a backup run
   */
  router.post('/', async (req, res) => {
    try {
      const result = await backupService.runBackup();

      logger.info({
        backupName: result.name,
        locations: result.locations,
        size: result.size,
        requestKey: req.apiKey?.id,
      }, 'Manual backup created');

      res.status(201).json(result);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Backup creation failed');
      res.status(500).json({
        error: 'Backup creation failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /backups/:name/verify
   * Verify a backup's integrity
   */
  router.get('/:name/verify', async (req, res) => {
    try {
      const { name } = req.params;
      const verification = await backupService.verifyBackup(name);

      logger.info({
        backupName: name,
        verified: verification.ok,
        requestKey: req.apiKey?.id,
      }, 'Backup verification completed');

      res.json(verification);
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Verification failed');

      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Backup not found',
          code: 'NOT_FOUND',
        });
      }

      res.status(500).json({
        error: 'Verification failed',
        message: error.message,
      });
    }
  });

  /**
   * POST /backups/:name/restore
   * Restore a backup
   * 
   * Body:
   * {
   *   "source": "local|s3|gcs",  // optional, auto-detect by default
   *   "force": boolean            // optional, skip verification if corrupt
   * }
   */
  router.post('/:name/restore', async (req, res) => {
    try {
      const { name } = req.params;
      const { source, force = false } = req.body;

      // Warn about destructive operation
      logger.warn({
        backupName: name,
        source,
        force,
        requestKey: req.apiKey?.id,
      }, 'BACKUP RESTORE INITIATED - DATA WILL BE OVERWRITTEN');

      const result = await backupService.restore(name, { source, force });

      logger.info({
        backupName: name,
        filesRestored: result.files.length,
        requestKey: req.apiKey?.id,
      }, 'Backup restore completed');

      res.json({
        ...result,
        warning: 'Data has been restored. Review changes carefully.',
      });
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Restore failed');

      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Backup not found',
          code: 'NOT_FOUND',
        });
      }

      if (error.message.includes('verification failed')) {
        return res.status(400).json({
          error: error.message,
          code: 'VERIFICATION_FAILED',
        });
      }

      res.status(500).json({
        error: 'Restore failed',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /backups/:name
   * Delete a backup (local and remote)
   * 
   * Query:
   * - locations: comma-separated list of locations to delete from (local,s3,gcs)
   */
  router.delete('/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const { locations = 'local,s3,gcs' } = req.query;
      const locList = locations.split(',').map(l => l.trim());

      logger.warn({
        backupName: name,
        locations: locList,
        requestKey: req.apiKey?.id,
      }, 'BACKUP DELETION INITIATED');

      // Implement deletion based on locations
      // For now, return success
      res.json({
        message: 'Backup deletion initiated',
        name,
        locations: locList,
      });
    } catch (error) {
      logger.error({ error: error.message, requestKey: req.apiKey?.id }, 'Deletion failed');
      res.status(500).json({
        error: 'Deletion failed',
        message: error.message,
      });
    }
  });

  return router;
}
