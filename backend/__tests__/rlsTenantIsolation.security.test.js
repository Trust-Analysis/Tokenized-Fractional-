/**
 * ============================================================================
 * SECURITY REGRESSION TEST (Issue #898)
 * RLS multi-tenancy: tenant isolation under a SHARED connection pool
 * ============================================================================
 *
 * Why this test exists
 * --------------------
 * The multi-tenancy RLS migration
 * (backend/migrations/20260726000002_enable_multi_tenancy_rls.js) relies on
 * the PostgreSQL session variable `app.current_tenant_id` being set via
 * `SET LOCAL` inside a per-request transaction (see
 * backend/src/middleware/tenantContext.js). With a shared knex connection pool,
 * connections are reused across requests for DIFFERENT tenants — a notoriously
 * easy place to introduce a cross-tenant data leak if the tenant context were
 * ever set at connection-acquisition time (session-level `SET`) instead of
 * transaction-level (`SET LOCAL`), because `SET LOCAL` is the only form that
 * reverts automatically when the transaction ends.
 *
 * This test proves — against a REAL PostgreSQL instance — that:
 *   1. Interleaved queries for two different tenants, drawn from the same
 *      small pool (max 2 connections), each only ever see their own tenant's
 *      rows, no matter how connections are reused.
 *   2. After a tenant-scoped transaction completes, a subsequent query on the
 *      same pooled connection WITHOUT tenant context sees ZERO rows
 *      (fail-closed — no stale-context leak).
 *   3. The real `tenantContextMiddleware` isolates interleaved simulated
 *      requests that share one pool.
 *   4. The `system_admin` bypass policy behaves as designed.
 *
 * The test applies the REAL migration (not a copy of its policies) so it can
 * never silently drift from production DDL. Because the knex connection is the
 * table owner (which normally bypasses RLS), the test enables
 * `FORCE ROW LEVEL SECURITY` after seeding fixtures so the assertions actually
 * exercise the policies.
 *
 * If no PostgreSQL is reachable (no TEST_POSTGRES_URL / DATABASE_URL and no
 * Docker for the ephemeral container), live assertions are skipped with a
 * warning — the same convention used by postgresTriggers.test.js.
 *
 * Run:
 *   cd backend && npm test -- rlsTenantIsolation
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import knexModule from 'knex';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import rlsMigration from '../migrations/20260726000002_enable_multi_tenancy_rls.js';
import { tenantContextMiddleware } from '../src/middleware/tenantContext.js';

const { Client } = pg;

const TENANT_A = 'tnt_isolation_test_a';
const TENANT_B = 'tnt_isolation_test_b';

// Tables covered by the RLS migration.
const RLS_TABLES = ['assets', 'api_keys', 'transactions', 'time_window_events'];

let containerName = null;
let connectionString = process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL;
let db = null; // knex instance with a SHARED pool (max 2) to force connection reuse
let live = false; // becomes true only when a real PostgreSQL is reachable

describe('SECURITY REGRESSION (Issue #898): RLS tenant isolation under a shared connection pool', () => {
  beforeAll(async () => {
    // 1. Bootstrap an ephemeral PostgreSQL (Docker) when no connection string
    //    is supplied, mirroring postgresTriggers.test.js.
    if (!connectionString) {
      const port = Math.floor(Math.random() * (5900 - 5500) + 5500);
      containerName = `rwa-ephemeral-pg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      try {
        execSync(
          `docker run -d --name ${containerName} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=test_rls -p ${port}:5432 postgres:16-alpine`,
          { stdio: 'ignore' }
        );
        connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/test_rls`;

        let ready = false;
        const startTime = Date.now();
        while (!ready && Date.now() - startTime < 15000) {
          try {
            const probe = new Client({ connectionString });
            await probe.connect();
            await probe.end();
            ready = true;
          } catch {
            await new Promise((res) => setTimeout(res, 500));
          }
        }
      } catch (err) {
        console.warn(
          'Issue #898: could not launch ephemeral Docker container:',
          err.message
        );
      }
    }

    // 2. Probe connectivity. Without a live database the live assertions are
    //    skipped (warn) instead of failing — consistent with repo precedent.
    try {
      const probe = new Client({ connectionString });
      await probe.connect();
      await probe.end();
    } catch (connErr) {
      console.warn(
        `Issue #898 SECURITY TEST: PostgreSQL not reachable (${connErr.message}). ` +
          'RLS tenant-isolation assertions are SKIPPED. Provide TEST_POSTGRES_URL or Docker to run them.'
      );
      return;
    }

    // 3. Knex with a deliberately SMALL shared pool so that connections are
    //    inevitably reused across the two tenants' interleaved queries.
    db = knexModule({
      client: 'pg',
      connection: connectionString,
      pool: { min: 1, max: 2 },
    });

    // 4. Minimal stub schema for the tables the migration alters, then run the
    //    REAL migration so the policies under test are the production ones.
    for (const tableName of RLS_TABLES) {
      await db.schema.dropTableIfExists(tableName);
      await db.schema.createTable(tableName, (table) => {
        table.increments('id').primary();
        table.string('contract_id');
        table.integer('amount').defaultTo(0);
      });
    }
    await db.schema.dropTableIfExists('tenants');
    await rlsMigration.up(db);

    // 5. Seed tenants and per-tenant rows. At this point RLS is enabled but
    //    NOT forced, so the owner (this connection) can still seed freely.
    await db('tenants').insert([
      { id: TENANT_A, name: 'Tenant A', status: 'active', billing_plan: 'standard' },
      { id: TENANT_B, name: 'Tenant B', status: 'active', billing_plan: 'enterprise' },
    ]);
    for (let i = 0; i < 5; i += 1) {
      await db('assets').insert({ contract_id: `contract-a-${i}`, tenant_id: TENANT_A, amount: i });
      await db('assets').insert({ contract_id: `contract-b-${i}`, tenant_id: TENANT_B, amount: i });
    }

    // 6. FORCE RLS so the owner connection used by every assertion below is
    //    itself subject to the policies (otherwise RLS would be a no-op for
    //    the table owner and the test would prove nothing).
    for (const tableName of RLS_TABLES) {
      await db.raw(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;`);
    }

    live = true;
  }, 60000);

  afterAll(async () => {
    if (db) {
      for (const tableName of RLS_TABLES) {
        await db.raw(`ALTER TABLE ${tableName} NO FORCE ROW LEVEL SECURITY;`).catch(() => {});
      }
      await rlsMigration.down(db).catch(() => {});
      await db.destroy();
      db = null;
    }
    if (containerName) {
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }
  });

  /**
   * The exact connection-scoping pattern the middleware uses: a transaction
   * with `SET LOCAL app.current_tenant_id = <tenant>`. `SET LOCAL` reverts at
   * COMMIT/ROLLBACK, so the pooled connection is returned to the pool with no
   * tenant context — this is what makes pool reuse safe.
   */
  async function tenantScopedSelectAssets(tenantId) {
    const trx = await db.transaction();
    try {
      await trx.raw(`SET LOCAL app.current_tenant_id = ?`, [tenantId]);
      const rows = await trx('assets').select('contract_id').orderBy('contract_id');
      await trx.commit();
      return rows;
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }

  test('interleaved queries for two tenants on one shared pool only ever see their own rows', async () => {
    if (!live) return;

    // Many iterations with a max-2 pool guarantee both pooled connections are
    // recycled across tenants in alternating order.
    for (let i = 0; i < 25; i += 1) {
      const [rowsA, rowsB] = await Promise.all([
        tenantScopedSelectAssets(TENANT_A),
        tenantScopedSelectAssets(TENANT_B),
      ]);

      expect(rowsA.map((r) => r.contract_id)).toEqual([
        'contract-a-0', 'contract-a-1', 'contract-a-2', 'contract-a-3', 'contract-a-4',
      ]);
      expect(rowsB.map((r) => r.contract_id)).toEqual([
        'contract-b-0', 'contract-b-1', 'contract-b-2', 'contract-b-3', 'contract-b-4',
      ]);
    }
  });

  test('queries WITHOUT tenant context fail closed: zero rows, no stale-context leak from the pool', async () => {
    if (!live) return;

    // Warm the pool with a tenant-scoped transaction first…
    const scoped = await tenantScopedSelectAssets(TENANT_A);
    expect(scoped).toHaveLength(5);

    // …then run an unscoped query through the same pool. If the tenant
    // context had leaked (e.g. session-level SET instead of SET LOCAL), this
    // would return Tenant A's rows.
    const unscoped = await db('assets').select('contract_id');
    expect(unscoped).toEqual([]);
  });

  test('tenantContextMiddleware isolates interleaved requests that share one pool', async () => {
    if (!live) return;

    const runThroughMiddleware = async (tenantId) => {
      const handlers = {};
      const req = { headers: { 'x-tenant-id': tenantId }, user: null };
      const res = {
        on: (event, cb) => {
          handlers[event] = cb;
        },
      };

      await new Promise((resolve, reject) => {
        tenantContextMiddleware(db)(req, res, (err) => (err ? reject(err) : resolve()));
      });

      expect(req.tenantId).toBe(tenantId);
      const rows = await req.db('assets').select('contract_id').orderBy('contract_id');

      // Emulate Express finishing the response so the middleware releases its
      // transaction back to the pool.
      await handlers.finish?.();
      return rows;
    };

    // Interleave two tenants through the real middleware, repeatedly.
    for (let i = 0; i < 10; i += 1) {
      const [rowsA, rowsB] = await Promise.all([
        runThroughMiddleware(TENANT_A),
        runThroughMiddleware(TENANT_B),
      ]);

      expect(rowsA.every((r) => r.contract_id.startsWith('contract-a-'))).toBe(true);
      expect(rowsA).toHaveLength(5);
      expect(rowsB.every((r) => r.contract_id.startsWith('contract-b-'))).toBe(true);
      expect(rowsB).toHaveLength(5);
    }

    // After the middleware-driven traffic, the pool must carry no context.
    const unscoped = await db('assets').select('contract_id');
    expect(unscoped).toEqual([]);
  });

  test('system_admin bypass policy sees all tenants rows (intended behavior)', async () => {
    if (!live) return;

    const trx = await db.transaction();
    try {
      await trx.raw(`SET LOCAL app.current_tenant_id = 'system_admin'`);
      const rows = await trx('assets').select('contract_id');
      expect(rows).toHaveLength(10); // 5 tenant A + 5 tenant B
      await trx.commit();
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  });
});
