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
import { createAssetsSubgraph, typeDefs as assetsTypeDefs } from './subgraphs/assets/schema.js';
import { createUsersSubgraph, typeDefs as usersTypeDefs } from './subgraphs/users/schema.js';
import {
  createTransactionsSubgraph,
  typeDefs as transactionsTypeDefs,
} from './subgraphs/transactions/schema.js';
import { federationMetricsMiddleware } from './metrics.js';
import { complexityValidationRule } from '../../graphql/complexity.js';

/**
 * Complexity limits are enforced BOTH at the gateway (the public entry point)
 * and at each individual subgraph server (defense-in-depth, Issue #884) via
 * the shared rule in `backend/graphql/complexity.js`.
 */
export function createSubgraphServer(subgraphSchema, { name, complexityLimits } = {}) {
  return new ApolloServer({
    schema: subgraphSchema,
    validationRules: [complexityValidationRule(complexityLimits)],
    includeStacktraceInErrorResponses: process.env.NODE_ENV !== 'production',
  });
}

export async function createFederatedGraphQLServer({
  dataLayer,
  transactionService,
  logger,
  complexityLimits,
} = {}) {
  // Build individual subgraph schemas
  const assetsSchema = createAssetsSubgraph(dataLayer);
  const usersSchema = createUsersSubgraph(transactionService);
  const transactionsSchema = createTransactionsSubgraph(transactionService);

  // Map subgraphs locally (zero network overhead, in-process composition).
  // `localServiceList` entries must carry the raw typeDefs (what the composer
  // needs); `buildService` hands each subgraph's *built* schema (with its
  // resolvers, including `__resolveReference`) to a LocalGraphQLDataSource.
  const localSchemas = {
    assets: assetsSchema,
    users: usersSchema,
    transactions: transactionsSchema,
  };

  const gateway = new ApolloGateway({
    localServiceList: [
      { name: 'assets', typeDefs: assetsTypeDefs },
      { name: 'users', typeDefs: usersTypeDefs },
      { name: 'transactions', typeDefs: transactionsTypeDefs },
    ],
    buildService: ({ name }) => new LocalGraphQLDataSource(localSchemas[name]),
  });

  const server = new ApolloServer({
    gateway,
    // Reject expensive/deeply-nested queries before they are planned or
    // fanned out to the subgraphs (Issue #884).
    validationRules: [complexityValidationRule(complexityLimits)],
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
