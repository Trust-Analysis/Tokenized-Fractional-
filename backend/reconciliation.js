/**
 * backend/reconciliation.js
 *
 * Automated reconciliation strategies for data consistency issues.
 *
 * Provides handlers for common discrepancy types:
 *   - Cache vs Database: clear stale cache
 *   - Cache vs Blockchain: trust database, invalidate cache
 *   - Database vs Blockchain: flag for manual review (chain is immutable)
 *
 * Each repair operation returns a result indicating success/failure and
 * any side effects.
 */

import { logger } from './index.js';
import { cacheDel } from './cache.js';

/**
 * Repair strategy for cache-database mismatches.
 *
 * Cache should be ephemeral. If cache and database differ, invalidate cache
 * so the next read pulls fresh data from the database.
 *
 * @param {string} contractId
 * @param {object} cacheData
 * @param {object} dbData
 * @returns {object} { success: bool, action: string, details: any }
 */
export async function reconcileCacheDbMismatch(contractId, cacheData, dbData) {
  try {
    const cacheKey = `rwa:${contractId}`;
    await cacheDel(cacheKey);
    logger.info({ contractId, cacheKey }, 'Cleared stale cache entry during reconciliation');
    return {
      success: true,
      action: 'cache_cleared',
      details: {
        contractId,
        cacheKeyCleared: cacheKey,
        reason: 'Cache contained stale data; cleared to force re-load from database',
      },
    };
  } catch (err) {
    logger.error({ contractId, err }, 'Failed to clear cache during reconciliation');
    return {
      success: false,
      action: 'cache_clear_failed',
      error: err.message,
    };
  }
}

/**
 * Repair strategy for orphaned cache entries.
 *
 * If data exists in cache but not in database, the database record was
 * deleted. Invalidate the orphaned cache entry.
 *
 * @param {string} contractId
 * @returns {object} { success: bool, action: string, details: any }
 */
export async function reconcileOrphanedCache(contractId) {
  try {
    const cacheKey = `rwa:${contractId}`;
    await cacheDel(cacheKey);
    logger.info({ contractId, cacheKey }, 'Cleared orphaned cache entry (no corresponding database record)');
    return {
      success: true,
      action: 'orphaned_cache_cleared',
      details: {
        contractId,
        cacheKeyCleared: cacheKey,
        reason: 'Database record was deleted; cache entry is now stale',
      },
    };
  } catch (err) {
    logger.error({ contractId, err }, 'Failed to clear orphaned cache');
    return {
      success: false,
      action: 'orphaned_cache_clear_failed',
      error: err.message,
    };
  }
}

/**
 * Repair strategy for database-blockchain mismatches.
 *
 * These require caution because the blockchain is immutable.
 * This handler logs the issue and recommends manual action.
 * In a production system, you would:
 *   1. Verify the blockchain state via independent RPC query
 *   2. Check for stuck/incomplete transactions
 *   3. Contact the blockchain node operator if state is corrupted
 *   4. Re-sync the database if needed (operator decision)
 *
 * @param {string} contractId
 * @param {object} dbData
 * @param {object} blockchainData
 * @returns {object} { success: bool, action: string, recommendation: string }
 */
export async function reconcileDbBlockchainMismatch(contractId, dbData, blockchainData) {
  logger.warn(
    { contractId, dbData, blockchainData },
    'Database and blockchain state differ; requires manual investigation'
  );

  return {
    success: false, // Not actionable automatically
    action: 'db_blockchain_mismatch_flagged',
    recommendation: [
      'This issue requires manual intervention by an operator.',
      'Steps to investigate:',
      '1. Verify blockchain state independently via Soroban RPC',
      '2. Check recent transactions and event logs',
      '3. Look for incomplete transactions or network issues',
      '4. If blockchain state is correct, re-sync database from chain',
      '5. If database state is correct, investigate contract code for bugs',
    ].join('\n'),
    details: {
      contractId,
      dbHash: JSON.stringify(dbData),
      blockchainHash: JSON.stringify(blockchainData),
    },
  };
}

/**
 * Repair strategy for blockchain warnings (internal contract state issues).
 *
 * These are flagged during blockchain digest but generally indicate
 * data corruption or contract logic bugs that require developer review.
 *
 * @param {string} contractId
 * @param {array<string>} warnings — warning messages
 * @returns {object} { success: bool, action: string, recommendation: string }
 */
export async function reconcileBlockchainWarnings(contractId, warnings = []) {
  logger.error(
    { contractId, warnings },
    'Blockchain state contains warnings indicating potential data corruption'
  );

  return {
    success: false, // Requires developer action
    action: 'blockchain_warnings_flagged',
    recommendation: [
      'Blockchain state has internal inconsistencies:',
      ...warnings.map(w => `  • ${w}`),
      '',
      'Next steps:',
      '1. Contact the smart contract developer',
      '2. Review contract state and event logs',
      '3. Determine if contract pause/emergency withdraw is needed',
      '4. Plan code fix and contract upgrade if available',
    ].join('\n'),
    details: {
      contractId,
      warnings,
    },
  };
}

/**
 * Repair strategy for missing blockchain data (contract not deployed or initialized).
 *
 * If contract ID is not on chain, either:
 *   1. Contract has not been deployed yet
 *   2. Contract was on a different network
 *   3. Contract ID in database is invalid
 *
 * @param {string} contractId
 * @param {object} dbAsset — the asset metadata that references this contract
 * @returns {object} { success: bool, action: string, recommendation: string }
 */
export async function reconcileMissingBlockchainContract(contractId, dbAsset = {}) {
  logger.warn(
    { contractId },
    'Contract not found on blockchain; may not be deployed or on wrong network'
  );

  return {
    success: false,
    action: 'missing_blockchain_contract_flagged',
    recommendation: [
      `Contract ${contractId} not found on blockchain.`,
      'Possible causes:',
      '1. Contract has not been deployed yet (expected for pre-launch)',
      '2. Contract was deployed on a different network',
      '3. Contract ID in database is incorrect',
      '',
      'Actions:',
      '1. Verify the contract ID is correct: ' + contractId,
      '2. Verify you are connected to the correct network (check VITE_RPC_URL)',
      '3. If contract should exist, deploy it with: soroban contract deploy ...',
      '4. If contract ID is wrong, update the database record',
    ].join('\n'),
    details: {
      contractId,
      dbAsset: { title: dbAsset.title, assetType: dbAsset.assetType },
    },
  };
}

/**
 * Execute all applicable repair strategies for a consistency report.
 *
 * Iterates through the report's issues and applies the corresponding
 * reconciliation handler. Collects results and logs all actions.
 *
 * @param {object} report — from generateConsistencyReport()
 * @param {object} data — { cachedAsset?, dbAsset? }
 * @returns {object} { repairCount, results: array<object> }
 */
export async function executeReconciliation(report, data = {}) {
  const results = [];

  if (!report.issues || report.issues.length === 0) {
    return { repairCount: 0, results: [] };
  }

  for (const issue of report.issues) {
    let repairResult = null;

    switch (issue.type) {
      case 'cache_db_mismatch':
        repairResult = await reconcileCacheDbMismatch(
          report.contractId,
          data.cachedAsset,
          data.dbAsset
        );
        break;

      case 'orphaned_cache':
        repairResult = await reconcileOrphanedCache(report.contractId);
        break;

      case 'db_blockchain_mismatch':
        repairResult = await reconcileDbBlockchainMismatch(
          report.contractId,
          data.dbAsset,
          issue.details.blockchainData
        );
        break;

      case 'onchain_drift':
        repairResult = await reconcileDbBlockchainMismatch(
          report.contractId,
          data.dbAsset,
          { [issue.details.field]: issue.details.onChainValue }
        );
        break;

      case 'blockchain_warning':
        repairResult = await reconcileBlockchainWarnings(report.contractId, [issue.message]);
        break;

      case 'missing_everywhere':
        // This is too severe to auto-repair; needs manual intervention
        logger.error({ contractId: report.contractId }, 'Critical: Contract missing from all stores');
        repairResult = {
          success: false,
          action: 'missing_everywhere_flagged',
          recommendation: 'Restore from backup or re-create metadata. Requires manual action.',
        };
        break;

      default:
        logger.warn({ issueType: issue.type }, 'Unknown issue type; cannot auto-repair');
        repairResult = {
          success: false,
          action: 'unknown_issue_type',
          error: `Unknown issue type: ${issue.type}`,
        };
    }

    if (repairResult) {
      results.push(repairResult);
    }
  }

  logger.info(
    { contractId: report.contractId, repairCount: results.length },
    'Reconciliation complete'
  );

  return {
    repairCount: results.filter(r => r.success).length,
    results,
  };
}
