// Transactions Service - Federated Resolvers
// This file contains the resolver functions for the Transactions service

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
  transactions: new Map(),
  
  loadData() {
    return Object.fromEntries(this.transactions);
  },
  
  saveData(data) {
    this.transactions = new Map(Object.entries(data));
  },
  
  validateTransactionId(transactionId) {
    return typeof transactionId === 'string' && transactionId.startsWith('T');
  },
  
  validateContractId(contractId) {
    return typeof contractId === 'string' && contractId.startsWith('C') && contractId.length >= 56;
  },
  
  validateUserId(userId) {
    return typeof userId === 'string' && userId.startsWith('U');
  }
};

// Initialize with sample data
const initializeSampleData = () => {
  const sampleTransactions = {
    'T1234567890123456789012345678901234567890123456789012345678': {
      transactionId: 'T1234567890123456789012345678901234567890123456789012345678',
      type: 'PURCHASE',
      status: 'CONFIRMED',
      amount: 10000000,
      contractId: 'C1234567890123456789012345678901234567890123456789012345678',
      userId: 'U1234567890123456789012345678901234567890123456789012345678',
      walletAddress: 'GD1234567890123456789012345678901234567890123456789012',
      transactionHash: '0xabc123...',
      blockNumber: 12345,
      timestamp: '2024-01-20T10:00:00Z',
      createdAt: '2024-01-20T10:00:00Z',
      updatedAt: '2024-01-20T10:05:00Z',
      metadata: {
        shareCount: 1,
        pricePerShare: 10000000,
        gasUsed: 21000,
        gasPrice: 100,
        memo: 'Share purchase'
      }
    },
    'T2345678901234567890123456789012345678901234567890123456789': {
      transactionId: 'T2345678901234567890123456789012345678901234567890123456789',
      type: 'TRANSFER',
      status: 'PENDING',
      amount: 5000000,
      contractId: 'C1234567890123456789012345678901234567890123456789012345678',
      userId: 'U2345678901234567890123456789012345678901234567890123456789',
      walletAddress: 'GD2345678901234567890123456789012345678901234567890123',
      transactionHash: null,
      blockNumber: null,
      timestamp: '2024-02-01T10:00:00Z',
      createdAt: '2024-02-01T10:00:00Z',
      updatedAt: '2024-02-01T10:00:00Z',
      metadata: {
        shareCount: 0,
        pricePerShare: 0,
        gasUsed: 0,
        gasPrice: 0,
        memo: 'Pending transfer'
      }
    }
  };
  
  Object.entries(sampleTransactions).forEach(([transactionId, data]) => {
    dataLayer.transactions.set(transactionId, data);
  });
};

initializeSampleData();

// Resolvers
export const resolvers = {
  Transaction: {
    // Reference resolver for Asset entity
    asset: async (transaction, _args, context) => {
      // This would normally call the Assets service via REST or GraphQL
      // For now, return a placeholder
      return {
        __typename: 'Asset',
        contractId: transaction.contractId,
        title: 'Unknown Asset',
        location: 'Unknown'
      };
    },
    
    // Reference resolver for User entity
    user: async (transaction, _args, context) => {
      // This would normally call the Users service
      return {
        __typename: 'User',
        userId: transaction.userId,
        walletAddress: transaction.walletAddress,
        kycStatus: 'UNKNOWN'
      };
    },
    
    // Metadata resolver
    metadata: (transaction) => {
      return transaction.metadata || null;
    }
  },
  
  Query: {
    transactions: (_parent, args) => {
      const { filter, limit = 50, offset = 0 } = args;
      const allTransactions = Array.from(dataLayer.transactions.entries()).map(([transactionId, data]) => ({
        transactionId,
        ...data
      }));

      let filtered = allTransactions;

      if (filter?.type) {
        filtered = filtered.filter(tx => tx.type === filter.type);
      }

      if (filter?.status) {
        filtered = filtered.filter(tx => tx.status === filter.status);
      }

      if (filter?.contractId) {
        filtered = filtered.filter(tx => tx.contractId === filter.contractId);
      }

      if (filter?.userId) {
        filtered = filtered.filter(tx => tx.userId === filter.userId);
      }

      if (filter?.startDate) {
        const startDate = new Date(filter.startDate);
        filtered = filtered.filter(tx => new Date(tx.timestamp) >= startDate);
      }

      if (filter?.endDate) {
        const endDate = new Date(filter.endDate);
        filtered = filtered.filter(tx => new Date(tx.timestamp) <= endDate);
      }

      return filtered.slice(offset, offset + limit);
    },

    transaction: (_parent, args) => {
      const { transactionId } = args;
      const transaction = dataLayer.transactions.get(transactionId);
      if (!transaction) return null;

      return {
        transactionId,
        ...transaction
      };
    },

    transactionsByAsset: (_parent, args) => {
      const { contractId, limit = 50, offset = 0 } = args;
      const allTransactions = Array.from(dataLayer.transactions.values())
        .filter(tx => tx.contractId === contractId)
        .map(tx => ({
          transactionId: tx.transactionId,
          ...tx
        }));

      return allTransactions.slice(offset, offset + limit);
    },

    transactionsByUser: (_parent, args) => {
      const { userId, limit = 50, offset = 0 } = args;
      const allTransactions = Array.from(dataLayer.transactions.values())
        .filter(tx => tx.userId === userId)
        .map(tx => ({
          transactionId: tx.transactionId,
          ...tx
        }));

      return allTransactions.slice(offset, offset + limit);
    },

    transactionsCount: () => {
      return dataLayer.transactions.size;
    },

    transactionStatistics: () => {
      const transactions = Array.from(dataLayer.transactions.values());
      const pending = transactions.filter(t => t.status === 'PENDING').length;
      const confirmed = transactions.filter(t => t.status === 'CONFIRMED').length;
      const failed = transactions.filter(t => t.status === 'FAILED').length;
      const totalVolume = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      const avgAmount = transactions.length > 0
        ? totalVolume / transactions.length
        : 0;

      const transactionsByType = {};
      transactions.forEach(tx => {
        const type = tx.type || 'OTHER';
        transactionsByType[type] = (transactionsByType[type] || 0) + 1;
      });

      const transactionsByStatus = {};
      transactions.forEach(tx => {
        const status = tx.status || 'UNKNOWN';
        transactionsByStatus[status] = (transactionsByStatus[status] || 0) + 1;
      });

      return {
        totalTransactions: transactions.length,
        pendingTransactions: pending,
        confirmedTransactions: confirmed,
        failedTransactions: failed,
        totalVolume,
        averageTransactionAmount: avgAmount,
        transactionsByType: Object.entries(transactionsByType).map(([type, count]) => ({
          type,
          count
        })),
        transactionsByStatus: Object.entries(transactionsByStatus).map(([status, count]) => ({
          status,
          count
        }))
      };
    }
  },

  Mutation: {
    createTransaction: (_parent, args, context) => {
      const { input } = args;
      
      if (!dataLayer.validateContractId(input.contractId)) {
        throw new Error('Invalid contract ID');
      }
      
      if (!dataLayer.validateUserId(input.userId)) {
        throw new Error('Invalid user ID');
      }

      const transactionId = `T${Math.random().toString(36).substring(2, 56)}`;
      const now = new Date().toISOString();

      const newTransaction = {
        ...input,
        transactionId,
        status: 'PENDING',
        transactionHash: null,
        blockNumber: null,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata || {}
      };

      dataLayer.transactions.set(transactionId, newTransaction);

      return {
        transactionId,
        ...newTransaction
      };
    },

    updateTransactionStatus: (_parent, args, context) => {
      const { transactionId, status, transactionHash } = args;
      
      if (!dataLayer.validateTransactionId(transactionId)) {
        throw new Error('Invalid transaction ID');
      }

      const transaction = dataLayer.transactions.get(transactionId);
      if (!transaction) throw new Error('Transaction not found');

      const updated = {
        ...transaction,
        status,
        transactionHash: transactionHash || transaction.transactionHash,
        updatedAt: new Date().toISOString()
      };

      dataLayer.transactions.set(transactionId, updated);

      return {
        transactionId,
        ...updated
      };
    },

    cancelTransaction: (_parent, args, context) => {
      const { transactionId } = args;
      
      if (!dataLayer.validateTransactionId(transactionId)) {
        throw new Error('Invalid transaction ID');
      }

      const transaction = dataLayer.transactions.get(transactionId);
      if (!transaction) throw new Error('Transaction not found');

      if (transaction.status !== 'PENDING') {
        throw new Error('Can only cancel pending transactions');
      }

      const updated = {
        ...transaction,
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      };

      dataLayer.transactions.set(transactionId, updated);

      return {
        transactionId,
        ...updated
      };
    },

    retryTransaction: (_parent, args, context) => {
      const { transactionId } = args;
      
      if (!dataLayer.validateTransactionId(transactionId)) {
        throw new Error('Invalid transaction ID');
      }

      const transaction = dataLayer.transactions.get(transactionId);
      if (!transaction) throw new Error('Transaction not found');

      if (transaction.status !== 'FAILED') {
        throw new Error('Can only retry failed transactions');
      }

      const updated = {
        ...transaction,
        status: 'PENDING',
        transactionHash: null,
        updatedAt: new Date().toISOString()
      };

      dataLayer.transactions.set(transactionId, updated);

      return {
        transactionId,
        ...updated
      };
    }
  }
};

export { typeDefs };
