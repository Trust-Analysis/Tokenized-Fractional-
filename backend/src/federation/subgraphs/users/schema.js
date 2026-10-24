// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/subgraphs/users/schema.js
 *
 * Users Subgraph Service for GraphQL Federation v2.
 *
 * Exposes the `User` entity as `@key(fields: "walletAddress")`.
 * References `RWA` from Assets subgraph via `@external`.
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
  User representation in the marketplace
  """
  type User @key(fields: "walletAddress") {
    walletAddress: String!
    kycStatus: String
    tier: String
    holdings: [UserHolding!]!
  }

  type UserHolding {
    contractId: String!
    asset: RWA
    sharesOwned: Int!
    purchasedAt: String
  }

  """
  Reference to RWA entity defined in Assets subgraph
  """
  type RWA @key(fields: "contractId", extendable: true) {
    contractId: String! @external
  }

  type Query {
    user(walletAddress: String!): User
    userShareHoldings(walletAddress: String!): [UserHolding!]!
  }
`);

export function createUsersSubgraph(transactionService) {
  const resolvers = {
    User: {
      __resolveReference(representation) {
        const { walletAddress } = representation;
        const cached = entityCache.get('User', walletAddress);
        if (cached) return cached;

        const resolved = {
          walletAddress,
          kycStatus: 'APPROVED',
          tier: 'STANDARD',
        };

        entityCache.set('User', walletAddress, resolved);
        return resolved;
      },

      holdings(user) {
        if (!transactionService) return [];
        const txs = transactionService.getTransactionsByUser
          ? transactionService.getTransactionsByUser(user.walletAddress)
          : [];

        // Aggregate holdings by contractId
        const holdingsMap = new Map();
        for (const tx of txs) {
          if (tx.status === 'COMPLETED' || tx.status === 'SUCCESS') {
            const current = holdingsMap.get(tx.contractId) || {
              contractId: tx.contractId,
              sharesOwned: 0,
              purchasedAt: tx.createdAt || tx.timestamp,
            };
            current.sharesOwned += tx.shareCount || tx.shares || 0;
            holdingsMap.set(tx.contractId, current);
          }
        }

        return Array.from(holdingsMap.values()).map(h => ({
          ...h,
          asset: { __typename: 'RWA', contractId: h.contractId },
        }));
      },
    },

    UserHolding: {
      asset(holding) {
        return { __typename: 'RWA', contractId: holding.contractId };
      },
    },

    Query: {
      user: (_parent, args) => {
        const { walletAddress } = args;
        const cached = entityCache.get('User', walletAddress);
        if (cached) return cached;

        const resolved = {
          walletAddress,
          kycStatus: 'APPROVED',
          tier: 'STANDARD',
        };

        entityCache.set('User', walletAddress, resolved);
        return resolved;
      },

      userShareHoldings: (_parent, args) => {
        if (!transactionService) return [];
        const txs = transactionService.getTransactionsByUser
          ? transactionService.getTransactionsByUser(args.walletAddress)
          : [];

        const holdingsMap = new Map();
        for (const tx of txs) {
          if (tx.status === 'COMPLETED' || tx.status === 'SUCCESS') {
            const current = holdingsMap.get(tx.contractId) || {
              contractId: tx.contractId,
              sharesOwned: 0,
              purchasedAt: tx.createdAt || tx.timestamp,
            };
            current.sharesOwned += tx.shareCount || tx.shares || 0;
            holdingsMap.set(tx.contractId, current);
          }
        }

        return Array.from(holdingsMap.values()).map(h => ({
          ...h,
          asset: { __typename: 'RWA', contractId: h.contractId },
        }));
      },
    },
  };

  return buildSubgraphSchema({ typeDefs, resolvers });
}
