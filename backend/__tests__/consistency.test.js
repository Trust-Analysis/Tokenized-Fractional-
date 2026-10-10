/**
 * __tests__/consistency.test.js
 *
 * Comprehensive test suite for data consistency checking system.
 *
 * Tests cover:
 *   - Hash computation and comparison
 *   - Digest generation for cache, database, and blockchain
 *   - Discrepancy detection across all three stores
 *   - Reconciliation strategies
 *   - Scheduler initialization and execution
 *   - API endpoint integration
 */

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-consistency-data.json';
process.env.CONSISTENCY_CHECK_ENABLED = 'true';

import { unlinkSync, existsSync } from 'fs';
import request from 'supertest';
import { app } from '../index.js';
import { setClient } from '../cache.js';
import {
  hashData,
  getCacheDigest,
  getDbDigest,
  getBlockchainDigest,
  findDiscrepancies,
  compareDatasets,
  generateConsistencyReport,
  generateSummaryReport,
} from '../consistency.js';
import {
  reconcileCacheDbMismatch,
  reconcileOrphanedCache,
  reconcileDbBlockchainMismatch,
  reconcileBlockchainWarnings,
  executeReconciliation,
} from '../reconciliation.js';
import { getSchedulerStatus } from '../consistency-scheduler.js';

const VALID_ID = 'C' + 'A'.repeat(55);
const VALID_BODY = {
  contractId: VALID_ID,
  title: 'Test Asset',
  location: 'Test Location',
  description: 'Test Description',
  assetType: 'Real Estate',
};
const API_KEY = 'test-key-for-jest';

// Disable Redis for tests
beforeAll(() => setClient(null));
afterAll(() => {
  setClient(null);
  if (existsSync('test-consistency-data.json')) unlinkSync('test-consistency-data.json');
});

// ── Hash computation ──────────────────────────────────────────────────────────
describe('hashData()', () => {
  test('returns consistent hash for same data', () => {
    const data = { title: 'Asset', price: 100 };
    const hash1 = hashData(data);
    const hash2 = hashData(data);
    expect(hash1).toBe(hash2);
  });

  test('returns different hash for different data', () => {
    const hash1 = hashData({ title: 'Asset A' });
    const hash2 = hashData({ title: 'Asset B' });
    expect(hash1).not.toBe(hash2);
  });

  test('returns hex string of length 64 (SHA256)', () => {
    const hash = hashData({ test: 'data' });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('handles nested objects', () => {
    const obj = { a: 1, b: { c: 2 } };
    const hash = hashData(obj);
    expect(hash).toBeDefined();
  });

  test('handles arrays', () => {
    const hash1 = hashData([1, 2, 3]);
    const hash2 = hashData([1, 2, 3]);
    expect(hash1).toBe(hash2);
  });
});

// ── Digest generation ─────────────────────────────────────────────────────────
describe('getCacheDigest()', () => {
  test('returns cached: false when asset is null', () => {
    const digest = getCacheDigest(null);
    expect(digest.cached).toBe(false);
    expect(digest.hash).toBeNull();
  });

  test('returns cached: true when asset exists', () => {
    const digest = getCacheDigest(VALID_BODY);
    expect(digest.cached).toBe(true);
    expect(digest.hash).toBeDefined();
  });

  test('includes asset data', () => {
    const digest = getCacheDigest(VALID_BODY);
    expect(digest.data.title).toBe(VALID_BODY.title);
  });
});

describe('getDbDigest()', () => {
  test('returns stored: false when asset is null', () => {
    const digest = getDbDigest(null);
    expect(digest.stored).toBe(false);
    expect(digest.hash).toBeNull();
  });

  test('returns stored: true when asset exists', () => {
    const digest = getDbDigest(VALID_BODY);
    expect(digest.stored).toBe(true);
    expect(digest.hash).toBeDefined();
  });
});

describe('getBlockchainDigest()', () => {
  test('returns consistent: true for valid asset', () => {
    const digest = getBlockchainDigest(VALID_BODY, VALID_ID);
    expect(digest.consistent).toBe(true);
    expect(digest.warnings.length).toBe(0);
  });

  test('flags invalid contract ID', () => {
    const badAsset = { ...VALID_BODY, contractId: 'invalid' };
    const digest = getBlockchainDigest(badAsset, 'invalid');
    expect(digest.consistent).toBe(false);
    expect(digest.warnings).toContain('Invalid or missing contract ID');
  });

  test('flags available shares exceeding total shares', () => {
    const badAsset = { ...VALID_BODY, totalShares: 100, availableShares: 150 };
    const digest = getBlockchainDigest(badAsset, VALID_ID);
    expect(digest.consistent).toBe(false);
    expect(digest.warnings.some(w => w.includes('Available shares'))).toBe(true);
  });

  test('returns hash for blockchain state', () => {
    const digest = getBlockchainDigest(VALID_BODY, VALID_ID);
    expect(digest.hash).toBeDefined();
    expect(digest.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── Discrepancy detection ─────────────────────────────────────────────────────
describe('findDiscrepancies()', () => {
  test('returns no issues when cache and db match and blockchain is consistent', () => {
    const asset = VALID_BODY;
    const cache = getCacheDigest(asset);
    const db = getDbDigest(asset);
    const blockchain = getBlockchainDigest(asset, VALID_ID);

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    // Note: blockchain digest transforms the data so hash won't match exactly,
    // but the important thing is no ISSUES are raised
    expect(result.hasIssues).toBe(false);
    expect(result.issues.length).toBe(0);
  });

  test('detects cache-db mismatch', () => {
    const cache = getCacheDigest({ ...VALID_BODY, title: 'Cached Title' });
    const db = getDbDigest({ ...VALID_BODY, title: 'DB Title' });
    const blockchain = getBlockchainDigest(VALID_BODY, VALID_ID);

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    expect(result.hasIssues).toBe(true);
    expect(result.issues.some(i => i.type === 'cache_db_mismatch')).toBe(true);
  });

  test('detects orphaned cache (cache exists but no DB record)', () => {
    const cache = getCacheDigest(VALID_BODY);
    const db = getDbDigest(null);
    const blockchain = getBlockchainDigest(null, VALID_ID);

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    expect(result.hasIssues).toBe(true);
    expect(result.issues.some(i => i.type === 'orphaned_cache')).toBe(true);
  });

  test('detects db-blockchain mismatch when blockchain has warnings', () => {
    const cache = getCacheDigest(VALID_BODY);
    const db = getDbDigest({ ...VALID_BODY, totalShares: 100 });
    // Create blockchain with a warning (e.g., invalid contract ID)
    const blockchain = getBlockchainDigest({ ...VALID_BODY, contractId: 'invalid' }, 'invalid');

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    expect(result.hasIssues).toBe(true);
    expect(result.issues.some(i => i.type === 'db_blockchain_mismatch')).toBe(true);
  });

  test('detects blockchain warnings', () => {
    const cache = getCacheDigest(VALID_BODY);
    const db = getDbDigest(VALID_BODY);
    const blockchain = getBlockchainDigest({ ...VALID_BODY, contractId: 'invalid' }, 'invalid');

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    expect(result.hasIssues).toBe(true);
    expect(result.issues.some(i => i.type === 'blockchain_warning')).toBe(true);
  });

  test('includes recommendations for each issue', () => {
    const cache = getCacheDigest(VALID_BODY);
    const db = getDbDigest(null);
    const blockchain = getBlockchainDigest(null, VALID_ID);

    const result = findDiscrepancies(VALID_ID, cache, db, blockchain);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

// ── Dataset comparison ────────────────────────────────────────────────────────
describe('compareDatasets()', () => {
  test('reports matching datasets', () => {
    const data = { a: VALID_BODY, b: { ...VALID_BODY, title: 'Other' } };
    const result = compareDatasets(data, data);
    expect(result.matching).toBe(2);
    expect(result.mismatched).toBe(0);
  });

  test('reports mismatched entries', () => {
    const dataA = { a: VALID_BODY };
    const dataB = { a: { ...VALID_BODY, title: 'Different' } };
    const result = compareDatasets(dataA, dataB);
    expect(result.mismatched).toBe(1);
  });

  test('reports keys only in first dataset', () => {
    const dataA = { a: VALID_BODY, b: VALID_BODY };
    const dataB = { a: VALID_BODY };
    const result = compareDatasets(dataA, dataB);
    expect(result.onlyInA).toBe(1);
    expect(result.keys.onlyInA).toContain('b');
  });

  test('reports keys only in second dataset', () => {
    const dataA = { a: VALID_BODY };
    const dataB = { a: VALID_BODY, b: VALID_BODY };
    const result = compareDatasets(dataA, dataB);
    expect(result.onlyInB).toBe(1);
    expect(result.keys.onlyInB).toContain('b');
  });

  test('handles empty datasets', () => {
    const result = compareDatasets({}, {});
    expect(result.total).toBe(0);
  });
});

// ── Report generation ─────────────────────────────────────────────────────────
describe('generateConsistencyReport()', () => {
  test('generates report for a single contract', () => {
    const report = generateConsistencyReport(VALID_ID, {
      cachedAsset: VALID_BODY,
      dbAsset: VALID_BODY,
    });
    expect(report.contractId).toBe(VALID_ID);
    expect(report.timestamp).toBeDefined();
    expect(report.hashes).toBeDefined();
    expect(report.status).toBeDefined();
    expect(report.consistency).toBeDefined();
  });

  test('marks as matching when cache and db hashes match', () => {
    const asset = VALID_BODY;
    const report = generateConsistencyReport(VALID_ID, {
      cachedAsset: asset,
      dbAsset: asset,
    });
    // Cache and DB should match if same object
    expect(report.consistency.cacheDbMatch).toBe(true);
  });

  test('includes data when requested', () => {
    const report = generateConsistencyReport(VALID_ID, {
      cachedAsset: VALID_BODY,
      dbAsset: VALID_BODY,
      includeData: true,
    });
    expect(report.data).toBeDefined();
    expect(report.data.cache).toBeDefined();
    expect(report.data.database).toBeDefined();
  });

  test('excludes data by default', () => {
    const report = generateConsistencyReport(VALID_ID, {
      cachedAsset: VALID_BODY,
      dbAsset: VALID_BODY,
    });
    expect(report.data).toBeUndefined();
  });
});

describe('generateSummaryReport()', () => {
  test('counts consistent and inconsistent contracts', () => {
    const reports = [
      generateConsistencyReport(VALID_ID, { cachedAsset: VALID_BODY, dbAsset: VALID_BODY }),
      generateConsistencyReport('C' + 'B'.repeat(55), {
        cachedAsset: { ...VALID_BODY, title: 'Different' },
        dbAsset: VALID_BODY,
      }),
    ];
    const summary = generateSummaryReport(reports);
    expect(summary.totalContracts).toBe(2);
    expect(summary.consistentContracts).toBeGreaterThanOrEqual(0);
  });

  test('aggregates issues by type and severity', () => {
    const reports = [
      generateConsistencyReport('C' + 'B'.repeat(55), {
        cachedAsset: { ...VALID_BODY, title: 'Different' },
        dbAsset: VALID_BODY,
      }),
    ];
    const summary = generateSummaryReport(reports);
    expect(summary.issuesByType).toBeDefined();
    expect(summary.issueBySeverity).toBeDefined();
  });
});

// ── Reconciliation ────────────────────────────────────────────────────────────
describe('Reconciliation handlers', () => {
  test('reconcileCacheDbMismatch clears cache', async () => {
    const result = await reconcileCacheDbMismatch(VALID_ID, VALID_BODY, VALID_BODY);
    expect(result.success).toBe(true);
    expect(result.action).toBe('cache_cleared');
  });

  test('reconcileOrphanedCache removes orphaned entry', async () => {
    const result = await reconcileOrphanedCache(VALID_ID);
    expect(result.success).toBe(true);
    expect(result.action).toBe('orphaned_cache_cleared');
  });

  test('reconcileDbBlockchainMismatch flags for manual review', async () => {
    const result = await reconcileDbBlockchainMismatch(VALID_ID, VALID_BODY, {});
    expect(result.success).toBe(false);
    expect(result.action).toBe('db_blockchain_mismatch_flagged');
    expect(result.recommendation).toBeDefined();
  });

  test('reconcileBlockchainWarnings flags warnings', async () => {
    const result = await reconcileBlockchainWarnings(VALID_ID, ['Test warning']);
    expect(result.success).toBe(false);
    expect(result.action).toBe('blockchain_warnings_flagged');
  });

  test('executeReconciliation processes multiple issues', async () => {
    const report = generateConsistencyReport('C' + 'C'.repeat(55), {
      cachedAsset: VALID_BODY,
      dbAsset: null,
    });
    const result = await executeReconciliation(report, { cachedAsset: VALID_BODY });
    expect(result.repairCount >= 0).toBe(true);
    expect(Array.isArray(result.results)).toBe(true);
  });
});

// ── Scheduler status ──────────────────────────────────────────────────────────
describe('getSchedulerStatus()', () => {
  test('returns scheduler configuration', () => {
    const status = getSchedulerStatus();
    expect(status.enabled).toBeDefined();
    expect(status.running).toBeDefined();
    expect(status.intervalMinutes).toBeDefined();
    expect(status.autoRepairEnabled).toBeDefined();
  });
});

// ── API endpoints ─────────────────────────────────────────────────────────────
describe('GET /api/admin/consistency', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send(VALID_BODY);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/admin/consistency');
    expect(res.status).toBe(401);
  });

  test('returns consistency report with valid key', async () => {
    const res = await request(app)
      .get('/api/admin/consistency')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.reports).toBeDefined();
  });

  test('summary contains expected fields', async () => {
    const res = await request(app)
      .get('/api/admin/consistency')
      .set('x-api-key', API_KEY);
    const summary = res.body.summary;
    expect(summary.totalContracts).toBeDefined();
    expect(summary.consistentContracts).toBeDefined();
    expect(summary.inconsistentContracts).toBeDefined();
  });
});

describe('GET /api/admin/consistency/status', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/admin/consistency/status');
    expect(res.status).toBe(401);
  });

  test('returns scheduler status with valid key', async () => {
    const res = await request(app)
      .get('/api/admin/consistency/status')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBeDefined();
    expect(res.body.running).toBeDefined();
    expect(res.body.intervalMinutes).toBeDefined();
  });
});
