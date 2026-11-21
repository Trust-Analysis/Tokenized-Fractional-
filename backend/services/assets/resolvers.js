// Assets Service - Federated Resolvers
// This file contains the resolver functions for the Assets service

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gql } from 'graphql-tag';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the schema
const schemaPath = join(__dirname, 'schema.graphql');
const typeDefs = gql(readFileSync(schemaPath, 'utf-8'));

// Mock data layer - in production, this would connect to a database
const dataLayer = {
  assets: new Map(),
  
  loadData() {
    return Object.fromEntries(this.assets);
  },
  
  saveData(data) {
    this.assets = new Map(Object.entries(data));
  },
  
  validateContractId(contractId) {
    return typeof contractId === 'string' && contractId.startsWith('C') && contractId.length >= 56;
  },
  
  validateRwaBody(input) {
    if (!input.title || input.title.trim().length === 0) return 'Title is required';
    if (!input.location || input.location.trim().length === 0) return 'Location is required';
    if (!input.description || input.description.trim().length === 0) return 'Description is required';
    if (!input.assetType) return 'Asset type is required';
    if (input.totalShares && input.totalShares <= 0) return 'Total shares must be positive';
    if (input.pricePerShare && input.pricePerShare <= 0) return 'Price per share must be positive';
    if (input.availableShares && input.availableShares < 0) return 'Available shares cannot be negative';
    return null;
  },
  
  scoreSearch(query, data) {
    const searchTerms = query.toLowerCase();
    return Object.entries(data)
      .map(([contractId, asset]) => {
        let score = 0;
        const title = asset.title.toLowerCase();
        const location = asset.location.toLowerCase();
        const description = asset.description.toLowerCase();
        
        if (title.includes(searchTerms)) score += 10;
        if (location.includes(searchTerms)) score += 5;
        if (description.includes(searchTerms)) score += 3;
        
        return { contractId, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }
};

// Initialize with sample data
const initializeSampleData = () => {
  const sampleAssets = {
    'C1234567890123456789012345678901234567890123456789012345678': {
      title: 'Manhattan Commercial Tower',
      location: 'New York, NY',
      description: 'Prime commercial real estate in Manhattan with high tenant occupancy',
      assetType: 'COMMERCIAL_REAL_ESTATE',
      totalShares: 1000,
      pricePerShare: 10000000,
      availableShares: 750,
      paused: false,
      pending: false,
      documents: [
        { name: 'deed.pdf', hash: 'QmXxx...', mimeType: 'application/pdf', uploadedAt: '2024-01-15T10:00:00Z' }
      ],
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z'
    },
    'C2345678901234567890123456789012345678901234567890123456789': {
      title: 'California Agricultural Land',
      location: 'California, USA',
      description: 'Fertile agricultural land with water rights',
      assetType: 'AGRICULTURAL',
      totalShares: 500,
      pricePerShare: 5000000,
      availableShares: 500,
      paused: false,
      pending: false,
      documents: [],
      createdAt: '2024-02-01T10:00:00Z',
      updatedAt: '2024-02-01T10:00:00Z'
    }
  };
  
  Object.entries(sampleAssets).forEach(([contractId, data]) => {
    dataLayer.assets.set(contractId, data);
  });
};

initializeSampleData();

// Resolvers
export const resolvers = {
  Asset: {
    // Reference resolver for User entity
    owner: async (asset, _args, context) => {
      // This would normally call the Users service via REST or GraphQL
      // For now, return a placeholder
      return {
        __typename: 'User',
        userId: asset.ownerId || 'U_DEFAULT',
        walletAddress: asset.ownerWallet || 'GD_DEFAULT'
      };
    },
    
    // Reference resolver for Transaction entity
    transactions: async (asset, _args, context) => {
      // This would normally call the Transactions service
      return [];
    }
  },
  
  Query: {
    assets: (_parent, args) => {
      const { filter, limit = 50, offset = 0 } = args;
      const allAssets = Array.from(dataLayer.assets.entries()).map(([contractId, data]) => ({
        contractId,
        ...data,
        isPaused: data.paused || false,
        assetType: data.assetType
      }));

      let filtered = allAssets;

      if (filter?.search) {
        const searchTerms = filter.search.toLowerCase();
        filtered = filtered.filter(asset =>
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

      if (filter?.isPaused !== undefined) {
        filtered = filtered.filter(asset => asset.isPaused === filter.isPaused);
      }

      return filtered.slice(offset, offset + limit);
    },

    asset: (_parent, args) => {
      const { contractId } = args;
      const asset = dataLayer.assets.get(contractId);
      if (!asset) return null;

      return {
        contractId,
        ...asset,
        isPaused: asset.paused || false,
        assetType: asset.assetType
      };
    },

    assetsCount: () => {
      return dataLayer.assets.size;
    },

    searchAssets: (_parent, args) => {
      const { query, limit = 20 } = args;
      const data = Object.fromEntries(dataLayer.assets);
      
      const scored = dataLayer.scoreSearch(query, data);
      const results = scored
        .slice(0, limit)
        .map(({ contractId }) => {
          const asset = data[contractId];
          return {
            contractId,
            ...asset,
            isPaused: asset.paused || false,
            assetType: asset.assetType
          };
        });

      return results;
    },

    pendingAssets: (_parent, _args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can view pending assets');
      }
      return Array.from(dataLayer.assets.entries())
        .filter(([, asset]) => asset.pending === true)
        .map(([contractId, asset]) => ({
          contractId,
          ...asset,
          isPaused: asset.paused || false,
          assetType: asset.assetType
        }));
    },

    assetStatistics: () => {
      const assets = Array.from(dataLayer.assets.values());
      const pendingCount = assets.filter(a => a.pending === true).length;
      const totalShares = assets.reduce((sum, a) => sum + (a.availableShares || 0), 0);
      const avgPrice = assets.length > 0
        ? assets.reduce((sum, a) => sum + (a.pricePerShare || 0), 0) / assets.length
        : 0;

      const assetsByType = {};
      assets.forEach(asset => {
        const type = asset.assetType || 'OTHER';
        assetsByType[type] = (assetsByType[type] || 0) + 1;
      });

      return {
        totalAssets: assets.length,
        pendingAssets: pendingCount,
        totalSharesAvailable: totalShares,
        averagePricePerShare: avgPrice,
        assetsByType: Object.entries(assetsByType).map(([assetType, count]) => ({
          assetType,
          count
        }))
      };
    }
  },

  Mutation: {
    createAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can create assets');
      }

      const { input } = args;
      const error = dataLayer.validateRwaBody(input);
      if (error) throw new Error(error);

      const contractId = `C${Math.random().toString(36).substring(2, 56)}`;
      const now = new Date().toISOString();

      const newAsset = {
        ...input,
        contractId,
        createdAt: now,
        updatedAt: now,
        pending: true,
        paused: false,
        documents: []
      };

      dataLayer.assets.set(contractId, newAsset);

      return {
        contractId,
        ...newAsset,
        isPaused: false,
        assetType: input.assetType
      };
    },

    updateAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can update assets');
      }

      const { contractId, input } = args;
      if (!dataLayer.validateContractId(contractId)) {
        throw new Error('Invalid contract ID');
      }

      const existing = dataLayer.assets.get(contractId);
      if (!existing) throw new Error('Asset not found');

      const error = dataLayer.validateRwaBody(input);
      if (error) throw new Error(error);

      const updated = {
        ...existing,
        ...input,
        updatedAt: new Date().toISOString(),
      };

      dataLayer.assets.set(contractId, updated);

      return {
        contractId,
        ...updated,
        isPaused: updated.paused || false,
        assetType: input.assetType || existing.assetType
      };
    },

    deleteAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can delete assets');
      }

      const { contractId } = args;
      if (!dataLayer.validateContractId(contractId)) {
        throw new Error('Invalid contract ID');
      }

      if (!dataLayer.assets.has(contractId)) throw new Error('Asset not found');

      dataLayer.assets.delete(contractId);
      return true;
    },

    approveAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can approve assets');
      }

      const { contractId } = args;
      if (!dataLayer.validateContractId(contractId)) {
        throw new Error('Invalid contract ID');
      }

      const asset = dataLayer.assets.get(contractId);
      if (!asset) throw new Error('Asset not found');

      asset.pending = false;
      asset.updatedAt = new Date().toISOString();
      dataLayer.assets.set(contractId, asset);

      return {
        contractId,
        ...asset,
        isPaused: asset.paused || false,
        assetType: asset.assetType
      };
    },

    pauseAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can pause assets');
      }

      const { contractId } = args;
      if (!dataLayer.validateContractId(contractId)) {
        throw new Error('Invalid contract ID');
      }

      const asset = dataLayer.assets.get(contractId);
      if (!asset) throw new Error('Asset not found');

      asset.paused = true;
      asset.updatedAt = new Date().toISOString();
      dataLayer.assets.set(contractId, asset);

      return {
        contractId,
        ...asset,
        isPaused: true,
        assetType: asset.assetType
      };
    },

    unpauseAsset: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can unpause assets');
      }

      const { contractId } = args;
      if (!dataLayer.validateContractId(contractId)) {
        throw new Error('Invalid contract ID');
      }

      const asset = dataLayer.assets.get(contractId);
      if (!asset) throw new Error('Asset not found');

      asset.paused = false;
      asset.updatedAt = new Date().toISOString();
      dataLayer.assets.set(contractId, asset);

      return {
        contractId,
        ...asset,
        isPaused: false,
        assetType: asset.assetType
      };
    }
  }
};

export { typeDefs };
