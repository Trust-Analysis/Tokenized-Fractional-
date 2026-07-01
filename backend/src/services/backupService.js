// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/backupService.js — Advanced backup management
 *
 * Provides:
 * - Scheduled backups (cloud agnostic: S3, GCS, or local)
 * - Multi-destination backup with fallback
 * - Backup listing with metadata and cloud source detection
 * - Point-in-time restore with validation
 * - Health checks and monitoring
 * - Backup policy enforcement
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Backup service configuration
 */
export class BackupService {
  constructor(backupModule, config, logger) {
    this.backup = backupModule; // exported from backup.js
    this.config = config;
    this.logger = logger || console;
    this.scheduler = null;
    this.metrics = {
      totalBackups: 0,
      lastBackupTime: null,
      lastBackupSize: 0,
      lastError: null,
      successCount: 0,
      failureCount: 0,
    };
  }

  /**
   * Get all backups (local + remote)
   * @returns {Promise<Array>} Backups with metadata and locations
   */
  async listAllBackups() {
    const backups = new Map();

    // Add local backups
    const localBackups = this.backup.listBackups(this.config);
    for (const b of localBackups) {
      backups.set(b.name, {
        name: b.name,
        createdAt: b.createdAt,
        locations: ['local'],
        verified: false,
        size: 0,
      });
    }

    // Add S3 backups if configured
    if (this.config.s3) {
      const s3Backups = await this._listS3Backups();
      for (const name of s3Backups) {
        const existing = backups.get(name) || {
          name,
          createdAt: this.backup.parseBackupTimestamp(name),
          locations: [],
          verified: false,
          size: 0,
        };
        if (!existing.locations.includes('s3')) {
          existing.locations.push('s3');
        }
        backups.set(name, existing);
      }
    }

    // Add GCS backups if configured
    if (this.config.gcs) {
      const gcsBackups = await this._listGCSBackups();
      for (const name of gcsBackups) {
        const existing = backups.get(name) || {
          name,
          createdAt: this.backup.parseBackupTimestamp(name),
          locations: [],
          verified: false,
          size: 0,
        };
        if (!existing.locations.includes('gcs')) {
          existing.locations.push('gcs');
        }
        backups.set(name, existing);
      }
    }

    return Array.from(backups.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * Run a full backup cycle
   * @returns {Promise<Object>} Backup result with locations
   */
  async runBackup() {
    const startTime = Date.now();

    try {
      // Create backup
      const result = await this.backup.runBackup(this.config, {
        log: this.logger,
      });

      // Upload to cloud storage if configured
      const locations = ['local'];

      if (this.config.s3) {
        try {
          await this.backup.uploadBackupToS3(result.dir, this.config, this.logger);
          locations.push('s3');
        } catch (error) {
          this.logger.error(`S3 upload failed: ${error.message}`);
          // Continue - backup still exists locally
        }
      }

      if (this.config.gcs) {
        try {
          await this._uploadBackupToGCS(result.dir);
          locations.push('gcs');
        } catch (error) {
          this.logger.error(`GCS upload failed: ${error.message}`);
          // Continue - backup still exists locally
        }
      }

      // Update metrics
      const duration = Date.now() - startTime;
      this.metrics.lastBackupTime = new Date().toISOString();
      this.metrics.lastBackupSize = this._calculateBackupSize(result.dir);
      this.metrics.successCount += 1;
      this.metrics.totalBackups = this._countTotalBackups();

      this.logger.info(
        `Backup completed: ${result.name} to ${locations.join(', ')} (${duration}ms)`,
      );

      return {
        success: true,
        name: result.name,
        locations,
        duration,
        size: this.metrics.lastBackupSize,
        timestamp: this.metrics.lastBackupTime,
      };
    } catch (error) {
      this.metrics.failureCount += 1;
      this.metrics.lastError = error.message;
      this.logger.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restore from a backup with automatic source detection
   * @param {string} name Backup name
   * @param {Object} options { force, source }
   * @returns {Promise<Object>} Restore result
   */
  async restore(name, { force = false, source } = {}) {
    const startTime = Date.now();

    try {
      let backupDir;

      if (source === 's3' || (!source && !existsSync(join(this.config.backupDir, name)))) {
        if (this.config.s3) {
          this.logger.info(`Downloading backup from S3: ${name}`);
          backupDir = await this.backup.downloadBackupFromS3(name, this.config, this.logger);
        } else {
          throw new Error(`Backup not found locally and S3 is not configured`);
        }
      } else if (source === 'gcs') {
        if (this.config.gcs) {
          this.logger.info(`Downloading backup from GCS: ${name}`);
          backupDir = await this._downloadBackupFromGCS(name);
        } else {
          throw new Error(`GCS is not configured`);
        }
      } else {
        backupDir = join(this.config.backupDir, name);
      }

      // Restore the backup
      const written = await this.backup.restoreBackup(name, {
        config: this.config,
        log: this.logger,
        force,
      });

      const duration = Date.now() - startTime;
      this.logger.info(`Restore completed: ${name} (${duration}ms, ${written.length} files)`);

      return {
        success: true,
        name,
        files: written,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Restore failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify a backup's integrity
   * @param {string} name Backup name
   * @returns {Promise<Object>} Verification result
   */
  async verifyBackup(name) {
    const backupDir = join(this.config.backupDir, name);

    if (!existsSync(backupDir)) {
      throw new Error(`Backup not found: ${name}`);
    }

    const verification = await this.backup.verifyBackup(backupDir);
    return {
      name,
      ok: verification.ok,
      members: verification.results,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Get backup health status
   * @returns {Object} Health information
   */
  getHealth() {
    const backups = this.backup.listBackups(this.config);
    const latestBackup = backups.length > 0 ? backups[backups.length - 1] : null;

    return {
      status: this.metrics.failureCount === 0 ? 'healthy' : 'degraded',
      totalBackups: backups.length,
      latestBackup: latestBackup
        ? {
            name: latestBackup.name,
            createdAt: latestBackup.createdAt.toISOString(),
            age: this._getBackupAge(latestBackup.createdAt),
          }
        : null,
      metrics: {
        successCount: this.metrics.successCount,
        failureCount: this.metrics.failureCount,
        lastBackupTime: this.metrics.lastBackupTime,
        lastBackupSize: this.metrics.lastBackupSize,
        lastError: this.metrics.lastError,
      },
    };
  }

  /**
   * Start scheduled backups
   * @param {Object} options { intervalHours }
   */
  startScheduler({ intervalHours = 24 } = {}) {
    if (this.scheduler) {
      this.logger.warn('Scheduler already running');
      return;
    }

    this.logger.info(`Starting backup scheduler (every ${intervalHours} hours)`);

    this.scheduler = setInterval(
      () => {
        this.runBackup()
          .then((result) => {
            this.logger.info(`Scheduled backup completed: ${result.name}`);
          })
          .catch((error) => {
            this.logger.error(`Scheduled backup failed: ${error.message}`);
          });
      },
      intervalHours * 3600 * 1000,
    );

    // Don't keep process alive just for backups
    this.scheduler.unref?.();
  }

  /**
   * Stop scheduled backups
   */
  stopScheduler() {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
      this.logger.info('Backup scheduler stopped');
    }
  }

  /**
   * Get backup configuration and policy
   */
  getPolicy() {
    return {
      retention: {
        days: this.config.retentionDays,
        max: this.config.retentionMax,
      },
      destinations: {
        local: true,
        s3: !!this.config.s3,
        gcs: !!this.config.gcs,
      },
      s3: this.config.s3
        ? {
            bucket: this.config.s3.bucket,
            region: this.config.s3.region,
          }
        : null,
      gcs: this.config.gcs
        ? {
            bucket: this.config.gcs.bucket,
            projectId: this.config.gcs.projectId,
          }
        : null,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  async _listS3Backups() {
    if (!this.config.s3) return [];
    try {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: this.config.s3.region,
        ...(this.config.s3.endpoint
          ? { endpoint: this.config.s3.endpoint, forcePathStyle: true }
          : {}),
      });

      const names = new Set();
      let ContinuationToken;

      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: this.config.s3.bucket,
            Prefix: `${this.config.s3.prefix}/`,
            ContinuationToken,
          }),
        );

        for (const obj of page.Contents || []) {
          const rest = obj.Key.slice(this.config.s3.prefix.length + 1);
          const backupName = rest.split('/')[0];
          if (backupName.startsWith('backup-')) {
            names.add(backupName);
          }
        }

        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);

      return Array.from(names);
    } catch (error) {
      this.logger.warn(`Failed to list S3 backups: ${error.message}`);
      return [];
    }
  }

  async _listGCSBackups() {
    if (!this.config.gcs) return [];
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage({
        projectId: this.config.gcs.projectId,
        keyFilename: this.config.gcs.keyFile,
      });

      const bucket = storage.bucket(this.config.gcs.bucket);
      const names = new Set();
      const prefix = `${this.config.gcs.prefix}/`;

      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) {
        const rest = file.name.slice(prefix.length);
        const backupName = rest.split('/')[0];
        if (backupName.startsWith('backup-')) {
          names.add(backupName);
        }
      }

      return Array.from(names);
    } catch (error) {
      this.logger.warn(`Failed to list GCS backups: ${error.message}`);
      return [];
    }
  }

  async _uploadBackupToGCS(backupDir) {
    if (!this.config.gcs) throw new Error('GCS not configured');

    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({
      projectId: this.config.gcs.projectId,
      keyFilename: this.config.gcs.keyFile,
    });

    const bucket = storage.bucket(this.config.gcs.bucket);
    const backupName = backupDir.split('/').pop();
    const prefix = `${this.config.gcs.prefix}/${backupName}`;

    const { readdirSync } = await import('fs');
    const files = readdirSync(backupDir);

    for (const file of files) {
      const localPath = join(backupDir, file);
      const remotePath = `${prefix}/${file}`;
      await bucket.upload(localPath, { destination: remotePath });
      this.logger.info(`Uploaded to GCS: gs://${this.config.gcs.bucket}/${remotePath}`);
    }
  }

  async _downloadBackupFromGCS(name) {
    if (!this.config.gcs) throw new Error('GCS not configured');

    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({
      projectId: this.config.gcs.projectId,
      keyFilename: this.config.gcs.keyFile,
    });

    const bucket = storage.bucket(this.config.gcs.bucket);
    const prefix = `${this.config.gcs.prefix}/${name}/`;
    const localDir = join(this.config.backupDir, name);
    mkdirSync(localDir, { recursive: true });

    const [files] = await bucket.getFiles({ prefix });
    if (files.length === 0) {
      throw new Error(`No objects found in gs://${this.config.gcs.bucket}/${prefix}`);
    }

    for (const file of files) {
      const fileName = file.name.slice(prefix.length);
      if (!fileName) continue;
      const localPath = join(localDir, fileName);
      await file.download({ destination: localPath });
      this.logger.info(`Downloaded from GCS: ${file.name}`);
    }

    return localDir;
  }

  _calculateBackupSize(dir) {
    try {
      const { readdirSync, statSync } = require('fs');
      let size = 0;
      for (const file of readdirSync(dir)) {
        const stat = statSync(join(dir, file));
        size += stat.size;
      }
      return size;
    } catch {
      return 0;
    }
  }

  _countTotalBackups() {
    try {
      return this.backup.listBackups(this.config).length;
    } catch {
      return 0;
    }
  }

  _getBackupAge(createdAt) {
    const now = Date.now();
    const created = createdAt.getTime();
    const diffMs = now - created;
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return `${diffDays}d ${diffHours}h`;
  }
}

/**
 * Factory function to create BackupService
 */
export function createBackupService(backupModule, config, logger) {
  return new BackupService(backupModule, config, logger);
}
