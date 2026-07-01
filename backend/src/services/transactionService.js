// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/transactionService.js — Purchase transaction tracking
 *
 * Handles:
 * - Recording share purchases
 * - Tracking user activity
 * - Computing daily analytics
 */

import { randomUUID } from 'crypto';

/**
 * Transaction Service
 */
export class TransactionService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
  }

  /**
   * Record a share purchase transaction
   *
   * @param {Object} data Purchase data
   * @param {string} data.contractId - RWA contract ID
   * @param {string} data.buyerAddress - Buyer's Stellar wallet address
   * @param {number} data.sharesPurchased - Number of shares purchased
   * @param {number} data.pricePerShare - Price per share
   * @param {number} data.totalAmount - Total amount paid
   * @param {string} data.paymentToken - Token used for payment
   * @param {string} [data.blockchainHash] - Soroban transaction hash
   * @param {Object} [data.metadata] - Additional metadata
   * @returns {Promise<Object>} Created transaction
   */
  async recordPurchase(data) {
    try {
      const transactionId = `tx_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

      // Insert transaction
      const [transaction] = await this.db('transactions').insert({
        transaction_id: transactionId,
        contract_id: data.contractId,
        buyer_address: data.buyerAddress,
        shares_purchased: data.sharesPurchased,
        price_per_share: data.pricePerShare,
        total_amount: data.totalAmount,
        payment_token: data.paymentToken,
        status: 'completed',
        blockchain_hash: data.blockchainHash || null,
        metadata: data.metadata || {},
        created_at: new Date(),
      }).returning('*');

      // Update or create user activity
      const existingUser = await this.db('user_activity')
        .where('wallet_address', data.buyerAddress)
        .first();

      if (existingUser) {
        await this.db('user_activity')
          .where('wallet_address', data.buyerAddress)
          .update({
            total_purchases: existingUser.total_purchases + 1,
            total_spent: parseFloat(existingUser.total_spent) + parseFloat(data.totalAmount),
            shares_owned: parseFloat(existingUser.shares_owned) + parseFloat(data.sharesPurchased),
            last_purchase_at: new Date(),
            updated_at: new Date(),
          });
      } else {
        await this.db('user_activity').insert({
          wallet_address: data.buyerAddress,
          total_purchases: 1,
          total_spent: data.totalAmount,
          shares_owned: data.sharesPurchased,
          last_purchase_at: new Date(),
          first_seen_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      this.logger.info({
        transactionId,
        contractId: data.contractId,
        buyerAddress: data.buyerAddress,
        sharesPurchased: data.sharesPurchased,
      }, 'Purchase recorded');

      return transaction;
    } catch (error) {
      this.logger.error({ error: error.message, data }, 'Failed to record purchase');
      throw new Error(`Failed to record purchase: ${error.message}`);
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(transactionId) {
    return this.db('transactions')
      .where('transaction_id', transactionId)
      .first();
  }

  /**
   * Get transactions for a contract
   */
  async getContractTransactions(contractId, limit = 100, offset = 0) {
    return this.db('transactions')
      .where('contract_id', contractId)
      .where('status', 'completed')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get transactions for a buyer
   */
  async getBuyerTransactions(buyerAddress, limit = 100, offset = 0) {
    return this.db('transactions')
      .where('buyer_address', buyerAddress)
      .where('status', 'completed')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get transaction count for a contract
   */
  async getContractTransactionCount(contractId) {
    const result = await this.db('transactions')
      .where('contract_id', contractId)
      .where('status', 'completed')
      .count('* as count')
      .first();
    return result?.count || 0;
  }

  /**
   * Get transaction volume for a contract (total USD value)
   */
  async getContractVolume(contractId) {
    const result = await this.db('transactions')
      .where('contract_id', contractId)
      .where('status', 'completed')
      .sum('total_amount as volume')
      .first();
    return parseFloat(result?.volume || 0);
  }

  /**
   * Get user activity
   */
  async getUserActivity(walletAddress) {
    return this.db('user_activity')
      .where('wallet_address', walletAddress)
      .first();
  }

  /**
   * Get top buyers by spending
   */
  async getTopBuyers(limit = 10) {
    return this.db('user_activity')
      .orderBy('total_spent', 'desc')
      .limit(limit);
  }

  /**
   * Get active users count (users with purchases in last N days)
   */
  async getActiveUsersCount(days = 7) {
    const result = await this.db('user_activity')
      .where('last_purchase_at', '>=', new Date(Date.now() - days * 24 * 60 * 60 * 1000))
      .count('* as count')
      .first();
    return result?.count || 0;
  }

  /**
   * Get all-time metrics
   */
  async getAllTimeMetrics() {
    const transactions = await this.db('transactions')
      .where('status', 'completed');

    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
    const totalShares = transactions.reduce((sum, t) => sum + parseFloat(t.shares_purchased), 0);

    const uniqueBuyers = new Set(transactions.map(t => t.buyer_address)).size;
    const uniqueAssets = new Set(transactions.map(t => t.contract_id)).size;

    return {
      totalTransactions,
      totalVolume,
      totalShares,
      uniqueBuyers,
      uniqueAssets,
      averageTransactionSize: totalTransactions > 0 ? totalVolume / totalTransactions : 0,
    };
  }

  /**
   * Get metrics for a date range
   */
  async getMetricsForDateRange(fromDate, toDate) {
    const transactions = await this.db('transactions')
      .where('status', 'completed')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate);

    const totalVolume = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
    const totalTransactions = transactions.length;
    const uniqueBuyers = new Set(transactions.map(t => t.buyer_address)).size;
    const uniqueAssets = new Set(transactions.map(t => t.contract_id)).size;

    return {
      period: `${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`,
      totalVolume,
      totalTransactions,
      uniqueBuyers,
      uniqueAssets,
      averageTransactionSize: totalTransactions > 0 ? totalVolume / totalTransactions : 0,
    };
  }

  /**
   * Compute daily analytics for a specific date
   */
  async computeDailyAnalytics(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const transactions = await this.db('transactions')
      .where('status', 'completed')
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay);

    const transactionsCount = transactions.length;
    const totalVolume = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
    const uniqueBuyers = new Set(transactions.map(t => t.buyer_address)).size;
    const uniqueAssets = new Set(transactions.map(t => t.contract_id)).size;

    const metadata = {
      topAssets: this._getTopAssetsForDay(transactions, 5),
      assetTypeBreakdown: this._getAssetTypeBreakdown(transactions),
    };

    const dateStr = date.toISOString().split('T')[0];

    // Upsert daily analytics
    const existing = await this.db('daily_analytics')
      .where('date', dateStr)
      .first();

    if (existing) {
      return this.db('daily_analytics')
        .where('date', dateStr)
        .update({
          transactions_count: transactionsCount,
          total_volume: totalVolume,
          unique_buyers: uniqueBuyers,
          unique_assets_traded: uniqueAssets,
          average_transaction_size: transactionsCount > 0 ? totalVolume / transactionsCount : 0,
          metadata,
          updated_at: new Date(),
        })
        .returning('*');
    } else {
      return this.db('daily_analytics').insert({
        date: dateStr,
        transactions_count: transactionsCount,
        total_volume: totalVolume,
        unique_buyers: uniqueBuyers,
        unique_assets_traded: uniqueAssets,
        average_transaction_size: transactionsCount > 0 ? totalVolume / transactionsCount : 0,
        metadata,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning('*');
    }
  }

  /**
   * Get daily analytics for a date range
   */
  async getDailyAnalyticsForRange(fromDate, toDate) {
    const dateStr = d => d.toISOString().split('T')[0];
    return this.db('daily_analytics')
      .where('date', '>=', dateStr(fromDate))
      .where('date', '<=', dateStr(toDate))
      .orderBy('date', 'desc');
  }

  /**
   * Helper: Extract top assets from transactions for a day
   */
  _getTopAssetsForDay(transactions, limit = 5) {
    const assets = {};
    for (const tx of transactions) {
      if (!assets[tx.contract_id]) {
        assets[tx.contract_id] = { volume: 0, count: 0 };
      }
      assets[tx.contract_id].volume += parseFloat(tx.total_amount);
      assets[tx.contract_id].count += 1;
    }

    return Object.entries(assets)
      .map(([contractId, data]) => ({ contractId, ...data }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  }

  /**
   * Helper: Get asset type breakdown (stub — would need asset metadata lookup)
   */
  _getAssetTypeBreakdown(transactions) {
    // This would require joining with assets table in real scenario
    return {};
  }
}

/**
 * Factory function to create TransactionService
 */
export function createTransactionService(db, logger) {
  return new TransactionService(db, logger);
}
