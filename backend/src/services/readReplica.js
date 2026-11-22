// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/readReplica.js — Issue #317: Read Replica Support
 *
 * Distributes read queries to replicas while routing writes to the primary.
 * Includes health monitoring, automatic failover, and lag tracking.
 *
 * Tenant-context note (Issue #898): RLS-enabled tables require
 * `app.current_tenant_id` to be set per query, not per connection. The plain
 * readQuery()/writeQuery() helpers below intentionally carry NO tenant context
 * (queries against RLS tables fail closed and return no rows). Use the
 * readQueryForTenant()/writeQueryForTenant() helpers — or withTenantContext()
 * directly — for tenant-scoped access; they set the context with `SET LOCAL`
 * inside a transaction, which reverts automatically when the transaction
 * ends, so a pooled/replica connection can never leak one tenant's context to
 * the next query that reuses it.
 */

import knex from 'knex';
import { setTenantContext, withTenantContext } from './database.js';

export { setTenantContext, withTenantContext };

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
  await clearTenantContext(primaryDb);
  console.log('[ReadReplica] Primary connection established');

  // Initialize replica connections
  for (const replicaConfig of replicaConfigs) {
    try {
      const replica = knex(replicaConfig);
      await replica.raw('SELECT 1');
      await clearTenantContext(replica);
      replicas.push({
        db: replica,
        healthy: true,
        lastCheck: Date.now(),
        lagMs: 0,
      });
      console.log('[ReadReplica] Replica connection established');
    } catch (error) {
      console.warn('[ReadReplica] Failed to connect replica:', error.message);
    }
  }

  // Start health monitoring
  startHealthCheck();

  console.log(`[ReadReplica] Initialized with ${replicas.length} replicas`);
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
    console.warn('[ReadReplica] No healthy replicas, falling back to primary');
    return primaryDb;
  }

  // Round-robin selection
  const replica = healthyReplicas[replicaIndex % healthyReplicas.length];
  replicaIndex = (replicaIndex + 1) % healthyReplicas.length;

  return replica.db;
}

/**
 * Whether a knex instance targets PostgreSQL (the only backend with RLS).
 * @param {import('knex').Knex} db
 * @returns {boolean}
 */
function isPostgres(db) {
  return Boolean(db && db.client && db.client.config && db.client.config.client === 'pg');
}

/**
 * Issue #898: Defensive reset of the RLS tenant context on a pooled
 * connection at acquisition time. `SET LOCAL` already scopes the context to a
 * transaction, but this guarantees a freshly-acquired connection (which may
 * have been recycled from a previous session, e.g. through a pooler running
 * in statement/session mode) starts with no tenant context at all.
 * @param {import('knex').Knex} db
 */
async function clearTenantContext(db) {
  if (isPostgres(db)) {
    await db.raw(`SET app.current_tenant_id = ''`);
  }
}

/**
 * Issue #898: Execute `work` with the RLS tenant context applied safely.
 *
 * The context is set with `SET LOCAL` INSIDE a transaction, so it is
 * guaranteed to be reset when the transaction ends — even though the
 * underlying connection returns to a shared pool and may immediately serve a
 * different tenant's query. Never set `app.current_tenant_id` with a plain
 * (session-level) `SET` on a pooled connection.
 *
 * @param {import('knex').Knex} db - Knex instance (primary, replica, or pool-wrapped)
 * @param {string} tenantId - Tenant to scope the work to
 * @param {(trx: import('knex').Knex.Transaction) => Promise<any>} work - Query work receiving a tenant-scoped connection
 * @returns {Promise<any>}
 */
export async function withTenantContext(db, tenantId, work) {
  if (!isPostgres(db)) {
    // SQLite and other dev backends have no RLS; scope is the caller's job.
    return work(db);
  }

  const trx = await db.transaction();
  try {
    await trx.raw('SET LOCAL app.current_tenant_id = ?', [tenantId]);
    const result = await work(trx);
    await trx.commit();
    return result;
  } catch (error) {
    await trx.rollback();
    throw error;
  }
}

/**
 * Issue #898: Tenant-scoped read on a replica with automatic failover.
 * Runs the query inside a transaction with `SET LOCAL app.current_tenant_id`,
 * so RLS policies apply on the exact connection that serves the query and the
 * context cannot outlive it.
 * @param {string} tenantId
 * @param {(trx: import('knex').Knex.Transaction) => Promise<any>} queryFn
 * @returns {Promise<any>} Query result
 */
export async function readQueryForTenant(tenantId, queryFn) {
  const healthyReplicas = replicas.filter(r => r.healthy);

  for (const replica of healthyReplicas) {
    try {
      return await withTenantContext(replica.db, tenantId, (trx) => queryFn(trx));
    } catch (error) {
      console.warn('[ReadReplica] Tenant-scoped replica query failed, trying next:', error.message);
      replica.healthy = false;
    }
  }

  return withTenantContext(primaryDb, tenantId, (trx) => queryFn(trx));
}

/**
 * Issue #898: Tenant-scoped write on the primary.
 * @param {string} tenantId
 * @param {(trx: import('knex').Knex.Transaction) => Promise<any>} queryFn
 * @returns {Promise<any>}
 */
export async function writeQueryForTenant(tenantId, queryFn) {
  return withTenantContext(primaryDb, tenantId, (trx) => queryFn(trx));
}

/**
 * Execute a read query on a replica with automatic failover
 * @param {Function} queryFn - Function that takes a knex connection and returns a query
 * @param {string} [tenantId] - Optional tenant identifier to enforce RLS
 * @returns {Promise<any>} Query result
 */
export async function readQuery(queryFn, tenantId = null) {
  const healthyReplicas = replicas.filter(r => r.healthy);

  // Try replicas first
  for (const replica of healthyReplicas) {
    try {
      if (tenantId) {
        return await withTenantContext(replica.db, tenantId, queryFn);
      }
      const result = await queryFn(replica.db);
      return result;
    } catch (error) {
      console.warn('[ReadReplica] Replica query failed, trying next:', error.message);
      replica.healthy = false;
    }
  }

  // Fallback to primary
  console.warn('[ReadReplica] All replicas failed, falling back to primary');
  if (tenantId) {
    return await withTenantContext(primaryDb, tenantId, queryFn);
  }
  return queryFn(primaryDb);
}

/**
 * Execute a write query on the primary, ensuring tenant context is preserved if provided.
 * @param {Function} queryFn - Function that takes a knex connection and returns a query
 * @param {string} [tenantId] - Optional tenant identifier
 * @returns {Promise<any>} Query result
 */
export async function writeQuery(queryFn, tenantId = null) {
  if (tenantId) {
    return withTenantContext(primaryDb, tenantId, queryFn);
  }
  return queryFn(primaryDb);
}

/**
 * Acquire a tenant-scoped connection/transaction from a replica (or primary on fallback).
 * @param {string} tenantId
 * @returns {Promise<import('knex').Knex.Transaction>}
 */
export async function getTenantReplica(tenantId) {
  const replicaDb = getReplica();
  const trx = await replicaDb.transaction();
  await setTenantContext(trx, tenantId);
  return trx;
}

/**
 * Acquire a tenant-scoped connection/transaction from the primary database.
 * @param {string} tenantId
 * @returns {Promise<import('knex').Knex.Transaction>}
 */
export async function getTenantPrimary(tenantId) {
  const primary = getPrimary();
  const trx = await primary.transaction();
  await setTenantContext(trx, tenantId);
  return trx;
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
        console.warn('[ReadReplica] Replica health check failed:', error.message);
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
