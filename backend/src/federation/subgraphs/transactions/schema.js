// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/subgraphs/transactions/schema.js
 *
 * Transactions Subgraph Service for GraphQL Federation v2.
 *
 * Exposes `Transaction` entity as `@key(fields: "transactionId")`.
 * References `RWA` and `User` entities via `@external`.
 */

import { parse } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { entityCache } from '../../entityCache.js';

export const typeDefs = parse(`#graphql
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@external", "@requires", "@provides", "@shareable"]
    )

  """
  Transaction representation in the marketplace
  """
  type Transaction @key(fields: "transactionId") {
    transactionId: String!
    contractId: String!
    buyerAddress: String!
    shareCount: Int!
    pricePerShare: Int!
    totalCost: Int!
    status: String!
    txHash: String
    timestamp: String!
    asset: RWA
    buyer: User
  }

  """
  Reference to RWA entity defined in Assets subgraph
  """
  type RWA @key(fields: "contractId", extendable: true) {
    contractId: String! @external
  }

  """
  Reference to User entity defined in Users subgraph
  """
  type User @key(fields: "walletAddress", extendable: true) {
    walletAddress: String! @external
  }

  type Query {
    transactions(limit: Int, offset: Int): [Transaction!]!
    transaction(transactionId: String!): Transaction
    transactionsByAsset(contractId: String!, limit: Int): [Transaction!]!
    transactionsByUser(walletAddress: String!, limit: Int): [Transaction!]!
  }
`);

export function createTransactionsSubgraph(transactionService) {
  const resolvers = {
    Transaction: {
      __resolveReference(representation) {
        const { transactionId } = representation;
        const cached = entityCache.get('Transaction', transactionId);
        if (cached) return cached;

        if (!transactionService) return null;
        const tx = transactionService.getTransactionById
          ? transactionService.getTransactionById(transactionId)
          : null;
        if (!tx) return null;

        const resolved = {
          transactionId: tx.transactionId || tx.id,
          contractId: tx.contractId,
          buyerAddress: tx.buyerAddress || tx.buyer,
          shareCount: tx.shareCount || tx.shares || 0,
          pricePerShare: tx.pricePerShare || 0,
          totalCost: tx.totalCost || 0,
          status: tx.status || 'COMPLETED',
          txHash: tx.txHash || tx.hash,
          timestamp: tx.timestamp || tx.createdAt || new Date().toISOString(),
        };

        entityCache.set('Transaction', transactionId, resolved);
        return resolved;
      },

      asset(tx) {
        return { __typename: 'RWA', contractId: tx.contractId };
      },

      buyer(tx) {
        return { __typename: 'User', walletAddress: tx.buyerAddress };
      },
    },

    Query: {
      transactions: (_parent, args) => {
        if (!transactionService) return [];
        const { limit = 50, offset = 0 } = args;
        const allTxs = transactionService.getAllTransactions
          ? transactionService.getAllTransactions()
          : [];

        return allTxs.slice(offset, offset + limit).map(tx => ({
          transactionId: tx.transactionId || tx.id,
          contractId: tx.contractId,
          buyerAddress: tx.buyerAddress || tx.buyer,
          shareCount: tx.shareCount || tx.shares || 0,
          pricePerShare: tx.pricePerShare || 0,
          totalCost: tx.totalCost || 0,
          status: tx.status || 'COMPLETED',
          txHash: tx.txHash || tx.hash,
          timestamp: tx.timestamp || tx.createdAt || new Date().toISOString(),
        }));
      },

      transaction: (_parent, args) => {
        if (!transactionService) return null;
        const { transactionId } = args;
        const cached = entityCache.get('Transaction', transactionId);
        if (cached) return cached;

        const tx = transactionService.getTransactionById
          ? transactionService.getTransactionById(transactionId)
          : null;
        if (!tx) return null;

        const result = {
          transactionId: tx.transactionId || tx.id,
          contractId: tx.contractId,
          buyerAddress: tx.buyerAddress || tx.buyer,
          shareCount: tx.shareCount || tx.shares || 0,
          pricePerShare: tx.pricePerShare || 0,
          totalCost: tx.totalCost || 0,
          status: tx.status || 'COMPLETED',
          txHash: tx.txHash || tx.hash,
          timestamp: tx.timestamp || tx.createdAt || new Date().toISOString(),
        };

        entityCache.set('Transaction', transactionId, result);
        return result;
      },

      transactionsByAsset: (_parent, args) => {
        if (!transactionService) return [];
        const { contractId, limit = 50 } = args;
        const txs = transactionService.getTransactionsByAsset
          ? transactionService.getTransactionsByAsset(contractId)
          : [];

        return txs.slice(0, limit).map(tx => ({
          transactionId: tx.transactionId || tx.id,
          contractId: tx.contractId,
          buyerAddress: tx.buyerAddress || tx.buyer,
          shareCount: tx.shareCount || tx.shares || 0,
          pricePerShare: tx.pricePerShare || 0,
          totalCost: tx.totalCost || 0,
          status: tx.status || 'COMPLETED',
          txHash: tx.txHash || tx.hash,
          timestamp: tx.timestamp || tx.createdAt || new Date().toISOString(),
        }));
      },

      transactionsByUser: (_parent, args) => {
        if (!transactionService) return [];
        const { walletAddress, limit = 50 } = args;
        const txs = transactionService.getTransactionsByUser
          ? transactionService.getTransactionsByUser(walletAddress)
          : [];

        return txs.slice(0, limit).map(tx => ({
          transactionId: tx.transactionId || tx.id,
          contractId: tx.contractId,
          buyerAddress: tx.buyerAddress || tx.buyer,
          shareCount: tx.shareCount || tx.shares || 0,
          pricePerShare: tx.pricePerShare || 0,
          totalCost: tx.totalCost || 0,
          status: tx.status || 'COMPLETED',
          txHash: tx.txHash || tx.hash,
          timestamp: tx.timestamp || tx.createdAt || new Date().toISOString(),
        }));
      },
    },
  };

  return buildSubgraphSchema({ typeDefs, resolvers });
}
