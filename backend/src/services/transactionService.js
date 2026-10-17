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
      const eventIndex = data.eventIndex || 0;
      
      // Redis duplicate check
      let redisCache = null;
      try {
        const { REDIS_URL } = await import('../config.js');
        const Redis = (await import('ioredis')).default;
        if (REDIS_URL && !this._redisClient) {
          this._redisClient = new Redis(REDIS_URL, { lazyConnect: true });
          await this._redisClient.connect().catch(() => {});
        }
        redisCache = this._redisClient;
      } catch(e) {}

      if (redisCache && data.blockchainHash) {
         const cacheKey = `processed_tx:${data.blockchainHash}:${eventIndex}`;
         const setnxRes = await redisCache.setnx(cacheKey, '1');
         if (setnxRes === 0) {
           this.logger.info({ blockchainHash: data.blockchainHash }, 'Duplicate transaction ignored by Redis cache');
           return null;
         }
         await redisCache.expire(cacheKey, 86400); // 24 hours
      }

      // Insert transaction with idempotent ON CONFLICT DO NOTHING
      const insertData = {
        transaction_id: transactionId,
        contract_id: data.contractId,
        buyer_address: data.buyerAddress,
        shares_purchased: data.sharesPurchased,
        price_per_share: data.pricePerShare,
        total_amount: data.totalAmount,
        payment_token: data.paymentToken,
        status: 'completed',
        blockchain_hash: data.blockchainHash || null,
        event_index: eventIndex,
        metadata: data.metadata || {},
        created_at: new Date(),
      };

      const query = this.db('transactions').insert(insertData);
      let transaction;
      
      if (data.blockchainHash) {
        const result = await query.onConflict(['blockchain_hash', 'event_index']).ignore().returning('*');
        if (result.length === 0) {
          this.logger.info({ blockchainHash: data.blockchainHash }, 'Duplicate transaction ignored by DB');
          return null; // DB conflict caught it
        }
        transaction = result[0];
      } else {
        const result = await query.returning('*');
        transaction = result[0];
      }

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
    const vaultMetrics = await this.getVaultAggregateMetrics();

    let totalTransactions = 0;
    let totalVolume = 0;
    let totalShares = 0;
    let uniqueAssets = 0;

    for (const v of vaultMetrics) {
      totalTransactions += Number(v.total_tx_count) || 0;
      totalVolume += Number(v.total_volume) || 0;
      totalShares += Number(v.total_shares) || 0;
      if (v.contract_id) uniqueAssets++;
    }

    // Exact count of unique buyers across all vaults
    const buyerResult = await this.db('transactions')
      .where('status', 'completed')
      .countDistinct('buyer_address as count')
      .first();
    const uniqueBuyers = Number(buyerResult?.count || 0);

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
   * Get highly optimized aggregate metrics for all fractional vaults using raw SQL CTEs
   */
  async getVaultAggregateMetrics() {
    const isPg = this.db.client.config.client === 'pg';
    let rawQuery;

    if (isPg) {
      rawQuery = `
        WITH live_data AS (
          SELECT 
            contract_id,
            COUNT(id) as live_tx_count,
            SUM(total_amount) as live_volume,
            SUM(shares_purchased) as live_shares,
            COUNT(DISTINCT buyer_address) as live_unique_buyers,
            MAX(price_per_share) as latest_price
          FROM transactions
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND status = 'completed'
          GROUP BY contract_id
        )
        SELECT 
          COALESCE(l.contract_id, h.contract_id) as contract_id,
          COALESCE(l.live_tx_count, 0) + COALESCE(h.historical_tx_count, 0) as total_tx_count,
          COALESCE(l.live_volume, 0) + COALESCE(h.historical_volume, 0) as total_volume,
          COALESCE(l.live_shares, 0) + COALESCE(h.historical_shares, 0) as total_shares,
          COALESCE(l.live_unique_buyers, 0) + COALESCE(h.historical_unique_buyers, 0) as approximate_unique_buyers,
          l.latest_price
        FROM live_data l
        FULL OUTER JOIN mv_historical_vault_metrics h ON l.contract_id = h.contract_id
      `;
    } else {
      // SQLite fallback (no FULL OUTER JOIN, using LEFT JOIN and UNION)
      rawQuery = `
        WITH live_data AS (
          SELECT 
            contract_id,
            COUNT(id) as live_tx_count,
            SUM(total_amount) as live_volume,
            SUM(shares_purchased) as live_shares,
            COUNT(DISTINCT buyer_address) as live_unique_buyers,
            MAX(price_per_share) as latest_price
          FROM transactions
          WHERE created_at >= datetime('now', '-1 day')
            AND status = 'completed'
          GROUP BY contract_id
        )
        SELECT 
          COALESCE(l.contract_id, h.contract_id) as contract_id,
          COALESCE(l.live_tx_count, 0) + COALESCE(h.historical_tx_count, 0) as total_tx_count,
          COALESCE(l.live_volume, 0) + COALESCE(h.historical_volume, 0) as total_volume,
          COALESCE(l.live_shares, 0) + COALESCE(h.historical_shares, 0) as total_shares,
          COALESCE(l.live_unique_buyers, 0) + COALESCE(h.historical_unique_buyers, 0) as approximate_unique_buyers,
          l.latest_price
        FROM live_data l
        LEFT JOIN mv_historical_vault_metrics h ON l.contract_id = h.contract_id
        UNION
        SELECT 
          COALESCE(l.contract_id, h.contract_id) as contract_id,
          COALESCE(l.live_tx_count, 0) + COALESCE(h.historical_tx_count, 0) as total_tx_count,
          COALESCE(l.live_volume, 0) + COALESCE(h.historical_volume, 0) as total_volume,
          COALESCE(l.live_shares, 0) + COALESCE(h.historical_shares, 0) as total_shares,
          COALESCE(l.live_unique_buyers, 0) + COALESCE(h.historical_unique_buyers, 0) as approximate_unique_buyers,
          l.latest_price
        FROM mv_historical_vault_metrics h
        LEFT JOIN live_data l ON l.contract_id = h.contract_id
      `;
    }

    const result = await this.db.raw(rawQuery);
    return result.rows || result;
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
