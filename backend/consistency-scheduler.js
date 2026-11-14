/**
 * backend/consistency-scheduler.js
 *
 * Scheduler for periodic data consistency checks.
 *
 * Runs consistency checks on an interval (default: every 60 minutes).
 * Writes detailed logs and can optionally auto-repair issues.
 *
 * Configuration:
 *   CONSISTENCY_CHECK_ENABLED    — set to 'true' to enable (default: false)
 *   CONSISTENCY_CHECK_INTERVAL_MINUTES — check interval (default: 60)
 *   CONSISTENCY_AUTO_REPAIR      — auto-apply fixes (default: false)
 *   CONSISTENCY_LOG_DIR          — directory for check logs (optional)
 */

import { logger } from './index.js';
import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { cacheGet } from './cache.js';
import {
  generateConsistencyReport,
  generateSummaryReport,
  compareWithOnChainState,
} from './consistency.js';
import { executeReconciliation } from './reconciliation.js';

const ENABLED = process.env.CONSISTENCY_CHECK_ENABLED === 'true';
const INTERVAL_MINUTES = parseInt(process.env.CONSISTENCY_CHECK_INTERVAL_MINUTES) || 60;
const AUTO_REPAIR = process.env.CONSISTENCY_AUTO_REPAIR === 'true';
const LOG_DIR = process.env.CONSISTENCY_LOG_DIR || null;

let schedulerIntervalId = null;

/**
 * Write a consistency check report to a file (JSON format).
 * @param {object} report — the report to write
 */
async function writeCheckLog(report) {
  if (!LOG_DIR) return; // logging disabled

  try {
    await mkdir(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `consistency-check-${timestamp}.json`;
    const filepath = join(LOG_DIR, filename);
    await writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
    logger.info({ filepath }, 'Consistency check report written');
  } catch (err) {
    logger.error({ err, logDir: LOG_DIR }, 'Failed to write consistency check log');
  }
}

/**
 * Load all asset data from the database (JSON file).
 * @param {function} loadDataFn — the loadData() function from index.js
 * @returns {object} { contractId: asset metadata, ... }
 */
function getAllAssetsFromDb(loadDataFn) {
  try {
    return loadDataFn();
  } catch (err) {
    logger.error({ err }, 'Failed to load assets from database');
    return {};
  }
}

/**
 * Run a single consistency check across all assets.
 * Returns a summary report of all checks.
 * When `chainReader` is supplied (see createChainReader() in consistency.js),
 * each data.json record is also compared against the contract's on-chain
 * state and any drift is reported as an `onchain_drift` issue.
 * @param {object} context — { loadDataFn, cacheFn?, chainReader? }
 * @returns {object} summary report
 */
export async function runConsistencyCheck(context = {}) {
  const { loadDataFn, cacheFn = cacheGet, chainReader = null } = context;

  if (!loadDataFn) {
    logger.error('runConsistencyCheck called without loadDataFn context');
    return { error: 'No loadDataFn provided' };
  }

  const startTime = Date.now();
  const dbAssets = getAllAssetsFromDb(loadDataFn);
  const reports = [];

  logger.info({ assetCount: Object.keys(dbAssets).length }, 'Starting consistency check');

  // Check each asset
  for (const [contractId, dbAsset] of Object.entries(dbAssets)) {
    try {
      const cachedAsset = await cacheFn(`rwa:${contractId}`);
      const report = generateConsistencyReport(contractId, {
        cachedAsset,
        dbAsset,
        includeData: false,
      });

      if (chainReader) {
        const onChainState = await chainReader(contractId);
        const driftIssues = compareWithOnChainState(contractId, dbAsset, onChainState);
        if (driftIssues.length > 0) {
          report.issues.push(...driftIssues);
          report.recommendations.push(
            'Action: Re-sync data.json from on-chain state (the contract is authoritative)'
          );
          report.hasIssues = true;
          report.issueCount = report.issues.length;
          report.consistency.dbBlockchainMatch = false;
          report.consistency.allMatch = false;
        }
      }

      reports.push(report);

      // Auto-repair if enabled and issues found
      if (AUTO_REPAIR && report.hasIssues) {
        const repairResult = await executeReconciliation(report, {
          cachedAsset,
          dbAsset,
        });
        report.reconciliation = repairResult;
      }
    } catch (err) {
      logger.error({ contractId, err }, 'Error during consistency check for asset');
      reports.push({
        contractId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Generate summary
  const summary = generateSummaryReport(reports);
  summary.checkDurationMs = Date.now() - startTime;
  summary.autoRepairEnabled = AUTO_REPAIR;

  logger.info(
    {
      totalContracts: summary.totalContracts,
      inconsistent: summary.inconsistentContracts,
      criticalIssues: summary.issueBySeverity.critical,
      durationMs: summary.checkDurationMs,
    },
    'Consistency check complete'
  );

  // Write log if enabled
  await writeCheckLog({
    summary,
    reports,
  });

  return {
    summary,
    reports,
  };
}

/**
 * Initialize the consistency check scheduler.
 * Starts a periodic timer that runs checks on the configured interval.
 * @param {object} context — { loadDataFn, cacheFn? }
 */
export function initScheduler(context = {}) {
  if (!ENABLED) {
    logger.info('Consistency check scheduler disabled (CONSISTENCY_CHECK_ENABLED not set)');
    return;
  }

  if (!context.loadDataFn) {
    logger.error('Cannot initialize scheduler without loadDataFn context');
    return;
  }

  logger.info(
    { intervalMinutes: INTERVAL_MINUTES, autoRepair: AUTO_REPAIR },
    'Initializing consistency check scheduler'
  );

  // Run first check immediately (after a small delay to ensure app is ready)
  setTimeout(() => {
    runConsistencyCheck(context).catch(err => {
      logger.error({ err }, 'Initial consistency check failed');
    });
  }, 2000);

  // Schedule periodic checks
  const intervalMs = INTERVAL_MINUTES * 60 * 1000;
  schedulerIntervalId = setInterval(async () => {
    try {
      await runConsistencyCheck(context);
    } catch (err) {
      logger.error({ err }, 'Periodic consistency check failed');
    }
  }, intervalMs);

  logger.info(`Consistency check scheduled every ${INTERVAL_MINUTES} minutes`);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler() {
  if (schedulerIntervalId !== null) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    logger.info('Consistency check scheduler stopped');
  }
}

/**
 * Get current scheduler status.
 */
export function getSchedulerStatus() {
  return {
    enabled: ENABLED,
    running: schedulerIntervalId !== null,
    intervalMinutes: INTERVAL_MINUTES,
    autoRepairEnabled: AUTO_REPAIR,
    loggingEnabled: LOG_DIR !== null,
    logDirectory: LOG_DIR,
  };
}
