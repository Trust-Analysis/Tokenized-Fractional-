// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/archiveService.js — Issue #319: Data Archiving Strategy
 *
 * Implements automated data archiving for old transactions, logs, and
 * historical data. Maintains data accessibility for compliance while
 * keeping the main database performant.
 */

import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from './database.js';
import logger from './logger.js';

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || './archives';
const TRANSACTION_RETENTION_DAYS = parseInt(process.env.TRANSACTION_RETENTION_DAYS, 10) || 365;
const ACTIVITY_RETENTION_DAYS = parseInt(process.env.ACTIVITY_RETENTION_DAYS, 10) || 90;
const ANALYTICS_RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10) || 730;

/**
 * Archive old transactions older than the retention period
 * Moves data to JSON files in the archive directory
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldTransactions() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TRANSACTION_RETENTION_DAYS);

  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    // Find old transactions
    const oldTransactions = await db('transactions')
      .where('created_at', '<', cutoffDate)
      .select('*');

    if (oldTransactions.length === 0) {
      logger.info('[Archive] No old transactions to archive');
      return { archived: 0, cutoffDate: cutoffDate.toISOString() };
    }

    // Write to archive file
    const archiveId = `transactions_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archivePath = path.join(ARCHIVE_DIR, `${archiveId}.json`);

    await fs.writeFile(
      archivePath,
      JSON.stringify({
        id: archiveId,
        type: 'transactions',
        archivedAt: new Date().toISOString(),
        cutoffDate: cutoffDate.toISOString(),
        count: oldTransactions.length,
        data: oldTransactions,
      }),
      'utf-8'
    );

    // Delete archived records from main table
    const deletedCount = await db('transactions')
      .where('created_at', '<', cutoffDate)
      .del();

    logger.info(`[Archive] Archived ${deletedCount} transactions to ${archivePath}`);

    return {
      archived: deletedCount,
      archivePath,
      archiveId,
      cutoffDate: cutoffDate.toISOString(),
    };
  } catch (error) {
    logger.error(`[Archive] Transaction archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Archive old user activity data
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldActivity() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVITY_RETENTION_DAYS);

  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    const oldActivity = await db('user_activity')
      .where('last_purchase_at', '<', cutoffDate)
      .orWhereNull('last_purchase_at')
      .andWhere('created_at', '<', cutoffDate)
      .select('*');

    if (oldActivity.length === 0) {
      return { archived: 0 };
    }

    const archiveId = `activity_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archivePath = path.join(ARCHIVE_DIR, `${archiveId}.json`);

    await fs.writeFile(
      archivePath,
      JSON.stringify({
        id: archiveId,
        type: 'user_activity',
        archivedAt: new Date().toISOString(),
        count: oldActivity.length,
        data: oldActivity,
      }),
      'utf-8'
    );

    const deletedCount = await db('user_activity')
      .where('last_purchase_at', '<', cutoffDate)
      .orWhereNull('last_purchase_at')
      .andWhere('created_at', '<', cutoffDate)
      .del();

    logger.info(`[Archive] Archived ${deletedCount} activity records`);
    return { archived: deletedCount, archivePath, archiveId };
  } catch (error) {
    logger.error(`[Archive] Activity archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Archive old analytics data
 * @returns {Promise<Object>} Archive result
 */
export async function archiveOldAnalytics() {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ANALYTICS_RETENTION_DAYS);

  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    const oldAnalytics = await db('daily_analytics')
      .where('date', '<', cutoffDate)
      .select('*');

    if (oldAnalytics.length === 0) {
      return { archived: 0 };
    }

    const archiveId = `analytics_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archivePath = path.join(ARCHIVE_DIR, `${archiveId}.json`);

    await fs.writeFile(
      archivePath,
      JSON.stringify({
        id: archiveId,
        type: 'daily_analytics',
        archivedAt: new Date().toISOString(),
        count: oldAnalytics.length,
        data: oldAnalytics,
      }),
      'utf-8'
    );

    const deletedCount = await db('daily_analytics')
      .where('date', '<', cutoffDate)
      .del();

    logger.info(`[Archive] Archived ${deletedCount} analytics records`);
    return { archived: deletedCount, archivePath, archiveId };
  } catch (error) {
    logger.error(`[Archive] Analytics archival failed: ${error.message}`);
    throw error;
  }
}

/**
 * Run all archiving jobs
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
 * List all archive files
 * @returns {Promise<Array>} List of archive metadata
 */
export async function listArchives() {
  try {
    const files = await fs.readdir(ARCHIVE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const archives = [];
    for (const file of jsonFiles) {
      const filePath = path.join(ARCHIVE_DIR, file);
      const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      archives.push({
        id: content.id,
        type: content.type,
        archivedAt: content.archivedAt,
        count: content.count,
        path: filePath,
      });
    }

    return archives.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  } catch (error) {
    return [];
  }
}

/**
 * Restore data from an archive file back to the database
 * @param {string} archiveId - The archive to restore
 * @returns {Promise<Object>} Restore result
 */
export async function restoreFromArchive(archiveId) {
  const db = getDatabase();

  try {
    const archivePath = path.join(ARCHIVE_DIR, `${archiveId}.json`);
    const archive = JSON.parse(await fs.readFile(archivePath, 'utf-8'));

    let restoredCount = 0;
    await db.transaction(async (trx) => {
      for (const record of archive.data) {
        // Upsert to avoid duplicates
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
 * Get archiving statistics
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
