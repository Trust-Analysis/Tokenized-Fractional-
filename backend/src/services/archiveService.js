// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/archiveService.js — Issue #319, Issue #911: Secure Data Archiving Strategy
 *
 * Implements automated, encrypted-at-rest data archiving for old transactions,
 * logs, and analytics data older than retention windows. Ships archived records
 * to durable off-site object storage (S3 with Server-Side Encryption) and encrypts
 * any local or intermediate storage with authenticated AES-256-GCM.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getDatabase } from './database.js';
import logger from './logger.js';

const TRANSACTION_RETENTION_DAYS = parseInt(process.env.TRANSACTION_RETENTION_DAYS, 10) || 365;
const ACTIVITY_RETENTION_DAYS = parseInt(process.env.ACTIVITY_RETENTION_DAYS, 10) || 90;
const ANALYTICS_RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10) || 730;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

/**
 * Retrieve or derive the 256-bit encryption key for archive at-rest encryption.
 * @returns {Buffer} 32-byte encryption key
 */
function getEncryptionKey() {
  const envKey = process.env.ARCHIVE_ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    return crypto.createHash('sha256').update(envKey).digest();
  }
  logger.warn('[Archive] ARCHIVE_ENCRYPTION_KEY not set. Using derived development fallback key.');
  return crypto.createHash('sha256').update('default-dev-compliance-archive-key').digest();
}

/**
 * Encrypt archive payload using AES-256-GCM authenticated encryption.
 * @param {any} payloadObj
 * @returns {{algorithm: string, iv: string, tag: string, ciphertext: string}}
 */
export function encryptArchivePayload(payloadObj) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: ALGORITHM,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypt archive payload using AES-256-GCM and verify auth tag.
 * @param {{algorithm?: string, iv: string, tag: string, ciphertext: string}} encryptedEnvelope
 * @returns {any} Decrypted object
 */
export function decryptArchivePayload(encryptedEnvelope) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedEnvelope.iv, 'hex');
  const tag = Buffer.from(encryptedEnvelope.tag, 'hex');
  const ciphertext = Buffer.from(encryptedEnvelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(encryptedEnvelope.algorithm || ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

/**
 * Dynamically load AWS S3 client if available.
 */
async function loadS3() {
  try {
    return await import('@aws-sdk/client-s3');
  } catch {
    logger.warn('[Archive] @aws-sdk/client-s3 is not installed; S3 upload disabled');
    return null;
  }
}

/**
 * Storage configuration for archiving.
 */
export function getArchiveStorageConfig() {
  return {
    archiveDir: process.env.ARCHIVE_DIR || './archives',
    s3Bucket: process.env.ARCHIVE_S3_BUCKET || null,
    s3Prefix: (process.env.ARCHIVE_S3_PREFIX || 'compliance-archives').replace(/\/+$/, ''),
    s3Region: process.env.ARCHIVE_S3_REGION || process.env.AWS_REGION || 'us-east-1',
    s3Endpoint: process.env.ARCHIVE_S3_ENDPOINT || undefined,
    s3Sse: process.env.ARCHIVE_S3_SSE || 'AES256',
    retainLocal: process.env.ARCHIVE_RETAIN_LOCAL === 'true' || !process.env.ARCHIVE_S3_BUCKET,
  };
}

/**
 * Persist an encrypted archive record to local storage and/or durable off-site S3 storage.
 */
async function persistArchiveRecord(archiveId, type, metadata, rawData) {
  const config = getArchiveStorageConfig();
  await fs.mkdir(config.archiveDir, { recursive: true });

  const encryptedData = encryptArchivePayload(rawData);

  const archiveRecord = {
    id: archiveId,
    type,
    encrypted: true,
    algorithm: encryptedData.algorithm,
    iv: encryptedData.iv,
    tag: encryptedData.tag,
    ciphertext: encryptedData.ciphertext,
    archivedAt: new Date().toISOString(),
    count: rawData.length,
    ...metadata,
  };

  const serialized = JSON.stringify(archiveRecord, null, 2);
  const localPath = path.join(config.archiveDir, `${archiveId}.json`);

  let s3Location = null;
  if (config.s3Bucket) {
    try {
      const s3Module = await loadS3();
      if (s3Module) {
        const { S3Client, PutObjectCommand } = s3Module;
        const client = new S3Client({
          region: config.s3Region,
          ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
        });

        const key = `${config.s3Prefix}/${archiveId}.json`;
        await client.send(
          new PutObjectCommand({
            Bucket: config.s3Bucket,
            Key: key,
            Body: serialized,
            ContentType: 'application/json',
            ServerSideEncryption: config.s3Sse,
          })
        );
        s3Location = `s3://${config.s3Bucket}/${key}`;
        logger.info(`[Archive] Shipped encrypted archive to ${s3Location} (SSE: ${config.s3Sse})`);
      }
    } catch (err) {
      logger.error(`[Archive] S3 shipping failed for ${archiveId}: ${err.message}`);
    }
  }

  if (config.retainLocal || !s3Location) {
    await fs.writeFile(localPath, serialized, 'utf-8');
    logger.info(`[Archive] Stored encrypted archive locally at ${localPath}`);
  } else {
    try {
      await fs.unlink(localPath);
    } catch {
      // file might not exist yet
    }
  }

  return {
    archiveId,
    archivePath: (config.retainLocal || !s3Location) ? localPath : null,
    s3Location,
    encrypted: true,
  };
}

/**
 * Archive old transactions older than the retention period.
 * Moves data to encrypted off-site / local storage.
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldTransactions() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TRANSACTION_RETENTION_DAYS);

  try {
    // Issue #912: Exclude transactions with active legal holds
    const oldTransactions = await db('transactions')
      .where('created_at', '<', cutoffDate)
      .where((builder) => {
        builder.where('legal_hold', false).orWhereNull('legal_hold');
      })
      .select('*');

    if (oldTransactions.length === 0) {
      logger.info('[Archive] No old transactions to archive');
      return { archived: 0, cutoffDate: cutoffDate.toISOString() };
    }

    const archiveId = `transactions_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const persisted = await persistArchiveRecord(
      archiveId,
      'transactions',
      { cutoffDate: cutoffDate.toISOString() },
      oldTransactions
    );

    const deletedCount = await db('transactions')
      .where('created_at', '<', cutoffDate)
      .where((builder) => {
        builder.where('legal_hold', false).orWhereNull('legal_hold');
      })
      .del();

    logger.info(`[Archive] Archived ${deletedCount} transactions (Archive ID: ${archiveId})`);

    return {
      archived: deletedCount,
      ...persisted,
      cutoffDate: cutoffDate.toISOString(),
    };
  } catch (error) {
    logger.error(`[Archive] Transaction archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Issue #912: Place a legal hold on a transaction, exempting it from automated archiving.
 * @param {string|number} transactionId
 * @param {Object} options
 * @returns {Promise<Object>} Updated transaction
 */
export async function placeLegalHold(transactionId, options = {}) {
  const db = getDatabase();
  const { reason = 'Active investigation or dispute', placedBy = 'admin' } = options;

  const tx = await db('transactions')
    .where('id', transactionId)
    .orWhere('transaction_id', transactionId)
    .first();

  if (!tx) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  await db('transactions')
    .where('id', tx.id)
    .update({
      legal_hold: true,
      legal_hold_reason: reason,
      legal_hold_placed_at: new Date(),
      legal_hold_placed_by: placedBy,
      updated_at: new Date(),
    });

  logger.info(`[Archive] Placed legal hold on transaction ${tx.id} (${tx.transaction_id}). Reason: ${reason}`);
  return db('transactions').where('id', tx.id).first();
}

/**
 * Issue #912: Release a legal hold on a transaction.
 * @param {string|number} transactionId
 * @param {Object} options
 * @returns {Promise<Object>} Updated transaction
 */
export async function releaseLegalHold(transactionId, options = {}) {
  const db = getDatabase();
  const { releasedBy = 'admin' } = options;

  const tx = await db('transactions')
    .where('id', transactionId)
    .orWhere('transaction_id', transactionId)
    .first();

  if (!tx) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  await db('transactions')
    .where('id', tx.id)
    .update({
      legal_hold: false,
      legal_hold_reason: null,
      legal_hold_placed_at: null,
      legal_hold_placed_by: null,
      updated_at: new Date(),
    });

  logger.info(`[Archive] Released legal hold on transaction ${tx.id} (${tx.transaction_id}) by ${releasedBy}`);
  return db('transactions').where('id', tx.id).first();
}


/**
 * Archive old user activity data.
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldActivity() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVITY_RETENTION_DAYS);

  try {
    const oldActivity = await db('user_activity')
      .where('last_purchase_at', '<', cutoffDate)
      .orWhereNull('last_purchase_at')
      .andWhere('created_at', '<', cutoffDate)
      .select('*');

    if (oldActivity.length === 0) {
      return { archived: 0 };
    }

    const archiveId = `activity_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const persisted = await persistArchiveRecord(
      archiveId,
      'user_activity',
      { cutoffDate: cutoffDate.toISOString() },
      oldActivity
    );

    const deletedCount = await db('user_activity')
      .where('last_purchase_at', '<', cutoffDate)
      .orWhereNull('last_purchase_at')
      .andWhere('created_at', '<', cutoffDate)
      .del();

    logger.info(`[Archive] Archived ${deletedCount} activity records (Archive ID: ${archiveId})`);
    return { archived: deletedCount, ...persisted };
  } catch (error) {
    logger.error(`[Archive] Activity archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Archive old analytics data.
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldAnalytics() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ANALYTICS_RETENTION_DAYS);

  try {
    const oldAnalytics = await db('daily_analytics')
      .where('date', '<', cutoffDate)
      .select('*');

    if (oldAnalytics.length === 0) {
      return { archived: 0 };
    }

    const archiveId = `analytics_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const persisted = await persistArchiveRecord(
      archiveId,
      'daily_analytics',
      { cutoffDate: cutoffDate.toISOString() },
      oldAnalytics
    );

    const deletedCount = await db('daily_analytics')
      .where('date', '<', cutoffDate)
      .del();

    logger.info(`[Archive] Archived ${deletedCount} analytics records (Archive ID: ${archiveId})`);
    return { archived: deletedCount, ...persisted };
  } catch (error) {
    logger.error(`[Archive] Analytics archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Run all archiving jobs.
 * @returns {Promise<Object>} Combined results
 */
export async function runAllArchiving() {
  const results = {
    transactions: await archiveOldTransactions(),
    activity: await archiveOldActivity(),
    analytics: await archiveOldAnalytics(),
    timestamp: new Date().toISOString(),
  };

  const totalArchived =
    results.transactions.archived +
    results.activity.archived +
    results.analytics.archived;

  logger.info(`[Archive] Total records archived: ${totalArchived}`);
  return results;
}

/**
 * List all archive records from local storage or S3 metadata.
 * @returns {Promise<Array>} List of archive metadata
 */
export async function listArchives() {
  const config = getArchiveStorageConfig();
  const archives = [];

  try {
    const files = await fs.readdir(config.archiveDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(config.archiveDir, file);
        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        archives.push({
          id: content.id,
          type: content.type,
          encrypted: Boolean(content.encrypted),
          archivedAt: content.archivedAt,
          count: content.count,
          path: filePath,
          storage: 'local',
        });
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Local directory might not exist yet
  }

  return archives.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
}

/**
 * Retrieve an archived record from S3 or local disk and decrypt it if encrypted.
 * @param {string} archiveId - The ID of the archive
 * @returns {Promise<Object>} Decrypted archive record with .data
 */
export async function retrieveArchive(archiveId) {
  const config = getArchiveStorageConfig();
  let recordContent = null;

  const localPath = path.join(config.archiveDir, `${archiveId}.json`);
  try {
    recordContent = await fs.readFile(localPath, 'utf-8');
  } catch {
    // If not on local disk, try S3
    if (config.s3Bucket) {
      const s3Module = await loadS3();
      if (s3Module) {
        const { S3Client, GetObjectCommand } = s3Module;
        const client = new S3Client({
          region: config.s3Region,
          ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
        });
        const key = `${config.s3Prefix}/${archiveId}.json`;
        const res = await client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
        recordContent = await res.Body.transformToString('utf-8');
      }
    }
  }

  if (!recordContent) {
    throw new Error(`Archive ${archiveId} not found in local storage or S3.`);
  }

  const archive = JSON.parse(recordContent);
  if (archive.encrypted) {
    const decryptedData = decryptArchivePayload(archive);
    return {
      ...archive,
      data: decryptedData,
    };
  }

  return archive;
}

/**
 * Export an archive for compliance audit requests with tamper-evident SHA-256 hash.
 * @param {string} archiveId - Archive ID to export
 * @returns {Promise<Object>} Formatted audit export
 */
export async function exportArchiveForAudit(archiveId) {
  const archive = await retrieveArchive(archiveId);
  const hash = crypto.createHash('sha256').update(JSON.stringify(archive.data)).digest('hex');

  return {
    complianceAudit: {
      archiveId: archive.id,
      recordType: archive.type,
      archivedAt: archive.archivedAt,
      cutoffDate: archive.cutoffDate,
      recordCount: archive.count,
      dataSha256Digest: hash,
      verifiedAuthentic: true,
      exportedAt: new Date().toISOString(),
    },
    records: archive.data,
  };
}

/**
 * Restore data from an archive file back to the database.
 * Supports both encrypted archives and legacy plaintext archives.
 * @param {string} archiveId - The archive to restore
 * @returns {Promise<Object>} Restore result
 */
export async function restoreFromArchive(archiveId) {
  const db = getDatabase();

  try {
    const archive = await retrieveArchive(archiveId);

    let restoredCount = 0;
    await db.transaction(async (trx) => {
      for (const record of archive.data) {
        const existing = await trx(archive.type)
          .where('id', record.id)
          .first();

        if (!existing) {
          await trx(archive.type).insert(record);
          restoredCount++;
        }
      }
    });

    logger.info(`[Archive] Restored ${restoredCount} records from ${archiveId}`);
    return { archiveId, restoredCount, type: archive.type };
  } catch (error) {
    logger.error(`[Archive] Restore failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get archiving statistics.
 * @returns {Promise<Object>} Archiving stats
 */
export async function getArchiveStats() {
  const db = getDatabase();

  const [transactionCount] = await db('transactions').count('* as count');
  const [activityCount] = await db('user_activity').count('* as count');
  const [analyticsCount] = await db('daily_analytics').count('* as count');

  const archives = await listArchives();

  return {
    currentRecordCounts: {
      transactions: parseInt(transactionCount.count, 10),
      userActivity: parseInt(activityCount.count, 10),
      dailyAnalytics: parseInt(analyticsCount.count, 10),
    },
    archiveCounts: {
      transactions: archives.filter(a => a.type === 'transactions').length,
      userActivity: archives.filter(a => a.type === 'user_activity').length,
      dailyAnalytics: archives.filter(a => a.type === 'daily_analytics').length,
    },
    retentionPolicies: {
      transactions: `${TRANSACTION_RETENTION_DAYS} days`,
      activity: `${ACTIVITY_RETENTION_DAYS} days`,
      analytics: `${ANALYTICS_RETENTION_DAYS} days`,
    },
  };
}
