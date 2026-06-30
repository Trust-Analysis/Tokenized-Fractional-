/**
 * GraphQL Schema and Resolvers for RWA Marketplace
 * 
 * Provides full CRUD access to real-world assets with queries and mutations.
 * Includes real-time subscriptions for marketplace events.
 * Integrates with the existing REST API data layer.
 */

import { gql } from 'graphql-tag';
import { pubsub, SUBSCRIPTION_EVENTS } from './pubsub.js';

/**
 * GraphQL Type Definitions
 */
export const typeDefs = gql`
  # Real-World Asset representation
  type RWA {
    # Unique contract identifier on Stellar network
    contractId: String!
    
    # Asset title/name
    title: String!
    
    # Geographic location
    location: String!
    
    # Detailed description
    description: String!
    
    # Asset classification (commercial_real_estate, residential, etc.)
    assetType: String!
    
    # Total number of fractional shares issued
    totalShares: Int
    
    # Price per share in stroops
    pricePerShare: Int
    
    # Currently available shares for purchase
    availableShares: Int
    
    # Whether marketplace is paused for this asset
    isPaused: Boolean
    
    # Document hashes stored on IPFS
    documents: [DocumentHash!]
    
    # Metadata timestamps
    createdAt: String
    updatedAt: String
  }

  # IPFS document reference
  type DocumentHash {
    # File name or identifier
    name: String!
    
    # IPFS content hash
    hash: String!
    
    # MIME type
    mimeType: String
    
    # Upload timestamp
    uploadedAt: String
  }

  # Asset search filter input
  input RWAFilter {
    # Search by title, location, or description
    search: String
    
    # Filter by asset type
    assetType: String
    
    # Filter by location
    location: String
  }

  # Asset creation/update input
  input RWAInput {
    title: String!
    location: String!
    description: String!
    assetType: String!
    totalShares: Int
    pricePerShare: Int
    availableShares: Int
  }

  # Root Query type
  type Query {
    # Retrieve all assets with optional filtering
    assets(filter: RWAFilter, limit: Int, offset: Int): [RWA!]!
    
    # Get asset count
    assetsCount: Int!
    
    # Retrieve single asset by contract ID
    asset(contractId: String!): RWA
    
    # Search assets by full-text search
    searchAssets(query: String!, limit: Int): [RWA!]!
    
    # Get pending (unpublished) assets
    pendingAssets: [RWA!]!
    
    # Get asset statistics
    statistics: Statistics!
  }

  # Asset statistics
  type Statistics {
    # Total number of assets
    totalAssets: Int!
    
    # Number of pending assets
    pendingAssets: Int!
    
    # Total shares available across all assets
    totalSharesAvailable: Int!
    
    # Average price per share
    averagePricePerShare: Float!
  }

  # Root Mutation type
  type Mutation {
    # Create new asset
    createAsset(input: RWAInput!): RWA!
    
    # Update existing asset
    updateAsset(contractId: String!, input: RWAInput!): RWA!
    
    # Delete asset
    deleteAsset(contractId: String!): Boolean!
    
    # Approve pending asset for publication
    approveAsset(contractId: String!): RWA!
    
    # Pause asset trading
    pauseAsset(contractId: String!): RWA!
    
    # Unpause asset trading
    unpauseAsset(contractId: String!): RWA!
  }

  # Real-time subscription event
  type SubscriptionEvent {
    # Event type
    event: String!
    
    # Event timestamp
    timestamp: String!
    
    # Event payload data
    data: String!
  }

  # Share purchase event
  type SharePurchasedEvent {
    # The asset being purchased
    contractId: String!
    
    # Buyer address
    buyer: String!
    
    # Number of shares purchased
    shareCount: Int!
    
    # Purchase price
    totalPrice: Int!
    
    # Remaining available shares
    remainingShares: Int!
    
    # Transaction timestamp
    timestamp: String!
  }

  # Price update event
  type PriceUpdatedEvent {
    # The asset with updated price
    contractId: String!
    
    # New price per share
    newPrice: Int!
    
    # Old price per share
    oldPrice: Int!
    
    # Update timestamp
    timestamp: String!
  }

  # Asset availability change event
  type AvailabilityChangedEvent {
    # The asset with changed availability
    contractId: String!
    
    # New available share count
    availableShares: Int!
    
    # Previous available share count
    previousAvailable: Int!
    
    # Change timestamp
    timestamp: String!
  }

  # Asset marketplace status change event
  type MarketplaceStatusEvent {
    # The affected asset
    contractId: String!
    
    # Is the marketplace paused
    isPaused: Boolean!
    
    # Status change reason
    reason: String
    
    # Change timestamp
    timestamp: String!
  }

  # Transaction completion event
  type TransactionCompletedEvent {
    # Transaction identifier
    transactionId: String!
    
    # Affected asset
    contractId: String!
    
    # Transaction type
    type: String!
    
    # Transaction status
    status: String!
    
    # Transaction metadata
    metadata: String
    
    # Completion timestamp
    timestamp: String!
  }

  # Root Subscription type
  type Subscription {
    # Subscribe to share purchase events
    onSharePurchased(contractId: String): SharePurchasedEvent!
    
    # Subscribe to price updates
    onPriceUpdated(contractId: String): PriceUpdatedEvent!
    
    # Subscribe to asset listing events
    onAssetListed: RWA!
    
    # Subscribe to asset update events
    onAssetUpdated(contractId: String): RWA!
    
    # Subscribe to availability changes
    onAvailabilityChanged(contractId: String): AvailabilityChangedEvent!
    
    # Subscribe to marketplace paused events
    onMarketplacePaused: MarketplaceStatusEvent!
    
    # Subscribe to marketplace unpaused events
    onMarketplaceUnpaused: MarketplaceStatusEvent!
    
    # Subscribe to transaction completion events
    onTransactionCompleted(contractId: String): TransactionCompletedEvent!
  }
`;

/**
 * GraphQL Resolvers
 * 
 * Data access layer that bridges GraphQL to the existing REST API backend.
 * All data operations go through the same validation and storage layer.
 */
export function createResolvers(dataLayer) {
  return {
    Query: {
      /**
       * Get all assets with optional filtering and pagination
       */
      assets: (_parent, args) => {
        const { filter, limit = 50, offset = 0 } = args;
        const allAssets = Object.entries(dataLayer.loadData()).map(([contractId, data]) => ({
          contractId,
          ...data,
          isPaused: data.paused || false,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        }));

        let filtered = allAssets;

        // Apply search filter
        if (filter?.search) {
          const searchTerms = filter.search.toLowerCase();
          filtered = filtered.filter(asset =>
            asset.title.toLowerCase().includes(searchTerms) ||
            asset.location.toLowerCase().includes(searchTerms) ||
            asset.description.toLowerCase().includes(searchTerms)
          );
        }

        // Apply asset type filter
        if (filter?.assetType) {
          filtered = filtered.filter(asset => asset.assetType === filter.assetType);
        }

        // Apply location filter
        if (filter?.location) {
          filtered = filtered.filter(asset => asset.location === filter.location);
        }

        // Apply pagination
        return filtered.slice(offset, offset + limit);
      },

      /**
       * Get total count of assets
       */
      assetsCount: () => {
        return Object.keys(dataLayer.loadData()).length;
      },

      /**
       * Get single asset by contract ID
       */
      asset: (_parent, args) => {
        const data = dataLayer.loadData();
        const asset = data[args.contractId];
        if (!asset) return null;

        return {
          contractId: args.contractId,
          ...asset,
          isPaused: asset.paused || false,
          createdAt: asset.createdAt || new Date().toISOString(),
          updatedAt: asset.updatedAt || new Date().toISOString(),
        };
      },

      /**
       * Full-text search across assets
       */
      searchAssets: (_parent, args) => {
        const { query, limit = 20 } = args;
        const data = dataLayer.loadData();
        
        // Use the built-in search scoring
        const scored = dataLayer.scoreSearch(query, data);
        const results = scored
          .slice(0, limit)
          .map(({ contractId }) => ({
            contractId,
            ...data[contractId],
            isPaused: data[contractId].paused || false,
            createdAt: data[contractId].createdAt || new Date().toISOString(),
            updatedAt: data[contractId].updatedAt || new Date().toISOString(),
          }));

        return results;
      },

      /**
       * Get pending (unpublished) assets
       */
      pendingAssets: (_parent, _args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can view pending assets');
        }
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

      /**
       * Get marketplace statistics
       */
      statistics: () => {
        const data = dataLayer.loadData();
        const assets = Object.values(data);
        const pendingCount = assets.filter(a => a.pending === true).length;
        const totalShares = assets.reduce((sum, a) => sum + (a.availableShares || 0), 0);
        const avgPrice = assets.length > 0
          ? assets.reduce((sum, a) => sum + (a.pricePerShare || 0), 0) / assets.length
          : 0;

        return {
          totalAssets: assets.length,
          pendingAssets: pendingCount,
          totalSharesAvailable: totalShares,
          averagePricePerShare: avgPrice,
        };
      },
    },

    Mutation: {
      /**
       * Create new asset
       */
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
          pending: true, // New assets require approval
        };

        const data = dataLayer.loadData();
        data[contractId] = newAsset;
        dataLayer.saveData(data);
        dataLayer.syncSearchIndex();

        return {
          contractId,
          ...newAsset,
          isPaused: false,
        };
      },

      /**
       * Update existing asset
       */
      updateAsset: (_parent, args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can update assets');
        }

        const { contractId, input } = args;
        if (!dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer.loadData();
        const existing = data[contractId];
        if (!existing) throw new Error('Asset not found');

        const error = dataLayer.validateRwaBody(input);
        if (error) throw new Error(error);

        const updated = {
          ...existing,
          ...input,
          updatedAt: new Date().toISOString(),
        };

        data[contractId] = updated;
        dataLayer.saveData(data);
        dataLayer.syncSearchIndex();

        return {
          contractId,
          ...updated,
          isPaused: updated.paused || false,
        };
      },

      /**
       * Delete asset
       */
      deleteAsset: (_parent, args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can delete assets');
        }

        const { contractId } = args;
        if (!dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer.loadData();
        if (!data[contractId]) throw new Error('Asset not found');

        delete data[contractId];
        dataLayer.saveData(data);
        dataLayer.syncSearchIndex();

        return true;
      },

      /**
       * Approve pending asset for publication
       */
      approveAsset: (_parent, args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can approve assets');
        }

        const { contractId } = args;
        if (!dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer.loadData();
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.pending = false;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        dataLayer.saveData(data);

        return {
          contractId,
          ...asset,
          isPaused: asset.paused || false,
        };
      },

      /**
       * Pause asset trading
       */
      pauseAsset: (_parent, args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can pause assets');
        }

        const { contractId } = args;
        if (!dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer.loadData();
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.paused = true;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        dataLayer.saveData(data);

        return {
          contractId,
          ...asset,
          isPaused: true,
        };
      },

      /**
       * Unpause asset trading
       */
      unpauseAsset: (_parent, args, context) => {
        if (!context.isAdmin) {
          throw new Error('Unauthorized: Only admins can unpause assets');
        }

        const { contractId } = args;
        if (!dataLayer.validateContractId(contractId)) {
          throw new Error('Invalid contract ID');
        }

        const data = dataLayer.loadData();
        const asset = data[contractId];
        if (!asset) throw new Error('Asset not found');

        asset.paused = false;
        asset.updatedAt = new Date().toISOString();
        data[contractId] = asset;
        dataLayer.saveData(data);

        return {
          contractId,
          ...asset,
          isPaused: false,
        };
      },
    },

    Subscription: {
      /**
       * Subscribe to share purchase events
       * Optionally filter by contractId
       */
      onSharePurchased: {
        subscribe: (_parent, args) => {
          const { contractId } = args;
          const topic = contractId 
            ? `${SUBSCRIPTION_EVENTS.SHARE_PURCHASED}:${contractId}`
            : SUBSCRIPTION_EVENTS.SHARE_PURCHASED;

          return pubsub.subscribe(topic, (payload) => {
            // Return only events for this contract if filtered
            if (contractId && payload.data.contractId !== contractId) {
              return null;
            }
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to price update events
       * Optionally filter by contractId
       */
      onPriceUpdated: {
        subscribe: (_parent, args) => {
          const { contractId } = args;
          const topic = contractId
            ? `${SUBSCRIPTION_EVENTS.PRICE_UPDATED}:${contractId}`
            : SUBSCRIPTION_EVENTS.PRICE_UPDATED;

          return pubsub.subscribe(topic, (payload) => {
            if (contractId && payload.data.contractId !== contractId) {
              return null;
            }
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to new asset listings
       */
      onAssetListed: {
        subscribe: () => {
          return pubsub.subscribe(SUBSCRIPTION_EVENTS.ASSET_LISTED, (payload) => {
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to asset updates
       * Optionally filter by contractId
       */
      onAssetUpdated: {
        subscribe: (_parent, args) => {
          const { contractId } = args;
          const topic = contractId
            ? `${SUBSCRIPTION_EVENTS.ASSET_UPDATED}:${contractId}`
            : SUBSCRIPTION_EVENTS.ASSET_UPDATED;

          return pubsub.subscribe(topic, (payload) => {
            if (contractId && payload.data.contractId !== contractId) {
              return null;
            }
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to availability changes
       * Optionally filter by contractId
       */
      onAvailabilityChanged: {
        subscribe: (_parent, args) => {
          const { contractId } = args;
          const topic = contractId
            ? `${SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED}:${contractId}`
            : SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED;

          return pubsub.subscribe(topic, (payload) => {
            if (contractId && payload.data.contractId !== contractId) {
              return null;
            }
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to marketplace paused events
       */
      onMarketplacePaused: {
        subscribe: () => {
          return pubsub.subscribe(SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED, (payload) => {
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to marketplace unpaused events
       */
      onMarketplaceUnpaused: {
        subscribe: () => {
          return pubsub.subscribe(SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED, (payload) => {
            return payload.data;
          });
        },
      },

      /**
       * Subscribe to transaction completion events
       * Optionally filter by contractId
       */
      onTransactionCompleted: {
        subscribe: (_parent, args) => {
          const { contractId } = args;
          const topic = contractId
            ? `${SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED}:${contractId}`
            : SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED;

          return pubsub.subscribe(topic, (payload) => {
            if (contractId && payload.data.contractId !== contractId) {
              return null;
            }
            return payload.data;
          });
        },
      },
    },
  };
}
