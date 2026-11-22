/**
 * backend/consistency.js
 *
 * Core data consistency checking logic.
 *
 * Compares state across three data stores:
 *   1. Cache (Redis) — in-memory temporary storage
 *   2. Database (data.json) — persistent source of truth for asset metadata
 *   3. Blockchain (Soroban contract) — immutable ledger of transactions and state
 *
 * For each RWA asset contract, computes a digest of each store's data and
 * identifies discrepancies, then recommends and applies repair strategies.
 */

import crypto from 'crypto';

/**
 * Hash data for comparison. Uses SHA256 to create a stable fingerprint.
 * @param {any} data — the data to hash
 * @returns {string} hex-encoded SHA256 hash
 */
export function hashData(data) {
  const json = JSON.stringify(data, null, 0);
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Compute a digest of cache state for a single contract.
 * @param {any} cachedAsset — the asset data from cache (or null if not cached)
 * @returns {object} { cached: <bool>, hash: <string|null>, data: <any> }
 */
export function getCacheDigest(cachedAsset) {
  return {
    cached: cachedAsset !== null && cachedAsset !== undefined,
    hash: cachedAsset ? hashData(cachedAsset) : null,
    data: cachedAsset || {},
  };
}

/**
 * Compute a digest of database state for a single contract.
 * @param {any} dbAsset — the asset data from data.json (or null if not present)
 * @returns {object} { stored: <bool>, hash: <string|null>, data: <any> }
 */
export function getDbDigest(dbAsset) {
  return {
    stored: dbAsset !== null && dbAsset !== undefined,
    hash: dbAsset ? hashData(dbAsset) : null,
    data: dbAsset || {},
  };
}

/**
 * Compute a digest of blockchain state for a single contract.
 *
 * Note: In a real production system, you would:
 *   1. Query the Soroban RPC endpoint (VITE_RPC_URL)
 *   2. Fetch the contract state (admin, price, available shares, etc.)
 *   3. Compare against local metadata
 *
 * For this implementation, we simulate blockchain state from database
 * and flag when it diverges (e.g., if a transaction is on chain but
 * not reflected locally).
 *
 * @param {object} dbAsset — database asset record
 * @param {string} contractId — the contract ID (for logging)
 * @returns {object} { consistent: <bool>, hash: <string|null>, data: <any>, warnings: <array> }
 */
export function getBlockchainDigest(dbAsset, contractId) {
  const warnings = [];

  // Simulate blockchain state by using the database as the source of truth
  // In production, this would call Soroban RPC to fetch actual on-chain state
  const blockchainState = {
    contractId,
    totalShares: dbAsset?.totalShares || 0,
    availableShares: dbAsset?.availableShares || dbAsset?.totalShares || 0,
    pricePerShare: dbAsset?.pricePerShare || 0,
    metadata: {
      title: dbAsset?.title || '',
      description: dbAsset?.description || '',
      location: dbAsset?.location || '',
      assetType: dbAsset?.assetType || '',
    },
    // In a real system, these would come from on-chain state queries
    admin: dbAsset?.admin || 'unknown',
    paused: dbAsset?.paused === true,
  };

  // Check for common issues
  if (!dbAsset?.contractId || !dbAsset?.contractId.startsWith('C')) {
    warnings.push('Invalid or missing contract ID');
  }

  if (dbAsset?.totalShares && dbAsset?.availableShares > dbAsset?.totalShares) {
    warnings.push('Available shares exceeds total shares (data corruption)');
  }

  const hash = hashData(blockchainState);
  return {
    consistent: warnings.length === 0,
    hash,
    data: blockchainState,
    warnings,
  };
}

/**
 * data.json fields that mirror on-chain contract state, mapped to the
 * read-only contract function that returns the authoritative value.
 */
export const ON_CHAIN_FIELDS = {
  availableShares: 'get_available_shares',
  totalShares: 'get_total_shares',
  pricePerShare: 'get_price',
};

/**
 * Build a chain reader from a low-level RPC query function.
 *
 * `queryFn(contractId, method)` must resolve to the decoded return value of a
 * simulated (read-only) contract call, e.g. via Soroban RPC
 * `simulateTransaction`. Keeping the RPC transport behind this function lets
 * tests substitute a mocked RPC response without a network.
 *
 * @param {function} queryFn — async (contractId, method) => value
 * @returns {function} async (contractId) => { availableShares, totalShares, pricePerShare }
 */
export function createChainReader(queryFn) {
  return async function readChainState(contractId) {
    const state = {};
    for (const [field, method] of Object.entries(ON_CHAIN_FIELDS)) {
      const value = await queryFn(contractId, method);
      state[field] = value === undefined || value === null ? null : Number(value);
    }
    return state;
  };
}

/**
 * Compare a data.json record against state read from the contract.
 *
 * Only fields that are present on both sides are compared, so a record that
 * never stored e.g. `pricePerShare` does not raise a false positive.
 *
 * @param {string} contractId
 * @param {object} dbAsset — the data.json record
 * @param {object} onChainState — from a chain reader
 * @returns {array<object>} `onchain_drift` issues, one per mismatched field
 */
export function compareWithOnChainState(contractId, dbAsset, onChainState) {
  if (!dbAsset || !onChainState) return [];

  const issues = [];
  for (const field of Object.keys(ON_CHAIN_FIELDS)) {
    const dbValue = dbAsset[field];
    const chainValue = onChainState[field];
    if (dbValue === undefined || dbValue === null || chainValue === null || chainValue === undefined) {
      continue;
    }
    if (Number(dbValue) !== Number(chainValue)) {
      issues.push({
        type: 'onchain_drift',
        severity: 'high',
        message: `data.json ${field} (${dbValue}) does not match on-chain value (${chainValue})`,
        details: {
          contractId,
          field,
          dbValue: Number(dbValue),
          onChainValue: Number(chainValue),
        },
      });
    }
  }
  return issues;
}

/**
 * Identify discrepancies between three data sources.
 * @param {string} contractId
 * @param {object} cacheDigest — from getCacheDigest()
 * @param {object} dbDigest — from getDbDigest()
 * @param {object} blockchainDigest — from getBlockchainDigest()
 * @returns {object} with discrepancies, severity, and recommendations
 */
export function findDiscrepancies(contractId, cacheDigest, dbDigest, blockchainDigest) {
  const issues = [];
  const recommendations = [];

  // ── Issue: Missing from blockchain ──────────────────────────────────────────
  if (!blockchainDigest.consistent) {
    blockchainDigest.warnings.forEach(w => {
      issues.push({
        type: 'blockchain_warning',
        severity: 'medium',
        message: w,
        details: { contractId },
      });
      recommendations.push('Investigate blockchain state; may require contract admin action');
    });
  }

  // ── Issue: Cache vs Database mismatch ────────────────────────────────────────
  if (cacheDigest.cached && dbDigest.stored) {
    if (cacheDigest.hash !== dbDigest.hash) {
      issues.push({
        type: 'cache_db_mismatch',
        severity: 'low',
        message: 'Cache and database have different content',
        details: {
          contractId,
          cacheHash: cacheDigest.hash,
          dbHash: dbDigest.hash,
          cacheData: cacheDigest.data,
          dbData: dbDigest.data,
        },
      });
      recommendations.push('Action: Clear cache to force re-load from database (fix: cacheDel(rwa:${contractId}))');
    }
  }

  // ── Issue: Cache exists but no database record ──────────────────────────────
  if (cacheDigest.cached && !dbDigest.stored) {
    issues.push({
      type: 'orphaned_cache',
      severity: 'medium',
      message: 'Data in cache but not in database (stale cache entry)',
      details: {
        contractId,
        cacheData: cacheDigest.data,
      },
    });
    recommendations.push('Action: Clear orphaned cache entry (fix: cacheDel(rwa:${contractId}))');
  }

  // ── Issue: Database differs from blockchain ──────────────────────────────────
  // Note: blockchain state is transformed/derived from database, so it's normal
  // for the hashes to differ. We only flag this as an issue if blockchain has
  // detected internal inconsistencies (warnings).
  if (dbDigest.stored && blockchainDigest.warnings.length > 0) {
    issues.push({
      type: 'db_blockchain_mismatch',
      severity: 'high',
      message: 'Database and blockchain state differ (possible sync issue)',
      details: {
        contractId,
        dbData: dbDigest.data,
        blockchainData: blockchainDigest.data,
        dbHash: dbDigest.hash,
        blockchainHash: blockchainDigest.hash,
        blockchainWarnings: blockchainDigest.warnings,
      },
    });
    recommendations.push('Action: Validate blockchain state and re-sync database if needed');
    recommendations.push('Action: Check for stuck transactions or incomplete synchronization');
  }

  // ── Issue: Missing from all stores ──────────────────────────────────────────
  if (!cacheDigest.cached && !dbDigest.stored && blockchainDigest.hash === null) {
    issues.push({
      type: 'missing_everywhere',
      severity: 'critical',
      message: 'Contract metadata missing from all stores',
      details: { contractId },
    });
    recommendations.push('Action: Restore metadata from backup or re-create asset metadata');
  }

  return {
    contractId,
    hasIssues: issues.length > 0,
    issueCount: issues.length,
    issues,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compare two datasets and return statistics about the comparison.
 * @param {object} dataA — first dataset
 * @param {object} dataB — second dataset
 * @returns {object} comparison stats: { total, matching, mismatched, onlyInA, onlyInB }
 */
export function compareDatasets(dataA = {}, dataB = {}) {
  const keysA = Object.keys(dataA);
  const keysB = Object.keys(dataB);
  const allKeys = new Set([...keysA, ...keysB]);

  let matching = 0;
  let mismatched = 0;
  const onlyInA = [];
  const onlyInB = [];

  allKeys.forEach(key => {
    if (!(key in dataA)) {
      onlyInB.push(key);
    } else if (!(key in dataB)) {
      onlyInA.push(key);
    } else {
      const hashA = hashData(dataA[key]);
      const hashB = hashData(dataB[key]);
      if (hashA === hashB) {
        matching += 1;
      } else {
        mismatched += 1;
      }
    }
  });

  return {
    total: allKeys.size,
    matching,
    mismatched,
    onlyInA: onlyInA.length,
    onlyInB: onlyInB.length,
    keys: {
      onlyInA,
      onlyInB,
    },
  };
}

/**
 * Generate a consistency report for a single contract.
 * @param {string} contractId
 * @param {object} options — { cachedAsset?, dbAsset?, includeData? }
 * @returns {object} detailed report with digests and discrepancies
 */
export function generateConsistencyReport(contractId, options = {}) {
  const { cachedAsset = null, dbAsset = null, includeData = false } = options;

  const cacheDigest = getCacheDigest(cachedAsset);
  const dbDigest = getDbDigest(dbAsset);
  const blockchainDigest = getBlockchainDigest(dbAsset, contractId);

  const discrepancies = findDiscrepancies(contractId, cacheDigest, dbDigest, blockchainDigest);

  const report = {
    contractId,
    timestamp: new Date().toISOString(),
    hashes: {
      cache: cacheDigest.hash,
      database: dbDigest.hash,
      blockchain: blockchainDigest.hash,
    },
    status: {
      cacheValid: cacheDigest.cached && cacheDigest.hash !== null,
      databaseValid: dbDigest.stored && dbDigest.hash !== null,
      blockchainValid: blockchainDigest.consistent,
    },
    consistency: {
      cacheDbMatch: cacheDigest.hash === dbDigest.hash || !cacheDigest.cached,
      dbBlockchainMatch: dbDigest.hash === blockchainDigest.hash,
      allMatch: cacheDigest.hash === dbDigest.hash && dbDigest.hash === blockchainDigest.hash,
    },
    ...discrepancies,
  };

  // Include raw data if requested (for debugging)
  if (includeData) {
    report.data = {
      cache: cacheDigest.data,
      database: dbDigest.data,
      blockchain: blockchainDigest.data,
    };
  }

  return report;
}

/**
 * Generate a summary report for multiple contracts.
 * @param {array<object>} reports — individual contract reports from generateConsistencyReport()
 * @returns {object} aggregated summary
 */
export function generateSummaryReport(reports = []) {
  const summary = {
    timestamp: new Date().toISOString(),
    totalContracts: reports.length,
    consistentContracts: 0,
    inconsistentContracts: 0,
    issuesByType: {},
    issueBySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    allIssues: [],
  };

  reports.forEach(report => {
    if (report.hasIssues) {
      summary.inconsistentContracts += 1;
      report.issues.forEach(issue => {
        summary.issueBySeverity[issue.severity]++;
        summary.issuesByType[issue.type] = (summary.issuesByType[issue.type] || 0) + 1;
        summary.allIssues.push({
          contractId: report.contractId,
          ...issue,
        });
      });
    } else {
      summary.consistentContracts += 1;
    }
  });

  return summary;
}
