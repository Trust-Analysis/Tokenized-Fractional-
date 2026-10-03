// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * federation/subgraphs/assets/schema.js
 *
 * Assets Subgraph Service for GraphQL Federation v2.
 *
 * Exposes the `RWA` entity as `@key(fields: "contractId")`.
 * Owns asset metadata, listing status, share counts, documents, and CRUD operations.
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
  Real-World Asset representation
  """
  type RWA @key(fields: "contractId") {
    contractId: String!
    title: String!
    location: String!
    description: String!
    assetType: String!
    totalShares: Int
    pricePerShare: Int
    availableShares: Int
    isPaused: Boolean
    documents: [DocumentHash!]
    createdAt: String
    updatedAt: String
  }

  type DocumentHash {
    name: String!
    hash: String!
    mimeType: String
    uploadedAt: String
  }

  input RWAFilter {
    search: String
    assetType: String
    location: String
  }

  input RWAInput {
    title: String!
    location: String!
    description: String!
    assetType: String!
    totalShares: Int
    pricePerShare: Int
    availableShares: Int
  }

  type Statistics {
    totalAssets: Int!
    pendingAssets: Int!
    totalSharesAvailable: Int!
    averagePricePerShare: Float!
  }

  type Query {
    assets(filter: RWAFilter, limit: Int, offset: Int): [RWA!]!
    assetsCount: Int!
    asset(contractId: String!): RWA
    searchAssets(query: String!, limit: Int): [RWA!]!
    pendingAssets: [RWA!]!
    statistics: Statistics!
  }

  type Mutation {
    createAsset(input: RWAInput!): RWA!
    updateAsset(contractId: String!, input: RWAInput!): RWA!
    deleteAsset(contractId: String!): Boolean!
    approveAsset(contractId: String!): RWA!
    pauseAsset(contractId: String!): RWA!
    unpauseAsset(contractId: String!): RWA!
  }
`);

export function createAssetsSubgraph(dataLayer) {
  const resolvers = {
    RWA: {
      __resolveReference(representation) {
        const { contractId } = representation;
        const cached = entityCache.get('RWA', contractId);
        if (cached) return cached;

        const data = dataLayer ? dataLayer.loadData() : {};
        const asset = data[contractId];
        if (!asset) return null;

        const resolved = {
          contractId,
          ...asset,
          isPaused: asset.paused || false,
          createdAt: asset.createdAt || new Date().toISOString(),
          updatedAt: asset.updatedAt || new Date().toISOString(),
        };

        entityCache.set('RWA', contractId, resolved);
        return resolved;
      },
    },

    Query: {
      assets: (_parent, args) => {
        if (!dataLayer) return [];
        const { filter, limit = 50, offset = 0 } = args;
        const allAssets = Object.entries(dataLayer.loadData()).map(([contractId, data]) => ({
          contractId,
          ...data,
          isPaused: data.paused || false,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        }));

        let filtered = allAssets;
        if (filter?.search) {
          const searchTerms = filter.search.toLowerCase();
          filtered = filtered.filter(
            asset =>
              asset.title.toLowerCase().includes(searchTerms) ||
              asset.location.toLowerCase().includes(searchTerms) ||
              asset.description.toLowerCase().includes(searchTerms)
          );
        }
        if (filter?.assetType) {
          filtered = filtered.filter(asset => asset.assetType === filter.assetType);
        }
        if (filter?.location) {
          filtered = filtered.filter(asset => asset.location === filter.location);
        }

        return filtered.slice(offset, offset + limit);
      },

      assetsCount: () => {
        if (!dataLayer) return 0;
        return Object.keys(dataLayer.loadData()).length;
      },

      asset: (_parent, args) => {
        if (!dataLayer) return null;
        const cached = entityCache.get('RWA', args.contractId);
        if (cached) return cached;

        const data = dataLayer.loadData();
        const asset = data[args.contractId];
        if (!asset) return null;

        const result = {
          contractId: args.contractId,
          ...asset,
          isPaused: asset.paused || false,
          createdAt: asset.createdAt || new Date().toISOString(),
          updatedAt: asset.updatedAt || new Date().toISOString(),
        };

        entityCache.set('RWA', args.contractId, result);
        return result;
      },

      searchAssets: (_parent, args) => {
        if (!dataLayer) return [];
        const { query, limit = 20 } = args;
        const data = dataLayer.loadData();
        const scored = dataLayer.scoreSearch ? dataLayer.scoreSearch(query, data) : [];

        return scored.slice(0, limit).map(({ contractId }) => ({
          contractId,
          ...data[contractId],
          isPaused: data[contractId]?.paused || false,
          createdAt: data[contractId]?.createdAt || new Date().toISOString(),
          updatedAt: data[contractId]?.updatedAt || new Date().toISOString(),
        }));
      },

      pendingAssets: (_parent, _args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can view pending assets');
        }
        if (!dataLayer) return [];
        const data = dataLayer.loadData();
        return Object.entries(data)
          .filter(([, asset]) => asset.pending === true)
          .map(([contractId, asset]) => ({
            contractId,
            ...asset,
            isPaused: asset.paused || false,
            createdAt: asset.createdAt || new Date().toISOString(),
            updatedAt: asset.updatedAt || new Date().toISOString(),
          }));
      },

      statistics: () => {
        if (!dataLayer) {
          return { totalAssets: 0, pendingAssets: 0, totalSharesAvailable: 0, averagePricePerShare: 0 };
        }
        const data = dataLayer.loadData();
        const assets = Object.values(data);
        const pendingCount = assets.filter(a => a.pending === true).length;
        const totalShares = assets.reduce((sum, a) => sum + (a.availableShares || 0), 0);
        const avgPrice =
          assets.length > 0 ? assets.reduce((sum, a) => sum + (a.pricePerShare || 0), 0) / assets.length : 0;

        return {
          totalAssets: assets.length,
          pendingAssets: pendingCount,
          totalSharesAvailable: totalShares,
          averagePricePerShare: avgPrice,
        };
      },
    },

    Mutation: {
      createAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can create assets');
        }
        const { input } = args;
        if (dataLayer?.validateRwaBody) {
          const error = dataLayer.validateRwaBody(input);
          if (error) throw new Error(error);
        }

        const contractId = `C${Math.random().toString(36).substring(2, 56)}`;
        const now = new Date().toISOString();
        const newAsset = {
          ...input,
          contractId,
          createdAt: now,
          updatedAt: now,
          pending: true,
        };

        if (dataLayer) {
          const data = dataLayer.loadData();
          data[contractId] = newAsset;
          dataLayer.saveData(data);
          if (dataLayer.syncSearchIndex) dataLayer.syncSearchIndex();
        }

        entityCache.invalidate('RWA', contractId);
        return { contractId, ...newAsset, isPaused: false };
      },

      updateAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can update assets');
        }
        const { contractId, input } = args;
        if (dataLayer?.validateContractId && !dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer ? dataLayer.loadData() : {};
        const existing = data[contractId];
        if (!existing) throw new Error('Asset not found');

        if (dataLayer?.validateRwaBody) {
          const error = dataLayer.validateRwaBody(input);
          if (error) throw new Error(error);
        }

        const updated = {
          ...existing,
          ...input,
          updatedAt: new Date().toISOString(),
        };

        data[contractId] = updated;
        if (dataLayer) {
          dataLayer.saveData(data);
          if (dataLayer.syncSearchIndex) dataLayer.syncSearchIndex();
        }

        entityCache.invalidate('RWA', contractId);
        return { contractId, ...updated, isPaused: updated.paused || false };
      },

      deleteAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can delete assets');
        }
        const { contractId } = args;
        if (dataLayer?.validateContractId && !dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer ? dataLayer.loadData() : {};
        if (!data[contractId]) throw new Error('Asset not found');

        delete data[contractId];
        if (dataLayer) {
          dataLayer.saveData(data);
          if (dataLayer.syncSearchIndex) dataLayer.syncSearchIndex();
        }

        entityCache.invalidate('RWA', contractId);
        return true;
      },

      approveAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can approve assets');
        }
        const { contractId } = args;
        const data = dataLayer ? dataLayer.loadData() : {};
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.pending = false;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        if (dataLayer) dataLayer.saveData(data);

        entityCache.invalidate('RWA', contractId);
        return { contractId, ...asset, isPaused: asset.paused || false };
      },

      pauseAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can pause assets');
        }
        const { contractId } = args;
        const data = dataLayer ? dataLayer.loadData() : {};
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.paused = true;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        if (dataLayer) dataLayer.saveData(data);

        entityCache.invalidate('RWA', contractId);
        return { contractId, ...asset, isPaused: true };
      },

      unpauseAsset: (_parent, args, context) => {
        if (!context?.isAdmin) {
          throw new Error('Unauthorized: Only admins can unpause assets');
        }
        const { contractId } = args;
        const data = dataLayer ? dataLayer.loadData() : {};
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.paused = false;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        if (dataLayer) dataLayer.saveData(data);

        entityCache.invalidate('RWA', contractId);
        return { contractId, ...asset, isPaused: false };
      },
    },
  };

  return buildSubgraphSchema({ typeDefs, resolvers });
}
