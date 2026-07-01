// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/analyticsService.js — Marketplace analytics and insights
 *
 * Provides comprehensive analytics for marketplace activity including:
 * - Volume metrics (total, by asset type, by location)
 * - User engagement (active users, retention)
 * - Asset performance (most popular, trending)
 * - Purchase patterns and trends
 * - Time-series data for charts
 */

import { createHash } from 'crypto';

/**
 * Analytics Service
 */
export class AnalyticsService {
  constructor(dataService, logger) {
    this.dataService = dataService;
    this.logger = logger || console;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get marketplace overview metrics
   * @returns {Object} Overview with total assets, volume, users, etc.
   */
  getOverview() {
    const cacheKey = 'analytics:overview';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const approvedAssets = Object.entries(assets)
      .filter(([, asset]) => !asset.status || asset.status === 'approved')
      .map(([id, asset]) => ({ id, ...asset }));

    // Calculate metrics
    const totalAssets = approvedAssets.length;
    const totalValuation = approvedAssets.reduce((sum, a) => {
      const val = parseFloat(a.totalValuation) || 0;
      return sum + val;
    }, 0);

    const assetTypeDistribution = {};
    const locationDistribution = {};

    for (const asset of approvedAssets) {
      // Asset type distribution
      const type = asset.assetType || 'Unknown';
      assetTypeDistribution[type] = (assetTypeDistribution[type] || 0) + 1;

      // Location distribution
      if (asset.location) {
        const location = asset.location.split(',')[0].trim();
        locationDistribution[location] = (locationDistribution[location] || 0) + 1;
      }
    }

    const overview = {
      totalAssets,
      totalValuation,
      totalValuationFormatted: `$${totalValuation.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      assetTypeDistribution,
      locationDistribution,
      averageValuationPerAsset: totalAssets > 0 ? totalValuation / totalAssets : 0,
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: overview, timestamp: Date.now() });
    return overview;
  }

  /**
   * Get volume metrics
   * @returns {Object} Volume data with breakdowns
   */
  getVolumeMetrics() {
    const cacheKey = 'analytics:volume';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const approvedAssets = Object.entries(assets)
      .filter(([, asset]) => !asset.status || asset.status === 'approved')
      .map(([id, asset]) => ({ id, ...asset }));

    // Total volume
    const totalVolume = approvedAssets.reduce((sum, a) => {
      const val = parseFloat(a.totalValuation) || 0;
      return sum + val;
    }, 0);

    // Volume by asset type
    const volumeByType = {};
    for (const asset of approvedAssets) {
      const type = asset.assetType || 'Unknown';
      const val = parseFloat(asset.totalValuation) || 0;
      volumeByType[type] = (volumeByType[type] || 0) + val;
    }

    // Volume by location (top 10)
    const volumeByLocation = {};
    for (const asset of approvedAssets) {
      if (asset.location) {
        const location = asset.location.split(',')[0].trim();
        const val = parseFloat(asset.totalValuation) || 0;
        volumeByLocation[location] = (volumeByLocation[location] || 0) + val;
      }
    }

    const sortedLocations = Object.entries(volumeByLocation)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((acc, [loc, vol]) => {
        acc[loc] = vol;
        return acc;
      }, {});

    const metrics = {
      totalVolume,
      totalVolumeFormatted: `$${totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      volumeByType: Object.entries(volumeByType).reduce((acc, [type, vol]) => {
        acc[type] = {
          value: vol,
          formatted: `$${vol.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          percentage: totalVolume > 0 ? `${((vol / totalVolume) * 100).toFixed(2)}%` : '0%',
        };
        return acc;
      }, {}),
      volumeByLocation: Object.entries(sortedLocations).reduce((acc, [loc, vol]) => {
        acc[loc] = {
          value: vol,
          formatted: `$${vol.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          percentage: totalVolume > 0 ? `${((vol / totalVolume) * 100).toFixed(2)}%` : '0%',
        };
        return acc;
      }, {}),
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: metrics, timestamp: Date.now() });
    return metrics;
  }

  /**
   * Get popular assets
   * @param {number} limit - Number of top assets to return
   * @returns {Object} Top assets by various metrics
   */
  getPopularAssets(limit = 10) {
    const cacheKey = `analytics:popular:${limit}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const approvedAssets = Object.entries(assets)
      .filter(([, asset]) => !asset.status || asset.status === 'approved')
      .map(([id, asset]) => ({
        contractId: id,
        title: asset.title || 'Untitled',
        assetType: asset.assetType || 'Unknown',
        location: asset.location || 'Unknown',
        valuation: parseFloat(asset.totalValuation) || 0,
        createdAt: asset.createdAt,
      }));

    // Sort by valuation (most valuable first)
    const topByValuation = [...approvedAssets]
      .sort((a, b) => b.valuation - a.valuation)
      .slice(0, limit)
      .map((a, idx) => ({ ...a, rank: idx + 1 }));

    // Sort by creation date (newest first)
    const topByRecency = [...approvedAssets]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((a, idx) => ({ ...a, rank: idx + 1 }));

    const result = {
      topByValuation: {
        assets: topByValuation,
        totalValue: topByValuation.reduce((sum, a) => sum + a.valuation, 0),
      },
      topByRecency: {
        assets: topByRecency,
        totalValue: topByRecency.reduce((sum, a) => sum + a.valuation, 0),
      },
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get asset type analytics
   * @returns {Object} Breakdown by asset type
   */
  getAssetTypeAnalytics() {
    const cacheKey = 'analytics:assetTypes';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const typeMetrics = {};

    for (const [id, asset] of Object.entries(assets)) {
      if (asset.status && asset.status !== 'approved') continue;

      const type = asset.assetType || 'Unknown';
      if (!typeMetrics[type]) {
        typeMetrics[type] = {
          count: 0,
          totalValue: 0,
          assets: [],
        };
      }

      typeMetrics[type].count += 1;
      typeMetrics[type].totalValue += parseFloat(asset.totalValuation) || 0;
      typeMetrics[type].assets.push({
        contractId: id,
        title: asset.title,
        valuation: parseFloat(asset.totalValuation) || 0,
      });
    }

    // Sort assets within each type by valuation
    for (const type in typeMetrics) {
      typeMetrics[type].assets.sort((a, b) => b.valuation - a.valuation);
      typeMetrics[type].averageValue =
        typeMetrics[type].count > 0 ? typeMetrics[type].totalValue / typeMetrics[type].count : 0;
    }

    const result = {
      typeMetrics: Object.entries(typeMetrics)
        .sort((a, b) => b[1].count - a[1].count)
        .reduce((acc, [type, metrics]) => {
          acc[type] = metrics;
          return acc;
        }, {}),
      totalTypes: Object.keys(typeMetrics).length,
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get location-based analytics
   * @returns {Object} Breakdown by location
   */
  getLocationAnalytics() {
    const cacheKey = 'analytics:locations';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const locationMetrics = {};

    for (const [id, asset] of Object.entries(assets)) {
      if (asset.status && asset.status !== 'approved') continue;

      if (!asset.location) continue;

      const location = asset.location.split(',')[0].trim();
      if (!locationMetrics[location]) {
        locationMetrics[location] = {
          count: 0,
          totalValue: 0,
          assetTypes: {},
          assets: [],
        };
      }

      locationMetrics[location].count += 1;
      locationMetrics[location].totalValue += parseFloat(asset.totalValuation) || 0;

      const type = asset.assetType || 'Unknown';
      locationMetrics[location].assetTypes[type] =
        (locationMetrics[location].assetTypes[type] || 0) + 1;

      locationMetrics[location].assets.push({
        contractId: id,
        title: asset.title,
        assetType: type,
        valuation: parseFloat(asset.totalValuation) || 0,
      });
    }

    // Sort by total value descending
    const sorted = Object.entries(locationMetrics)
      .sort((a, b) => b[1].totalValue - a[1].totalValue)
      .reduce((acc, [loc, metrics]) => {
        metrics.assets.sort((a, b) => b.valuation - a.valuation);
        metrics.averageValue = metrics.count > 0 ? metrics.totalValue / metrics.count : 0;
        acc[loc] = metrics;
        return acc;
      }, {});

    const result = {
      locations: sorted,
      totalLocations: Object.keys(locationMetrics).length,
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get trending insights
   * @returns {Object} Trending assets and patterns
   */
  getTrendingInsights() {
    const cacheKey = 'analytics:trending';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * oneDayMs;

    const recentAssets = [];
    const trendingAssets = [];

    for (const [id, asset] of Object.entries(assets)) {
      if (asset.status && asset.status !== 'approved') continue;

      const createdAt = new Date(asset.createdAt).getTime();
      const ageMs = now - createdAt;

      // Recent (last 7 days)
      if (ageMs <= sevenDaysMs) {
        recentAssets.push({
          contractId: id,
          title: asset.title,
          assetType: asset.assetType,
          valuation: parseFloat(asset.totalValuation) || 0,
          daysOld: Math.floor(ageMs / oneDayMs),
          createdAt: asset.createdAt,
        });
      }

      // Trending (added in last 3 days with high valuation)
      if (ageMs <= 3 * oneDayMs && (parseFloat(asset.totalValuation) || 0) > 1000000) {
        trendingAssets.push({
          contractId: id,
          title: asset.title,
          assetType: asset.assetType,
          valuation: parseFloat(asset.totalValuation) || 0,
          daysOld: Math.floor(ageMs / oneDayMs),
        });
      }
    }

    recentAssets.sort((a, b) => b.valuation - a.valuation);
    trendingAssets.sort((a, b) => b.valuation - a.valuation);

    const result = {
      recentAssets: {
        count: recentAssets.length,
        assets: recentAssets.slice(0, 10),
        totalValue: recentAssets.reduce((sum, a) => sum + a.valuation, 0),
      },
      trendingAssets: {
        count: trendingAssets.length,
        assets: trendingAssets.slice(0, 5),
        totalValue: trendingAssets.reduce((sum, a) => sum + a.valuation, 0),
      },
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get time-series data for charts
   * @param {string} metric - Metric to chart ('assets', 'value')
   * @param {number} days - Number of days to include
   * @returns {Object} Time-series data points
   */
  getTimeSeriesData(metric = 'assets', days = 30) {
    const cacheKey = `analytics:timeseries:${metric}:${days}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const assets = this.dataService.loadData();
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Initialize data points for each day
    const dataPoints = {};
    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * oneDayMs);
      const dateStr = date.toISOString().split('T')[0];
      dataPoints[dateStr] = metric === 'assets' ? 0 : 0;
    }

    // Aggregate data
    for (const [, asset] of Object.entries(assets)) {
      if (asset.status && asset.status !== 'approved') continue;

      const createdAt = new Date(asset.createdAt);
      const dateStr = createdAt.toISOString().split('T')[0];

      if (dateStr in dataPoints) {
        if (metric === 'assets') {
          dataPoints[dateStr] += 1;
        } else if (metric === 'value') {
          dataPoints[dateStr] += parseFloat(asset.totalValuation) || 0;
        }
      }
    }

    // Convert to sorted array
    const timeSeries = Object.entries(dataPoints)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, value]) => ({
        date,
        value,
        valueFormatted:
          metric === 'value'
            ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : value,
      }));

    const result = {
      metric,
      period: `${days} days`,
      timeSeries,
      total: timeSeries.reduce((sum, p) => sum + p.value, 0),
      average:
        timeSeries.length > 0
          ? timeSeries.reduce((sum, p) => sum + p.value, 0) / timeSeries.length
          : 0,
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get comprehensive dashboard data
   * @returns {Object} All key metrics for dashboard
   */
  getDashboard() {
    return {
      overview: this.getOverview(),
      volumeMetrics: this.getVolumeMetrics(),
      popularAssets: this.getPopularAssets(5),
      assetTypeAnalytics: this.getAssetTypeAnalytics(),
      locationAnalytics: this.getLocationAnalytics(),
      trendingInsights: this.getTrendingInsights(),
      timeSeries: {
        assets: this.getTimeSeriesData('assets', 30),
        value: this.getTimeSeriesData('value', 30),
      },
    };
  }

  /**
   * Clear analytics cache
   */
  clearCache() {
    this.cache.clear();
    this.logger.info('Analytics cache cleared');
  }
}

/**
 * Factory function to create AnalyticsService
 */
export function createAnalyticsService(dataService, logger) {
  return new AnalyticsService(dataService, logger);
}
