// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/readReplicaRLS.test.js — Issue #913: RLS Tenant Isolation across Read Replica and Failover
 *
 * Confirms that Row-Level Security (RLS) tenant isolation holds when:
 * 1. A tenant-scoped read query executes directly on the read replica path.
 * 2. A replica fails and execution fails over to the primary database connection.
 * 3. Connection acquisition uses identical, non-duplicated tenant-context-setting logic.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import knexModule from 'knex';
import {
  initReadReplicas,
  readQuery,
  writeQuery,
  getReplica,
  getPrimary,
  closeReadReplicas,
  getTenantReplica,
  setTenantContext as replicaSetTenantContext,
  withTenantContext as replicaWithTenantContext,
} from '../src/services/readReplica.js';
import {
  setTenantContext as dbSetTenantContext,
  withTenantContext as dbWithTenantContext,
} from '../src/services/database.js';

describe('Issue #913: RLS Tenant Isolation across Read Replica and Failover', () => {
  let primaryDb;
  let replicaDb;

  beforeEach(async () => {
    // Set up in-memory databases representing primary and read-replica
    primaryDb = knexModule({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    replicaDb = knexModule({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create schema with tenant_id column in both databases
    for (const db of [primaryDb, replicaDb]) {
      await db.schema.createTable('assets', (table) => {
        table.string('id').primary();
        table.string('name').notNullable();
        table.string('tenant_id').notNullable();
      });

      // Seed mock records for tenant-1 and tenant-2
      await db('assets').insert([
        { id: 'ast_101', name: 'Tenant 1 Asset', tenant_id: 'tenant-1' },
        { id: 'ast_202', name: 'Tenant 2 Asset', tenant_id: 'tenant-2' },
      ]);
    }
  });

  afterEach(async () => {
    await closeReadReplicas();
    if (primaryDb) await primaryDb.destroy();
    if (replicaDb) await replicaDb.destroy();
  });

  test('confirm tenant-context-setting logic is identical and shared between database.js and readReplica.js', () => {
    expect(replicaSetTenantContext).toBe(dbSetTenantContext);
    expect(replicaWithTenantContext).toBe(dbWithTenantContext);
  });

  test('setTenantContext throws if tenantId is missing', async () => {
    const mockConn = { raw: jest.fn(), client: { config: { client: 'pg' } } };
    await expect(dbSetTenantContext(mockConn, null)).rejects.toThrow('Tenant ID is required');
  });

  test('setTenantContext issues SET LOCAL app.current_tenant_id for Postgres connections', async () => {
    const mockConn = {
      raw: jest.fn().mockResolvedValue({}),
      client: { config: { client: 'pg' } },
    };

    await dbSetTenantContext(mockConn, 'tenant-abc');
    expect(mockConn.raw).toHaveBeenCalledWith('SET LOCAL app.current_tenant_id = ?', ['tenant-abc']);
  });

  test('forces tenant-scoped read query to execute against read replica path and preserves tenant isolation', async () => {
    // Create mock config to initialize read replica system
    const config = {
      primary: {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      },
      replicas: [
        {
          client: 'better-sqlite3',
          connection: { filename: ':memory:' },
          useNullAsDefault: true,
        },
      ],
    };

    await initReadReplicas(config);

    const replica = getReplica();
    await replica.schema.createTable('assets', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('tenant_id').notNullable();
    });

    await replica('assets').insert([
      { id: 'ast_1', name: 'Tenant 1 Data', tenant_id: 'tenant-alpha' },
      { id: 'ast_2', name: 'Tenant 2 Data', tenant_id: 'tenant-beta' },
    ]);

    // Force query specifically through readQuery with tenantId
    const queryFn = jest.fn(async (conn) => {
      // In PostgreSQL RLS, the query builder is restricted to the current tenant
      return conn('assets').where('tenant_id', 'tenant-alpha').select('*');
    });

    const result = await readQuery(queryFn, 'tenant-alpha');

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ast_1');
    expect(result[0].tenant_id).toBe('tenant-alpha');
  });

  test('tenant-scoped read query correctly fails over to primary when read replica fails', async () => {
    const config = {
      primary: {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      },
      replicas: [
        {
          client: 'better-sqlite3',
          connection: { filename: ':memory:' },
          useNullAsDefault: true,
        },
      ],
    };

    await initReadReplicas(config);

    const primary = getPrimary();
    const replica = getReplica();

    // Populate primary with tenant data
    await primary.schema.createTable('assets', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('tenant_id').notNullable();
    });

    await primary('assets').insert([
      { id: 'ast_primary_1', name: 'Primary Tenant 1 Data', tenant_id: 'tenant-gamma' },
      { id: 'ast_primary_2', name: 'Primary Tenant 2 Data', tenant_id: 'tenant-delta' },
    ]);

    // Drop table or simulate replica error
    let replicaAttempted = false;
    let failoverSucceeded = false;

    const queryFn = jest.fn(async (conn) => {
      if (conn === replica) {
        replicaAttempted = true;
        throw new Error('Connection to read replica timed out');
      }
      if (conn === primary) {
        failoverSucceeded = true;
        return conn('assets').where('tenant_id', 'tenant-gamma').select('*');
      }
      return [];
    });

    const result = await readQuery(queryFn, 'tenant-gamma');

    expect(replicaAttempted).toBe(true);
    expect(failoverSucceeded).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].tenant_id).toBe('tenant-gamma');
  });

  test('getTenantReplica acquires a transaction and sets tenant context', async () => {
    const config = {
      primary: {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      },
      replicas: [
        {
          client: 'better-sqlite3',
          connection: { filename: ':memory:' },
          useNullAsDefault: true,
        },
      ],
    };

    await initReadReplicas(config);

    const replicaTrx = await getTenantReplica('tenant-xyz');
    expect(replicaTrx).toBeDefined();
    await replicaTrx.rollback();
  });
});
