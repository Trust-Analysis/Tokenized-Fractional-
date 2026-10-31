// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * GraphQL Query Complexity Enforcement tests (Issue #884)
 *
 * Confirms a deliberately expensive/deeply-nested query is rejected the same
 * way whether it targets:
 *   - the federated gateway, or
 *   - any individual subgraph server directly (defense-in-depth against a
 *     misconfigured deployment that exposes a subgraph endpoint).
 */

import { describe, it, expect, afterAll } from '@jest/globals';
import { createAssetsSubgraph } from '../src/federation/subgraphs/assets/schema.js';
import { createUsersSubgraph } from '../src/federation/subgraphs/users/schema.js';
import { createTransactionsSubgraph } from '../src/federation/subgraphs/transactions/schema.js';
import { createFederatedGraphQLServer, createSubgraphServer } from '../src/federation/gateway.js';
import { entityCache } from '../src/federation/entityCache.js';

const mockDataLayer = {
  data: {
    CTEST123456789012345678901234567890123456789012: {
      title: 'Complexity Test Tower',
      location: 'New York',
      description: 'Prime commercial real estate',
      assetType: 'commercial_real_estate',
      totalShares: 1000,
      pricePerShare: 5000,
      availableShares: 800,
      paused: false,
    },
  },
  loadData() {
    return this.data;
  },
  saveData() {},
  validateContractId: (id) => typeof id === 'string' && id.length >= 50 && id.startsWith('C'),
  validateRwaBody: () => null,
  syncSearchIndex() {},
  scoreSearch() {
    return [{ contractId: 'CTEST123456789012345678901234567890123456789012' }];
  },
};

const CONTRACT_ID = 'CTEST123456789012345678901234567890123456789012';

const mockTransactionService = {
  txs: [
    {
      transactionId: 'TX100',
      contractId: CONTRACT_ID,
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

/** Flatten the various @apollo/server executeOperation response shapes. */
function singleResult(response) {
  const body = response?.body ?? response;
  return body?.singleResult ?? body ?? {};
}

// Aliased-field flood: 60 fields in one operation (default max: 50).
const fieldFloodQuery = (topField) =>
  `{ ${Array.from({ length: 60 }, (_, i) => `f${i}: ${topField}`).join(' ')} }`;
// List-field multiplication: each `assets` alias costs 3 (base) and each
// nested `title` costs 0.5 * 20 (title sits inside a list context of 20),
// for ~13 per alias. Eight aliases (~104) blow the default maxComplexity of
// 100 while staying under the 50-field cap.
const complexityScoreQuery = `{ ${Array.from({ length: 8 }, (_, i) => `q${i}: assets(limit: 1) { title }`).join(' ')} }`;

const servers = [];
async function startGateway() {
  const { server } = await createFederatedGraphQLServer({
    dataLayer: mockDataLayer,
    transactionService: mockTransactionService,
  });
  servers.push(server);
  return server;
}

function startSubgraphServers() {
  const cases = [
    {
      name: 'assets',
      server: createSubgraphServer(createAssetsSubgraph(mockDataLayer), { name: 'assets' }),
      floodField: 'statistics { totalAssets }',
    },
    {
      name: 'users',
      server: createSubgraphServer(createUsersSubgraph(mockTransactionService), { name: 'users' }),
      floodField: 'userShareHoldings(walletAddress: "GBUYER1234567890") { contractId }',
    },
    {
      name: 'transactions',
      server: createSubgraphServer(createTransactionsSubgraph(mockTransactionService), {
        name: 'transactions',
      }),
      floodField: 'transactions(limit: 1) { transactionId }',
    },
  ];
  servers.push(...cases.map((c) => c.server));
  return cases;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop()));
});

describe('GraphQL complexity enforcement (Issue #884)', () => {
  beforeEach(() => {
    entityCache.invalidateType('RWA');
    entityCache.invalidateType('Transaction');
    entityCache.invalidateType('User');
  });

  it('gateway rejects a query exceeding the field-count limit', async () => {
    const server = await startGateway();

    const response = await server.executeOperation({
      query: fieldFloodQuery('statistics { totalAssets }'),
    });

    const result = singleResult(response);
    const messages = (result.errors || []).map((e) => e.message).join(' ');
    expect(messages).toContain('fields (max');
    // The expensive operation is rejected before it is planned/executed.
    expect(result.data).toBeUndefined();
  });

  it('gateway rejects a query exceeding the complexity-score limit', async () => {
    const server = await startGateway();

    const response = await server.executeOperation({ query: complexityScoreQuery });

    const result = singleResult(response);
    const messages = (result.errors || []).map((e) => e.message).join(' ');
    expect(messages).toMatch(/complexity score .* exceeds maximum/);
    expect(result.data).toBeUndefined();
  });

  it('gateway still serves a normal query alongside the rule', async () => {
    const server = await startGateway();

    const response = await server.executeOperation({
      query: `query { transaction(transactionId: "TX100") { transactionId } }`,
    });
    const result = singleResult(response);
    expect(result.errors).toBeUndefined();
    expect(result.data?.transaction?.transactionId).toBe('TX100');
  });

  it('each subgraph server enforces the same limits (defense-in-depth)', async () => {
    const cases = startSubgraphServers();
    for (const { name, server, floodField } of cases) {
      const response = await server.executeOperation({ query: fieldFloodQuery(floodField) });
      const result = singleResult(response);
      const messages = (result.errors || []).map((e) => e.message).join(' ');
      expect(messages).toContain('fields (max');
      expect(result.data).toBeUndefined();
    }
  });
});
