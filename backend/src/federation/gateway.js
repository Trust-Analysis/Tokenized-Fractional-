// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/gateway.js
 *
 * Apollo Federation Gateway & Subgraph Server factory.
 *
 * Composes the three in-process subgraphs (Assets, Users, Transactions) into
 * a unified GraphQL supergraph schema served at `/graphql`.
 */

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloGateway, LocalGraphQLDataSource } from '@apollo/gateway';
import { createAssetsSubgraph } from './subgraphs/assets/schema.js';
import { createUsersSubgraph } from './subgraphs/users/schema.js';
import { createTransactionsSubgraph } from './subgraphs/transactions/schema.js';
import { federationMetricsMiddleware } from './metrics.js';

export async function createFederatedGraphQLServer({ dataLayer, transactionService, logger }) {
  // Build individual subgraph schemas
  const assetsSchema = createAssetsSubgraph(dataLayer);
  const usersSchema = createUsersSubgraph(transactionService);
  const transactionsSchema = createTransactionsSubgraph(transactionService);

  // Map subgraphs locally (zero network overhead, in-process composition)
  const gateway = new ApolloGateway({
    localServiceList: [
      { name: 'assets', schema: assetsSchema },
      { name: 'users', schema: usersSchema },
      { name: 'transactions', schema: transactionsSchema },
    ],
  });

  const server = new ApolloServer({
    gateway,
    includeStacktraceInErrorResponses: process.env.NODE_ENV !== 'production',
  });

  await server.start();

  const middleware = expressMiddleware(server, {
    context: async ({ req }) => ({
      isAdmin: req.headers['x-admin-key'] || req.isAdmin || false,
      walletAddress: req.walletAddress || req.headers['x-wallet-address'] || null,
      requestId: req.requestId,
    }),
  });

  return {
    server,
    gateway,
    middleware: [federationMetricsMiddleware, middleware],
    subgraphs: {
      assetsSchema,
      usersSchema,
      transactionsSchema,
    },
  };
}
