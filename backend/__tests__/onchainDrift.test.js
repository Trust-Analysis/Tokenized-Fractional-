/**
 * __tests__/onchainDrift.test.js
 *
 * Issue #807: prove the data.json ↔ on-chain reconciliation safeguard actually
 * fires. A fixture data file is seeded with a deliberately wrong
 * availableShares value, the Soroban RPC is mocked to return the correct
 * on-chain value, and the consistency check must detect and report the drift.
 */

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createChainReader, compareWithOnChainState } from '../consistency.js';
import { runConsistencyCheck } from '../consistency-scheduler.js';
import { executeReconciliation } from '../reconciliation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'drifted-data.json');

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
const [DRIFTED_ID, IN_SYNC_ID] = Object.keys(fixture);

// What the contracts actually hold on-chain. The drifted asset has sold 40
// shares that data.json never recorded.
const ON_CHAIN = {
  [DRIFTED_ID]: { get_available_shares: 60, get_total_shares: 100, get_price: 10000000 },
  [IN_SYNC_ID]: { get_available_shares: 20, get_total_shares: 50, get_price: 5000000 },
};

// Mocked Soroban RPC: resolves a simulated read-only contract call.
function createMockRpc(state) {
  const calls = [];
  async function query(contractId, method) {
    calls.push({ contractId, method });
    return state[contractId]?.[method];
  }
  return { query, calls };
}

const loadFixture = () => JSON.parse(readFileSync(FIXTURE, 'utf-8'));
const noCache = async () => null;

describe('data.json vs on-chain drift detection (#807)', () => {
  test('fixture is seeded with the deliberate mismatch', () => {
    expect(fixture[DRIFTED_ID].availableShares).toBe(100);
    expect(ON_CHAIN[DRIFTED_ID].get_available_shares).toBe(60);
  });

  test('chain reader queries every mirrored field through the RPC', async () => {
    const rpc = createMockRpc(ON_CHAIN);
    const state = await createChainReader(rpc.query)(DRIFTED_ID);

    expect(state).toEqual({ availableShares: 60, totalShares: 100, pricePerShare: 10000000 });
    expect(rpc.calls.map(c => c.method).sort()).toEqual(
      ['get_available_shares', 'get_price', 'get_total_shares']
    );
  });

  test('compareWithOnChainState flags only the drifted field', () => {
    const issues = compareWithOnChainState(DRIFTED_ID, fixture[DRIFTED_ID], {
      availableShares: 60,
      totalShares: 100,
      pricePerShare: 10000000,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'onchain_drift',
      severity: 'high',
      details: { contractId: DRIFTED_ID, field: 'availableShares', dbValue: 100, onChainValue: 60 },
    });
  });

  test('runConsistencyCheck reports the drifted asset and clears the in-sync one', async () => {
    const rpc = createMockRpc(ON_CHAIN);
    const { summary, reports } = await runConsistencyCheck({
      loadDataFn: loadFixture,
      cacheFn: noCache,
      chainReader: createChainReader(rpc.query),
    });

    const drifted = reports.find(r => r.contractId === DRIFTED_ID);
    const inSync = reports.find(r => r.contractId === IN_SYNC_ID);

    expect(drifted.hasIssues).toBe(true);
    expect(drifted.consistency.dbBlockchainMatch).toBe(false);
    expect(drifted.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'onchain_drift',
          details: expect.objectContaining({ field: 'availableShares', dbValue: 100, onChainValue: 60 }),
        }),
      ])
    );

    expect(inSync.issues.some(i => i.type === 'onchain_drift')).toBe(false);

    expect(summary.inconsistentContracts).toBeGreaterThanOrEqual(1);
    expect(summary.issuesByType.onchain_drift).toBe(1);
    expect(summary.allIssues.some(i => i.contractId === DRIFTED_ID && i.type === 'onchain_drift')).toBe(true);
  });

  test('without a chain reader the drift goes undetected (the gap this test guards)', async () => {
    const { reports } = await runConsistencyCheck({ loadDataFn: loadFixture, cacheFn: noCache });
    const drifted = reports.find(r => r.contractId === DRIFTED_ID);
    expect(drifted.issues.some(i => i.type === 'onchain_drift')).toBe(false);
  });

  test('reconciliation flags drift for manual review rather than auto-repairing', async () => {
    const rpc = createMockRpc(ON_CHAIN);
    const { reports } = await runConsistencyCheck({
      loadDataFn: loadFixture,
      cacheFn: noCache,
      chainReader: createChainReader(rpc.query),
    });
    const drifted = reports.find(r => r.contractId === DRIFTED_ID);

    const result = await executeReconciliation(drifted, { dbAsset: fixture[DRIFTED_ID] });
    const driftResult = result.results.find(r => r.action === 'db_blockchain_mismatch_flagged');

    expect(driftResult).toBeDefined();
    expect(driftResult.success).toBe(false);
    expect(result.results.some(r => r.action === 'unknown_issue_type')).toBe(false);
  });
});
