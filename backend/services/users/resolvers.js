// Users Service - Federated Resolvers
// This file contains the resolver functions for the Users service

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gql } from 'graphql-tag';
import { sanitizationService } from '../../src/services/sanitizationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the schema
const schemaPath = join(__dirname, 'schema.graphql');
const typeDefs = gql(readFileSync(schemaPath, 'utf-8'));

// Mock data layer - in production, this would connect to a database
const dataLayer = {
  users: new Map(),
  
  loadData() {
    return Object.fromEntries(this.users);
  },
  
  saveData(data) {
    this.users = new Map(Object.entries(data));
  },
  
  validateUserId(userId) {
    return typeof userId === 'string' && userId.startsWith('U');
  },
  
  validateWalletAddress(address) {
    return typeof address === 'string' && address.startsWith('G') && address.length === 56;
  }
};

// Initialize with sample data
const initializeSampleData = () => {
  const sampleUsers = {
    'U1234567890123456789012345678901234567890123456789012345678': {
      userId: 'U1234567890123456789012345678901234567890123456789012345678',
      walletAddress: 'GD1234567890123456789012345678901234567890123456789012',
      email: 'user1@example.com',
      kycStatus: 'APPROVED',
      kycVerifiedAt: '2024-01-15T10:00:00Z',
      createdAt: '2024-01-10T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      profile: {
        userId: 'U1234567890123456789012345678901234567890123456789012345678',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'John Doe',
        avatarUrl: 'https://example.com/avatar1.jpg',
        bio: 'Real estate investor',
        preferences: {
          notificationsEnabled: true,
          emailNotifications: true,
          currency: 'USD',
          language: 'en'
        }
      }
    },
    'U2345678901234567890123456789012345678901234567890123456789': {
      userId: 'U2345678901234567890123456789012345678901234567890123456789',
      walletAddress: 'GD2345678901234567890123456789012345678901234567890123',
      email: 'user2@example.com',
      kycStatus: 'PENDING',
      kycVerifiedAt: null,
      createdAt: '2024-02-01T10:00:00Z',
      updatedAt: '2024-02-01T10:00:00Z',
      profile: {
        userId: 'U2345678901234567890123456789012345678901234567890123456789',
        firstName: 'Jane',
        lastName: 'Smith',
        displayName: 'Jane Smith',
        avatarUrl: null,
        bio: null,
        preferences: {
          notificationsEnabled: true,
          emailNotifications: false,
          currency: 'EUR',
          language: 'en'
        }
      }
    }
  };
  
  Object.entries(sampleUsers).forEach(([userId, data]) => {
    dataLayer.users.set(userId, data);
  });
};

initializeSampleData();

// Resolvers
export const resolvers = {
  User: {
    // Reference resolver for Asset entity
    ownedAssets: async (user, _args, context) => {
      // This would normally call the Assets service via REST or GraphQL
      // For now, return a placeholder
      return [];
    },
    
    // Reference resolver for Transaction entity
    transactions: async (user, _args, context) => {
      // This would normally call the Transactions service
      return [];
    },
    
    // Profile resolver
    profile: (user) => {
      return user.profile || null;
    }
  },
  
  Query: {
    users: (_parent, args) => {
      const { filter, limit = 50, offset = 0 } = args;
      const allUsers = Array.from(dataLayer.users.entries()).map(([userId, data]) => ({
        userId,
        ...data
      }));

      let filtered = allUsers;

      if (filter?.kycStatus) {
        filtered = filtered.filter(user => user.kycStatus === filter.kycStatus);
      }

      if (filter?.search) {
        const searchTerms = filter.search.toLowerCase();
        filtered = filtered.filter(user =>
          user.email?.toLowerCase().includes(searchTerms) ||
          user.walletAddress?.toLowerCase().includes(searchTerms) ||
          user.profile?.displayName?.toLowerCase().includes(searchTerms)
        );
      }

      return filtered.slice(offset, offset + limit);
    },

    user: (_parent, args) => {
      const { userId } = args;
      const user = dataLayer.users.get(userId);
      if (!user) return null;

      return {
        userId,
        ...user
      };
    },

    userByWallet: (_parent, args) => {
      const { walletAddress } = args;
      const user = Array.from(dataLayer.users.values()).find(u => u.walletAddress === walletAddress);
      if (!user) return null;

      return {
        userId: user.userId,
        ...user
      };
    },

    usersCount: () => {
      return dataLayer.users.size;
    },

    userStatistics: () => {
      const users = Array.from(dataLayer.users.values());
      const kycVerified = users.filter(u => u.kycStatus === 'APPROVED').length;
      const kycPending = users.filter(u => u.kycStatus === 'PENDING').length;
      const activeUsers = users.filter(u => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return new Date(u.updatedAt) > thirtyDaysAgo;
      }).length;

      return {
        totalUsers: users.length,
        kycVerifiedUsers: kycVerified,
        kycPendingUsers: kycPending,
        activeUsers: activeUsers
      };
    }
  },

  Mutation: {
    updateUserProfile: (_parent, args, context) => {
      const { userId, input } = args;
      
      const user = dataLayer.users.get(userId);
      if (!user) throw new Error('User not found');

      // Strict XSS prevention: sanitize every user-supplied string before it
      // is persisted. Rich-text fields (bio) are run through DOMPurify's
      // HTML allowlist; plain-text fields are HTML-escaped.
      const sanitizedInput = {};
      for (const [key, value] of Object.entries(input || {})) {
        if (typeof value !== 'string') {
          sanitizedInput[key] = value;
          continue;
        }

        if (key === 'bio') {
          sanitizedInput[key] = sanitizationService.sanitizeHtml(value);
        } else {
          sanitizedInput[key] = sanitizationService.sanitizeString(value);
        }
      }

      const updated = {
        ...user,
        profile: {
          ...user.profile,
          ...sanitizedInput,
          userId
        },
        updatedAt: new Date().toISOString()
      };

      dataLayer.users.set(userId, updated);

      return {
        userId,
        ...updated
      };
    },

    updateUserPreferences: (_parent, args, context) => {
      const { userId, input } = args;
      
      const user = dataLayer.users.get(userId);
      if (!user) throw new Error('User not found');

      const updated = {
        ...user,
        profile: {
          ...user.profile,
          preferences: {
            ...user.profile.preferences,
            ...input
          }
        },
        updatedAt: new Date().toISOString()
      };

      dataLayer.users.set(userId, updated);

      return {
        userId,
        ...updated
      };
    },

    initiateKYC: (_parent, args, context) => {
      const { userId } = args;
      
      const user = dataLayer.users.get(userId);
      if (!user) throw new Error('User not found');

      const updated = {
        ...user,
        kycStatus: 'PENDING',
        updatedAt: new Date().toISOString()
      };

      dataLayer.users.set(userId, updated);

      return {
        userId,
        ...updated
      };
    },

    approveKYC: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can approve KYC');
      }

      const { userId } = args;
      
      const user = dataLayer.users.get(userId);
      if (!user) throw new Error('User not found');

      const updated = {
        ...user,
        kycStatus: 'APPROVED',
        kycVerifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      dataLayer.users.set(userId, updated);

      return {
        userId,
        ...updated
      };
    },

    rejectKYC: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can reject KYC');
      }

      const { userId, reason } = args;
      
      const user = dataLayer.users.get(userId);
      if (!user) throw new Error('User not found');

      const updated = {
        ...user,
        kycStatus: 'REJECTED',
        updatedAt: new Date().toISOString()
      };

      dataLayer.users.set(userId, updated);

      return {
        userId,
        ...updated
      };
    },

    deleteUser: (_parent, args, context) => {
      if (!context.isAdmin) {
        throw new Error('Unauthorized: Only admins can delete users');
      }

      const { userId } = args;
      
      if (!dataLayer.users.has(userId)) throw new Error('User not found');

      dataLayer.users.delete(userId);
      return true;
    }
  }
};

export { typeDefs };
