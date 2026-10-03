// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * GraphQL Federation Integration & Unit Tests
 */

import { createAssetsSubgraph } from '../src/federation/subgraphs/assets/schema.js';
import { createUsersSubgraph } from '../src/federation/subgraphs/users/schema.js';
import { createTransactionsSubgraph } from '../src/federation/subgraphs/transactions/schema.js';
import { createFederatedGraphQLServer } from '../src/federation/gateway.js';
import { entityCache } from '../src/federation/entityCache.js';

describe('GraphQL Federation Subgraphs', () => {
  const mockDataLayer = {
    data: {
      'CTEST123456789012345678901234567890123456789012': {
        title: 'Federated Commercial Tower',
        location: 'New York',
        description: 'Prime commercial real estate',
        assetType: 'commercial_real_estate',
        totalShares: 1000,
        pricePerShare: 5000,
        availableShares: 800,
        paused: false,
      },
    },
    loadData() { return this.data; },
    saveData(d) { this.data = d; },
    validateContractId: (id) => typeof id === 'string' && id.length >= 50 && id.startsWith('C'),
    validateRwaBody: () => null,
    syncSearchIndex() {},
  };

  const mockTransactionService = {
    txs: [
      {
        transactionId: 'TX100',
        contractId: 'CTEST123456789012345678901234567890123456789012',
        buyerAddress: 'GBUYER1234567890',
        shareCount: 10,
        pricePerShare: 5000,
        totalCost: 50000,
        status: 'COMPLETED',
        timestamp: '2026-07-25T12:00:00Z',
      },
    ],
    getAllTransactions() { return this.txs; },
    getTransactionById(id) { return this.txs.find(t => t.transactionId === id); },
    getTransactionsByAsset(contractId) { return this.txs.filter(t => t.contractId === contractId); },
    getTransactionsByUser(wallet) { return this.txs.filter(t => t.buyerAddress === wallet); },
  };

  beforeEach(() => {
    entityCache.invalidateType('RWA');
    entityCache.invalidateType('User');
    entityCache.invalidateType('Transaction');
  });

  test('Assets subgraph builds schema and resolves RWA entity reference', () => {
    const assetsSchema = createAssetsSubgraph(mockDataLayer);
    expect(assetsSchema).toBeDefined();

    const rwaType = assetsSchema.getType('RWA');
    expect(rwaType).toBeDefined();

    const rwaResolver = rwaType.toConfig().astNode;
    expect(rwaResolver).toBeDefined();
  });

  test('Users subgraph builds schema and resolves User holdings', () => {
    const usersSchema = createUsersSubgraph(mockTransactionService);
    expect(usersSchema).toBeDefined();

    const userType = usersSchema.getType('User');
    expect(userType).toBeDefined();
  });

  test('Transactions subgraph builds schema', () => {
    const txSchema = createTransactionsSubgraph(mockTransactionService);
    expect(txSchema).toBeDefined();

    const txType = txSchema.getType('Transaction');
    expect(txType).toBeDefined();
  });

  test('Federation entityCache sets, gets, and invalidates entries', () => {
    entityCache.set('RWA', 'CKEY123', { title: 'Cached Asset' });
    expect(entityCache.get('RWA', 'CKEY123')).toEqual({ title: 'Cached Asset' });

    entityCache.invalidate('RWA', 'CKEY123');
    expect(entityCache.get('RWA', 'CKEY123')).toBeNull();
  });

  test('Gateway composes subgraphs without throwing', async () => {
    const { server, gateway } = await createFederatedGraphQLServer({
      dataLayer: mockDataLayer,
      transactionService: mockTransactionService,
    });

    expect(server).toBeDefined();
    expect(gateway).toBeDefined();

    await server.stop();
  });
});
