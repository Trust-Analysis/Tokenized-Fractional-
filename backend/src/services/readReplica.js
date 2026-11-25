// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/readReplica.js — Issue #317: Read Replica Support
 *
 * Distributes read queries to replicas while routing writes to the primary.
 * Includes health monitoring, automatic failover, and lag tracking.
 */

import knex from 'knex';
import { logger } from '../../logger.js';

let primaryDb = null;
let replicas = [];
let replicaIndex = 0;
let healthCheckInterval = null;

/**
 * Initialize read replica connections
 * @param {Object} config - Primary and replica connection configs
 * @param {Object} config.primary - Primary database knex config
 * @param {Array<Object>} config.replicas - Array of replica knex configs
 */
export async function initReadReplicas(config) {
  const { primary, replicas: replicaConfigs = [] } = config;

  // Initialize primary connection
  primaryDb = knex(primary);
  await primaryDb.raw('SELECT 1');
  logger.info('Primary connection established');

  // Initialize replica connections
  for (const replicaConfig of replicaConfigs) {
    try {
      const replica = knex(replicaConfig);
      await replica.raw('SELECT 1');
      replicas.push({
        db: replica,
        healthy: true,
        lastCheck: Date.now(),
        lagMs: 0,
      });
      logger.info('Replica connection established');
    } catch (error) {
      logger.warn({ err: error }, 'Failed to connect replica');
    }
  }

  // Start health monitoring
  startHealthCheck();

  logger.info({ replicaCount: replicas.length }, 'Read replica system initialized');
}

/**
 * Get the primary database connection (for writes)
 * @returns {import('knex').Knex}
 */
export function getPrimary() {
  if (!primaryDb) {
    throw new Error('Read replica system not initialized');
  }
  return primaryDb;
}

/**
 * Get a healthy replica connection for reads (round-robin)
 * Falls back to primary if no healthy replicas available
 * @returns {import('knex').Knex}
 */
export function getReplica() {
  const healthyReplicas = replicas.filter(r => r.healthy);

  if (healthyReplicas.length === 0) {
    logger.warn('No healthy replicas, falling back to primary');
    return primaryDb;
  }

  // Round-robin selection
  const replica = healthyReplicas[replicaIndex % healthyReplicas.length];
  replicaIndex = (replicaIndex + 1) % healthyReplicas.length;

  return replica.db;
}

/**
 * Execute a read query on a replica with automatic failover
 * @param {Function} queryFn - Function that takes a knex connection and returns a query
 * @returns {Promise<any>} Query result
 */
export async function readQuery(queryFn) {
  const healthyReplicas = replicas.filter(r => r.healthy);

  // Try replicas first
  for (const replica of healthyReplicas) {
    try {
      const result = await queryFn(replica.db);
      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Replica query failed, trying next');
      replica.healthy = false;
    }
  }

  // Fallback to primary
  logger.warn('All replicas failed, falling back to primary');
  return queryFn(primaryDb);
}

/**
 * Execute a write query on the primary
 * @param {Function} queryFn - Function that takes a knex connection and returns a query
 * @returns {Promise<any>} Query result
 */
export async function writeQuery(queryFn) {
  return queryFn(primaryDb);
}

/**
 * Get replica health status
 * @returns {Object} Health status of all connections
 */
export function getReplicaHealth() {
  return {
    primary: primaryDb ? 'connected' : 'disconnected',
    replicas: replicas.map((r, i) => ({
      index: i,
      healthy: r.healthy,
      lagMs: r.lagMs,
      lastCheck: r.lastCheck,
    })),
    healthyCount: replicas.filter(r => r.healthy).length,
    totalCount: replicas.length,
  };
}

/**
 * Start periodic health checks for replicas
 */
function startHealthCheck() {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    for (const replica of replicas) {
      try {
        const start = Date.now();
        await replica.db.raw('SELECT 1');
        replica.lagMs = Date.now() - start;
        replica.healthy = true;
        replica.lastCheck = Date.now();
      } catch (error) {
        replica.healthy = false;
        replica.lastCheck = Date.now();
        logger.warn({ err: error }, 'Replica health check failed');
      }
    }
  }, 10000); // Check every 10 seconds

  process.on('SIGTERM', () => stopHealthCheck());
}

/**
 * Stop health check interval
 */
function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Close all connections
 */
export async function closeReadReplicas() {
  stopHealthCheck();

  for (const replica of replicas) {
    try {
      await replica.db.destroy();
    } catch (e) { /* ignore */ }
  }
  replicas = [];

  if (primaryDb) {
    await primaryDb.destroy();
    primaryDb = null;
  }
}
