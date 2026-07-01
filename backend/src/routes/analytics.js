// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/analytics.js — Advanced analytics API endpoints
 *
 * Public endpoints:
 * - GET /analytics/overview - Marketplace overview metrics
 * - GET /analytics/volume - Volume breakdown by asset type/location
 * - GET /analytics/popular - Popular assets by volume
 * - GET /analytics/active-users - Active user counts
 * - GET /analytics/top-buyers - Top buyers by spending
 * - GET /analytics/purchase-trends - Purchase trends over time
 * - GET /analytics/asset-performance/:contractId - Performance for specific asset
 * - GET /analytics/user/:address - User portfolio and purchase history
 *
 * Admin endpoints (require authentication):
 * - GET /analytics/dashboard - Full admin dashboard
 * - POST /analytics/compute-daily - Compute daily snapshot
 * - GET /analytics/daily - Daily analytics time series
 */

import { Router } from 'express';

/**
 * Factory function to create analytics routes
 * @param {TransactionService} transactionService
 * @param {Object} logger
 * @param {Function} adminAuth - Admin auth middleware
 * @returns {Router}
 */
export function createAnalyticsRoutes(transactionService, logger, adminAuth) {
  const router = Router();

  /**
   * GET /analytics/overview
   * Get marketplace overview metrics
   */
  router.get('/overview', async (req, res) => {
    try {
      const metrics = await transactionService.getAllTimeMetrics();
      const activeUsersWeek = await transactionService.getActiveUsersCount(7);
      const activeUsersMonth = await transactionService.getActiveUsersCount(30);

      const overview = {
        totalTransactions: metrics.totalTransactions,
        totalVolume: metrics.totalVolume,
        totalVolumeFormatted: `$${metrics.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        totalShares: metrics.totalShares,
        uniqueBuyers: metrics.uniqueBuyers,
        uniqueAssets: metrics.uniqueAssets,
        averageTransactionSize: metrics.averageTransactionSize,
        averageTransactionSizeFormatted: `$${metrics.averageTransactionSize.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        activeUsers: {
          week: activeUsersWeek,
          month: activeUsersMonth,
        },
        timestamp: new Date().toISOString(),
      };

      logger.info({ requestId: req.requestId }, 'Overview retrieved');
      res.json({ data: overview });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get overview');
      res.status(500).json({ error: 'Failed to retrieve overview', message: error.message });
    }
  });

  /**
   * GET /analytics/volume
   * Get volume metrics with time ranges
   *
   * Query:
   * - days: number of days to look back (default: 30, max: 365)
   */
  router.get('/volume', async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const toDate = new Date();

      const metrics = await transactionService.getMetricsForDateRange(fromDate, toDate);
      const allTimeMetrics = await transactionService.getAllTimeMetrics();

      const volumeMetrics = {
        currentPeriod: metrics,
        allTime: {
          totalVolume: allTimeMetrics.totalVolume,
          totalVolumeFormatted: `$${allTimeMetrics.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        },
        growth: allTimeMetrics.totalVolume > 0
          ? (((metrics.totalVolume / allTimeMetrics.totalVolume) * 100)).toFixed(2) + '%'
          : 'N/A',
        timestamp: new Date().toISOString(),
      };

      logger.info({ days, requestId: req.requestId }, 'Volume metrics retrieved');
      res.json({ data: volumeMetrics });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get volume metrics');
      res.status(500).json({ error: 'Failed to retrieve volume metrics', message: error.message });
    }
  });

  /**
   * GET /analytics/popular
   * Get popular assets by trading volume
   *
   * Query:
   * - limit: number of assets (default: 10, max: 100)
   * - days: lookback period (default: 30)
   */
  router.get('/popular', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 100);
      const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const dailyAnalytics = await transactionService.getDailyAnalyticsForRange(
        fromDate,
        new Date()
      );

      // Aggregate top assets from daily snapshots
      const assetVolumes = {};
      const assetCounts = {};

      for (const day of dailyAnalytics) {
        if (day.metadata?.topAssets) {
          for (const asset of day.metadata.topAssets) {
            if (!assetVolumes[asset.contractId]) {
              assetVolumes[asset.contractId] = 0;
              assetCounts[asset.contractId] = 0;
            }
            assetVolumes[asset.contractId] += asset.volume;
            assetCounts[asset.contractId] += asset.count;
          }
        }
      }

      const popularAssets = Object.entries(assetVolumes)
        .map(([contractId, volume]) => ({
          contractId,
          volume,
          volumeFormatted: `$${volume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          transactionCount: assetCounts[contractId],
          averageTransactionSize: volume / assetCounts[contractId],
        }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);

      logger.info({ limit, days, requestId: req.requestId }, 'Popular assets retrieved');
      res.json({ data: { assets: popularAssets, period: `${days} days` } });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get popular assets');
      res.status(500).json({ error: 'Failed to retrieve popular assets', message: error.message });
    }
  });

  /**
   * GET /analytics/active-users
   * Get active user metrics
   *
   * Query:
   * - period: 'week', 'month', 'all' (default: 'month')
   */
  router.get('/active-users', async (req, res) => {
    try {
      const period = req.query.period || 'month';
      const dayLookup = period === 'week' ? 7 : period === 'month' ? 30 : null;

      let activeUsers = 0;
      if (dayLookup) {
        activeUsers = await transactionService.getActiveUsersCount(dayLookup);
      } else {
        // All-time unique buyers
        const metrics = await transactionService.getAllTimeMetrics();
        activeUsers = metrics.uniqueBuyers;
      }

      const result = {
        period: period === 'week' ? 'Last 7 days' : period === 'month' ? 'Last 30 days' : 'All-time',
        activeUsers,
        timestamp: new Date().toISOString(),
      };

      logger.info({ period, requestId: req.requestId }, 'Active users retrieved');
      res.json({ data: result });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get active users');
      res.status(500).json({ error: 'Failed to retrieve active users', message: error.message });
    }
  });

  /**
   * GET /analytics/top-buyers
   * Get top buyers by total spending
   *
   * Query:
   * - limit: number of buyers (default: 10, max: 100)
   */
  router.get('/top-buyers', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 100);
      const topBuyers = await transactionService.getTopBuyers(limit);

      const buyers = topBuyers.map(buyer => ({
        walletAddress: buyer.wallet_address,
        totalPurchases: buyer.total_purchases,
        totalSpent: parseFloat(buyer.total_spent),
        totalSpentFormatted: `$${parseFloat(buyer.total_spent).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        sharesOwned: parseFloat(buyer.shares_owned),
        firstPurchase: buyer.first_seen_at,
        lastPurchase: buyer.last_purchase_at,
      }));

      logger.info({ limit, requestId: req.requestId }, 'Top buyers retrieved');
      res.json({ data: { buyers, count: buyers.length } });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get top buyers');
      res.status(500).json({ error: 'Failed to retrieve top buyers', message: error.message });
    }
  });

  /**
   * GET /analytics/purchase-trends
   * Get purchase trends over time
   *
   * Query:
   * - days: period to analyze (default: 30, max: 365)
   * - interval: 'day', 'week', 'month' (default: 'day')
   */
  router.get('/purchase-trends', async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
      const interval = req.query.interval || 'day';

      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const dailyAnalytics = await transactionService.getDailyAnalyticsForRange(
        fromDate,
        new Date()
      );

      const trends = dailyAnalytics.map(day => ({
        date: day.date,
        transactions: day.transactions_count,
        volume: parseFloat(day.total_volume),
        volumeFormatted: `$${parseFloat(day.total_volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        uniqueBuyers: day.unique_buyers,
        uniqueAssets: day.unique_assets_traded,
        averageTransactionSize: parseFloat(day.average_transaction_size),
      }));

      logger.info({ days, interval, requestId: req.requestId }, 'Purchase trends retrieved');
      res.json({ data: { trends, period: `${days} days`, interval } });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get purchase trends');
      res.status(500).json({ error: 'Failed to retrieve purchase trends', message: error.message });
    }
  });

  /**
   * GET /analytics/asset-performance/:contractId
   * Get performance metrics for a specific asset
   */
  router.get('/asset-performance/:contractId', async (req, res) => {
    try {
      const { contractId } = req.params;

      const transactionCount = await transactionService.getContractTransactionCount(contractId);
      const volume = await transactionService.getContractVolume(contractId);
      const transactions = await transactionService.getContractTransactions(contractId, 50);

      if (transactionCount === 0) {
        logger.warn({ contractId, requestId: req.requestId }, 'No transactions found for asset');
        return res.json({ data: { contractId, transactionCount: 0, volume: 0, transactions: [] } });
      }

      const uniqueBuyers = new Set(transactions.map(t => t.buyer_address)).size;
      const totalShares = transactions.reduce((sum, t) => sum + parseFloat(t.shares_purchased), 0);

      const performance = {
        contractId,
        transactionCount,
        volume,
        volumeFormatted: `$${volume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        uniqueBuyers,
        totalShares,
        averageTransactionSize: volume / transactionCount,
        recentTransactions: transactions.slice(0, 10),
        timestamp: new Date().toISOString(),
      };

      logger.info({ contractId, requestId: req.requestId }, 'Asset performance retrieved');
      res.json({ data: performance });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get asset performance');
      res.status(500).json({ error: 'Failed to retrieve asset performance', message: error.message });
    }
  });

  /**
   * GET /analytics/user/:address
   * Get user portfolio and purchase history
   *
   * Query:
   * - limit: number of transactions (default: 20, max: 100)
   */
  router.get('/user/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);

      const userActivity = await transactionService.getUserActivity(address);
      const transactions = await transactionService.getBuyerTransactions(address, limit);

      const result = {
        walletAddress: address,
        activity: userActivity ? {
          totalPurchases: userActivity.total_purchases,
          totalSpent: parseFloat(userActivity.total_spent),
          totalSpentFormatted: `$${parseFloat(userActivity.total_spent).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          sharesOwned: parseFloat(userActivity.shares_owned),
          firstPurchase: userActivity.first_seen_at,
          lastPurchase: userActivity.last_purchase_at,
        } : null,
        purchases: transactions.map(tx => ({
          transactionId: tx.transaction_id,
          contractId: tx.contract_id,
          shares: parseFloat(tx.shares_purchased),
          amount: parseFloat(tx.total_amount),
          amountFormatted: `$${parseFloat(tx.total_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          date: tx.created_at,
          status: tx.status,
        })),
        timestamp: new Date().toISOString(),
      };

      logger.info({ address, limit, requestId: req.requestId }, 'User analytics retrieved');
      res.json({ data: result });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get user analytics');
      res.status(500).json({ error: 'Failed to retrieve user analytics', message: error.message });
    }
  });

  /**
   * Admin endpoints below
   */

  /**
   * GET /analytics/dashboard (Admin)
   * Full admin dashboard with all metrics
   */
  router.get('/dashboard', adminAuth, async (req, res) => {
    try {
      const metrics = await transactionService.getAllTimeMetrics();
      const topBuyers = await transactionService.getTopBuyers(5);
      const activeWeek = await transactionService.getActiveUsersCount(7);
      const activeMonth = await transactionService.getActiveUsersCount(30);
      const dailyAnalytics = await transactionService.getDailyAnalyticsForRange(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date()
      );

      const dashboard = {
        overview: {
          totalTransactions: metrics.totalTransactions,
          totalVolume: metrics.totalVolume,
          totalShares: metrics.totalShares,
          uniqueBuyers: metrics.uniqueBuyers,
          uniqueAssets: metrics.uniqueAssets,
        },
        activeUsers: {
          week: activeWeek,
          month: activeMonth,
        },
        topBuyers: topBuyers.map(b => ({
          address: b.wallet_address,
          spent: parseFloat(b.total_spent),
          purchases: b.total_purchases,
        })),
        dailyMetrics: dailyAnalytics.slice(0, 30),
        timestamp: new Date().toISOString(),
      };

      logger.info({ requestId: req.requestId }, 'Admin dashboard retrieved');
      res.json({ data: dashboard });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get dashboard');
      res.status(500).json({ error: 'Failed to retrieve dashboard', message: error.message });
    }
  });

  /**
   * POST /analytics/compute-daily (Admin)
   * Compute daily analytics snapshot for a specific date
   *
   * Body:
   * - date: ISO date string (optional, defaults to today)
   */
  router.post('/compute-daily', adminAuth, async (req, res) => {
    try {
      const dateStr = req.body.date || new Date().toISOString().split('T')[0];
      const date = new Date(dateStr);

      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      const result = await transactionService.computeDailyAnalytics(date);

      logger.info({
        date: dateStr,
        requestKey: req.apiKey?.id,
        requestId: req.requestId,
      }, 'Daily analytics computed');

      res.json({ data: result, message: 'Daily analytics computed successfully' });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to compute daily analytics');
      res.status(500).json({ error: 'Failed to compute daily analytics', message: error.message });
    }
  });

  /**
   * GET /analytics/daily (Admin)
   * Get daily analytics time series
   *
   * Query:
   * - from: start date (ISO format)
   * - to: end date (ISO format)
   * - limit: max records (default: 100, max: 365)
   */
  router.get('/daily', adminAuth, async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = req.query.to ? new Date(req.query.to) : new Date();

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      const dailyAnalytics = await transactionService.getDailyAnalyticsForRange(from, to);

      logger.info({
        from: from.toISOString(),
        to: to.toISOString(),
        recordCount: dailyAnalytics.length,
        requestId: req.requestId,
      }, 'Daily analytics retrieved');

      res.json({ data: dailyAnalytics });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get daily analytics');
      res.status(500).json({ error: 'Failed to retrieve daily analytics', message: error.message });
    }
  });

  return router;
}
