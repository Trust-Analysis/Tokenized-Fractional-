// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/queryMonitor.js — Issue #320: Query Performance Monitoring
 *
 * Tracks query execution times, identifies slow queries, monitors index usage,
 * and provides optimization recommendations.
 */

import { getDatabase } from './database.js';
import logger from './logger.js';

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10) || 100;
const MONITORING_ENABLED = process.env.QUERY_MONITORING_ENABLED !== 'false';

let queryStats = [];
let slowQueryLog = [];
const MAX_STATS_ENTRIES = 10000;
const MAX_SLOW_QUERIES = 500;

/**
 * Wrap a query function with performance monitoring
 * @param {string} queryName - Name/label for the query
 * @param {Function} queryFn - The query function to monitor
 * @returns {Promise<{result: any, duration: number, slow: boolean}>}
 */
export async function monitorQuery(queryName, queryFn) {
  if (!MONITORING_ENABLED) {
    const result = await queryFn();
    return { result, duration: 0, slow: false };
  }

  const start = performance.now();
  let result;
  let error = null;

  try {
    result = await queryFn();
  } catch (e) {
    error = e;
  }

  const duration = performance.now() - start;
  const slow = duration > SLOW_QUERY_THRESHOLD_MS;

  // Record stats
  recordQueryStats(queryName, duration, slow, error);

  if (slow) {
    logger.warn(`[QueryMonitor] Slow query detected: ${queryName} took ${duration.toFixed(2)}ms`);
  }

  if (error) {
    throw error;
  }

  return { result, duration, slow };
}

/**
 * Record query statistics
 */
function recordQueryStats(queryName, duration, slow, error) {
  const entry = {
    name: queryName,
    duration,
    slow,
    error: error ? error.message : null,
    timestamp: Date.now(),
  };

  queryStats.push(entry);

  // Trim stats if too many
  if (queryStats.length > MAX_STATS_ENTRIES) {
    queryStats = queryStats.slice(-MAX_STATS_ENTRIES / 2);
  }

  if (slow) {
    slowQueryLog.push(entry);
    if (slowQueryLog.length > MAX_SLOW_QUERIES) {
      slowQueryLog = slowQueryLog.slice(-MAX_SLOW_QUERIES / 2);
    }
  }
}

/**
 * Get query performance statistics
 * @param {number} timeWindowMs - Time window in milliseconds (default: last hour)
 * @returns {Object} Performance statistics
 */
export function getQueryStats(timeWindowMs = 3600000) {
  const cutoff = Date.now() - timeWindowMs;
  const recentStats = queryStats.filter(s => s.timestamp > cutoff);

  if (recentStats.length === 0) {
    return {
      totalQueries: 0,
      averageDuration: 0,
      slowQueries: 0,
      slowQueryRate: 0,
      topSlowQueries: [],
      queriesByName: {},
    };
  }

  const totalDuration = recentStats.reduce((sum, s) => sum + s.duration, 0);
  const slowQueries = recentStats.filter(s => s.slow);

  // Group by query name
  const byName = {};
  for (const stat of recentStats) {
    if (!byName[stat.name]) {
      byName[stat.name] = { count: 0, totalDuration: 0, slowCount: 0 };
    }
    byName[stat.name].count++;
    byName[stat.name].totalDuration += stat.duration;
    if (stat.slow) byName[stat.name].slowCount++;
  }

  // Calculate averages per query
  for (const name of Object.keys(byName)) {
    byName[name].avgDuration = byName[name].totalDuration / byName[name].count;
  }

  // Top slow queries by frequency
  const topSlowQueries = Object.entries(byName)
    .sort((a, b) => b[1].slowCount - a[1].slowCount)
    .slice(0, 10)
    .map(([name, stats]) => ({
      name,
      slowCount: stats.slowCount,
      avgDuration: stats.avgDuration.toFixed(2),
      totalCalls: stats.count,
    }));

  return {
    totalQueries: recentStats.length,
    averageDuration: (totalDuration / recentStats.length).toFixed(2),
    slowQueries: slowQueries.length,
    slowQueryRate: ((slowQueries.length / recentStats.length) * 100).toFixed(2) + '%',
    topSlowQueries,
    queriesByName: byName,
  };
}

/**
 * Get recent slow queries
 * @param {number} limit - Maximum number to return
 * @returns {Array} Recent slow queries
 */
export function getSlowQueries(limit = 50) {
  return slowQueryLog
    .slice(-limit)
    .sort((a, b) => b.duration - a.duration);
}

/**
 * Analyze database indexes and provide recommendations
 * @returns {Promise<Object>} Index analysis results
 */
export async function analyzeIndexUsage() {
  const db = getDatabase();

  try {
    // Get all indexes
    const indexes = await db.raw(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    );

    // Get table sizes
    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'knex_migrations%'"
    );

    const tableSizes = {};
    for (const table of tables) {
      const tableName = table.name;
      const [count] = await db(tableName).count('* as count');
      tableSizes[tableName] = parseInt(count.count, 10);
    }

    return {
      indexCount: indexes.length,
      indexes: indexes.map(idx => ({
        name: idx.name,
        table: idx.tbl_name,
      })),
      tableSizes,
      recommendations: generateIndexRecommendations(tableSizes, indexes),
    };
  } catch (error) {
    return {
      error: error.message,
      indexCount: 0,
      indexes: [],
      tableSizes: {},
      recommendations: [],
    };
  }
}

/**
 * Generate index recommendations based on table sizes and existing indexes
 */
function generateIndexRecommendations(tableSizes, indexes) {
  const recommendations = [];
  const indexNames = indexes.map(i => i.name);

  // Check for large tables without common indexes
  for (const [tableName, size] of Object.entries(tableSizes)) {
    if (size > 1000) {
      // Check if created_at index exists
      const hasDateIndex = indexNames.some(
        n => n.includes(tableName) && n.includes('created_at')
      );
      if (!hasDateIndex && tableName !== 'knex_migrations') {
        recommendations.push({
          type: 'missing_index',
          table: tableName,
          suggestion: `Consider adding an index on created_at for ${tableName} (${size} rows)`,
          priority: size > 10000 ? 'high' : 'medium',
        });
      }
    }
  }

  // Check for tables that might benefit from composite indexes
  if (tableSizes.transactions > 5000) {
    const hasCompositeIndex = indexNames.some(
      n => n.includes('transactions') && n.includes('buyer')
    );
    if (!hasCompositeIndex) {
      recommendations.push({
        type: 'composite_index',
        table: 'transactions',
        suggestion: 'Add composite index (buyer_address, created_at) for transaction history queries',
        priority: 'high',
      });
    }
  }

  return recommendations;
}

/**
 * Get overall query performance health status
 * @returns {Object} Health status
 */
export function getPerformanceHealth() {
  const stats = getQueryStats(3600000); // Last hour
  const slowRate = parseFloat(stats.slowQueryRate) || 0;

  let status = 'healthy';
  if (slowRate > 10) status = 'critical';
  else if (slowRate > 5) status = 'warning';
  else if (slowRate > 2) status = 'degraded';

  return {
    status,
    slowQueryRate: stats.slowQueryRate,
    totalQueries: stats.totalQueries,
    averageDuration: stats.averageDuration,
    topSlowQueries: stats.topSlowQueries.slice(0, 5),
    recommendations: slowRate > 5
      ? ['Consider adding indexes for slow queries', 'Review query execution plans']
      : [],
  };
}

/**
 * Reset all monitoring statistics
 */
export function resetStats() {
  queryStats = [];
  slowQueryLog = [];
}
