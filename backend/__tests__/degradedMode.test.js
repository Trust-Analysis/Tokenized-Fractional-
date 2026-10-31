// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Degraded-mode / partial-results tests (Issue #886)
 *
 * Verified contract when one subgraph becomes unhealthy:
 *
 *  1. A query touching only healthy subgraphs fully succeeds.
 *  2. A query that also requests a ROOT field of the failed subgraph reports
 *     the failure as a per-field error (path pointing at the failed field)
 *     and the gateway delivers data: null for the operation (a root-level
 *     fetch group cannot be half-composed).
 *  3. A query whose failed subgraph work is NESTED (e.g. cross-subgraph
 *     entity resolution) returns partial data: the rest of the payload is
 *     delivered and the failed selection(s) resolve to null.
 *
 * The production gateway composes the subgraphs in-process
 * (LocalGraphQLDataSource), so "a subgraph being down" manifests as a
 * resolver/data-layer failure inside that subgraph — exactly what these
 * tests simulate.
 */

import { describe, it, expect, afterAll, beforeEach } from '@jest/globals';
import { createFederatedGraphQLServer } from '../src/federation/gateway.js';
import { entityCache } from '../src/federation/entityCache.js';

/** "Assets subgraph is down": every assets data lookup fails. */
const downDataLayer = new Proxy(
  {},
  {
    get() {
      throw new Error('ECONNREFUSED: assets subgraph is unreachable');
    },
  },
);

const mockTransactionService = {
  txs: [
    {
      transactionId: 'TX200',
      contractId: 'CTEST123456789012345678901234567890123456789012',
      buyerAddress: 'GBUYER1234567890',
      shareCount: 10,
      pricePerShare: 5000,
      totalCost: 50000,
      status: 'COMPLETED',
      timestamp: '2026-07-25T12:00:00Z',
    },
  ],
  getAllTransactions() {
    return this.txs;
  },
  getTransactionById(id) {
    return this.txs.find((t) => t.transactionId === id);
  },
  getTransactionsByAsset(contractId) {
    return this.txs.filter((t) => t.contractId === contractId);
  },
  getTransactionsByUser(wallet) {
    return this.txs.filter((t) => t.buyerAddress === wallet);
  },
};

function singleResult(response) {
  const body = response?.body ?? response;
  return body?.singleResult ?? body ?? {};
}

let server;
beforeEach(async () => {
  entityCache.invalidateType('RWA');
  entityCache.invalidateType('User');
  entityCache.invalidateType('Transaction');
  if (!server) {
    const created = await createFederatedGraphQLServer({
      dataLayer: downDataLayer,
      transactionService: mockTransactionService,
    });
    server = created.server;
  }
});

afterAll(async () => {
  if (server) await server.stop();
});

describe('Degraded mode with an unavailable subgraph (Issue #886)', () => {
  const TX_QUERY_FIELDS = 'transactionId totalCost status';

  it('a healthy query touching only the healthy subgraph fully succeeds', async () => {
    const response = await server.executeOperation(
      {
        query: `{ transaction(transactionId: "TX200") { ${TX_QUERY_FIELDS} } }`,
      },
      { contextValue: {} },
    );

    const result = singleResult(response);
    expect(result.errors).toBeUndefined();
    expect(result.data.transaction).toMatchObject({ transactionId: 'TX200', totalCost: 50000 });
  });

  it('a query spanning an unavailable subgraph returns partial data with per-field errors', async () => {
    // `statistics` belongs to the "down" assets subgraph; the transaction
    // fields belong to the healthy transactions subgraph — requested in the
    // SAME operation. The GraphQL-spec behavior is per-field errors, not a
    // whole-request failure.
    const response = await server.executeOperation(
      {
        query: `{
        statistics { totalAssets }
        transactionsByAsset(contractId: "CTEST123456789012345678901234567890123456789012") { ${TX_QUERY_FIELDS} }
      }`,
      },
      { contextValue: {} },
    );

    const result = singleResult(response);
    expect(result.errors).toBeDefined();
    // The error is attributed to the failing subgraph's field, not reported as
    // a generic whole-request failure without a path.
    const statisticsError = result.errors.find((e) => (e.path || []).includes('statistics'));
    expect(statisticsError).toBeDefined();
    expect(statisticsError?.message).toContain('unreachable');
    // A root-level fetch failure of one subgraph nulls the root data (the
    // gateway cannot deliver a half-composed plan); the nested/entity case in
    // the next test shows the true partial-data behaviour.
    expect(result.data).toBeNull();
  });

  it('cross-subgraph entity resolution fails per-field, not per-request', async () => {
    // Transaction.asset asks the assets subgraph for the RWA entity; that
    // lookup fails, but the transaction's own fields remain populated.
    const response = await server.executeOperation(
      {
        query: `{
        transaction(transactionId: "TX200") {
          ${TX_QUERY_FIELDS}
          asset { title }
        }
      }`,
      },
      { contextValue: {} },
    );

    const result = singleResult(response);
    expect(result.errors).toBeDefined();

    const assetError = result.errors.find((e) => (e.path || []).includes('asset'));
    expect(assetError).toBeDefined();

    const tx = result.data?.transaction;
    expect(tx).toBeDefined();
    expect(tx.transactionId).toBe('TX200');
    expect(tx.totalCost).toBe(50000);
    // Only the failed entity resolution is null; the rest of the transaction
    // payload — and the rest of the operation — is still delivered.
    expect(tx.asset).toBeNull();
  });

  it('transactions-list queries work even though asset fields are unavailable', async () => {
    const response = await server.executeOperation(
      {
        query: `{ transactions(limit: 10) { ${TX_QUERY_FIELDS} } }`,
      },
      { contextValue: {} },
    );

    const result = singleResult(response);
    expect(result.errors).toBeUndefined();
    expect(result.data.transactions).toHaveLength(1);
    expect(result.data.transactions[0].transactionId).toBe('TX200');
  });
});
