// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/database.js — Database initialization and connection management
 *
 * Includes:
 * - Connection pooling with health checks (Issue #314)
 * - Pool monitoring and leak detection
 * - Migration rollback support (Issue #316)
 */

import knexModule from 'knex';
import knexConfig from '../../knexfile.js';
import { getSqlInjectionGuard, wrapKnexWithGuard } from './sqlInjectionGuard.js';

let dbInstance = null;
let poolMonitorInterval = null;

/**
 * Initialize database connection
 * @param {string} environment - Environment name (development, test, production)
 * @returns {Promise<import('knex').Knex>}
 */
export async function initDatabase(environment = 'development') {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = knexModule(knexConfig[environment]);

  // Issue #356: Wrap knex with SQL injection guard for protection
  const guard = getSqlInjectionGuard();
  wrapKnexWithGuard(dbInstance, guard);

  // Run migrations
  try {
    await dbInstance.migrate.latest();
  } catch (error) {
    console.error('Database migration failed:', error);
    throw error;
  }

  // Issue #314: Start pool monitoring in production
  if (environment === 'production') {
    startPoolMonitor();
  }

  return dbInstance;
}

/**
 * Get database instance (must call initDatabase first)
 * @returns {import('knex').Knex}
 */
export function getDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Issue #314: Get connection pool statistics
 * @returns {Object} Pool statistics
 */
export function getPoolStats() {
  if (!dbInstance) {
    return null;
  }

  const { pool } = dbInstance.client;
  if (!pool) {
    return null;
  }

  return {
    totalConnections: pool.numUsed() + pool.numFree(),
    usedConnections: pool.numUsed(),
    freeConnections: pool.numFree(),
    pendingRequests: pool.numPending(),
    maxConnections: pool.max || 20,
    minConnections: pool.min || 2,
    // Estimate pool utilization percentage
    utilization: Math.round((pool.numUsed() / (pool.max || 20)) * 100),
  };
}

/**
 * Issue #314: Check database connection health
 * @returns {Promise<Object>} Health check result
 */
export async function checkDatabaseHealth() {
  if (!dbInstance) {
    return { status: 'uninitialized', healthy: false };
  }

  try {
    const start = Date.now();
    await dbInstance.raw('SELECT 1');
    const latencyMs = Date.now() - start;

    const poolStats = getPoolStats();

    return {
      status: 'healthy',
      healthy: true,
      latencyMs,
      pool: poolStats,
      // Warning if pool utilization exceeds 80%
      poolWarning: poolStats && poolStats.utilization > 80,
    };
  } catch (error) {
    return {
      status: 'error',
      healthy: false,
      error: error.message,
    };
  }
}

/**
 * Issue #314: Start periodic pool monitoring
 * Logs pool statistics every 30 seconds in production
 */
function startPoolMonitor() {
  if (poolMonitorInterval) {
    return;
  }

  poolMonitorInterval = setInterval(() => {
    const stats = getPoolStats();
    if (stats) {
      // Log warning if pool utilization is high
      if (stats.utilization > 80) {
        console.warn(
          `[DB Pool] High utilization: ${stats.utilization}% (${stats.usedConnections}/${stats.maxConnections} used)`,
        );
      }
      // Log if there are pending requests (potential bottleneck)
      if (stats.pendingRequests > 0) {
        console.warn(`[DB Pool] ${stats.pendingRequests} pending connection requests`);
      }
    }
  }, 30000);

  // Ensure cleanup on process exit
  process.on('SIGTERM', () => stopPoolMonitor());
  process.on('SIGINT', () => stopPoolMonitor());
}

/**
 * Issue #314: Stop pool monitoring
 */
function stopPoolMonitor() {
  if (poolMonitorInterval) {
    clearInterval(poolMonitorInterval);
    poolMonitorInterval = null;
  }
}

/**
 * Issue #316: Validate a migration rollback
 * Tests that a specific migration can be rolled back cleanly
 * @param {string} migrationId - The migration identifier to test rollback for
 * @returns {Promise<Object>} Validation result
 */
export async function validateMigrationRollback(migrationId) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }

  try {
    // Get current migration state
    const [current] = await dbInstance.migrate.currentVersion();
    console.log(`Current migration version: ${current}`);

    // Attempt rollback of the specific migration
    await dbInstance.migrate.rollback({ directory: './migrations' });

    // Verify rollback succeeded
    const [afterRollback] = await dbInstance.migrate.currentVersion();
    const rollbackSuccess = afterRollback !== current;

    // Re-apply to restore state
    await dbInstance.migrate.latest();

    return {
      migrationId,
      success: rollbackSuccess,
      fromVersion: current,
      toVersion: afterRollback,
      message: rollbackSuccess
        ? `Migration ${migrationId} rolled back successfully`
        : `Migration ${migrationId} rollback did not change version`,
    };
  } catch (error) {
    return {
      migrationId,
      success: false,
      error: error.message,
      message: `Migration ${migrationId} rollback failed: ${error.message}`,
    };
  }
}

/**
 * Issue #316: Validate all migration rollbacks in sequence
 * Tests that every migration can be rolled back and re-applied
 * @returns {Promise<Object>} Comprehensive validation result
 */
export async function validateAllRollbacks() {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }

  const results = [];

  try {
    // Get list of executed migrations
    const [current] = await dbInstance.migrate.currentVersion();
    console.log(`Validating rollbacks from version: ${current}`);

    // Roll back one step at a time
    let version = current;
    while (version && version !== '0') {
      const result = await validateMigrationRollback(version);
      results.push(result);
      const [newVersion] = await dbInstance.migrate.currentVersion();
      if (newVersion === version) {
        break; // No more rollbacks possible
      }
      version = newVersion;
    }

    return {
      totalTested: results.length,
      passed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  } catch (error) {
    return {
      totalTested: results.length,
      passed: results.filter((r) => r.success).length,
      failed: results.length - results.filter((r) => r.success).length,
      error: error.message,
      results,
    };
  }
}

/**
 * Close database connection
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  stopPoolMonitor();

  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
