/**
 * Issue #897: mv_historical_vault_metrics refresh cadence & staleness
 *
 * Proves the documented refresh strategy (docs/VAULT_METRICS_REFRESH.md):
 * a mutation of the underlying `transactions` table is reflected in the
 * materialized view after the scheduled `REFRESH MATERIALIZED VIEW
 * CONCURRENTLY`, within the documented staleness bound.
 *
 * Live PostgreSQL assertions run against TEST_POSTGRES_URL / DATABASE_URL, an
 * ephemeral Docker container, or are skipped (same convention as
 * postgresTriggers.test.js) when no PostgreSQL is reachable. The strategy
 * unit tests (statement used, cadence config, non-PG no-op) always run.
 */

import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import pg from 'pg';
import { execSync } from 'child_process';
import {
  MATERIALIZED_VIEW_NAME,
  DEFAULT_MV_REFRESH_INTERVAL_MS,
  getVaultMetricsRefreshIntervalMs,
  refreshVaultMetrics,
  startVaultMetricsRefreshCron,
} from '../src/services/vaultMetricsRefresh.js';

const { Client } = pg;

describe('Issue #897: vault metrics refresh strategy (unit level, always runs)', () => {
  test('default cadence is 1 hour and env can tune it', () => {
    expect(DEFAULT_MV_REFRESH_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(getVaultMetricsRefreshIntervalMs({})).toBe(DEFAULT_MV_REFRESH_INTERVAL_MS);
    expect(getVaultMetricsRefreshIntervalMs({ MV_REFRESH_INTERVAL_MS: '300000' })).toBe(300000);
    // Invalid values fall back to the documented default
    expect(getVaultMetricsRefreshIntervalMs({ MV_REFRESH_INTERVAL_MS: 'abc' })).toBe(DEFAULT_MV_REFRESH_INTERVAL_MS);
    expect(getVaultMetricsRefreshIntervalMs({ MV_REFRESH_INTERVAL_MS: '-5' })).toBe(DEFAULT_MV_REFRESH_INTERVAL_MS);
    expect(getVaultMetricsRefreshIntervalMs({ MV_REFRESH_INTERVAL_MS: '0' })).toBe(DEFAULT_MV_REFRESH_INTERVAL_MS);
  });

  test('the cron issues exactly the documented CONCURRENTLY statement on PostgreSQL', async () => {
    const raw = jest.fn(async () => ({ rows: [] }));
    const fakePgDb = { client: { config: { client: 'pg' } }, raw };
    const logger = { info: () => {}, error: () => {} };

    const result = await refreshVaultMetrics(fakePgDb, logger);

    expect(result.refreshed).toBe(true);
    expect(result.view).toBe(MATERIALIZED_VIEW_NAME);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][0]).toBe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY ${MATERIALIZED_VIEW_NAME}`
    );
  });

  test('non-PostgreSQL backends (SQLite live VIEW) are correctly skipped', async () => {
    const raw = jest.fn();
    const fakeSqliteDb = { client: { config: { client: 'better-sqlite3' } }, raw };

    const result = await refreshVaultMetrics(fakeSqliteDb);

    expect(result.refreshed).toBe(false);
    expect(raw).not.toHaveBeenCalled();
  });

  test('the scheduled cron fires on the configured cadence and survives DB errors', async () => {
    jest.useFakeTimers();
    try {
      const info = jest.fn();
      const error = jest.fn();
      let calls = 0;
      const getDb = () => {
        calls += 1;
        if (calls === 1) throw new Error('Database not initialized'); // must not crash the cron
        return { client: { config: { client: 'pg' } }, raw: async () => ({ rows: [] }) };
      };

      const handle = startVaultMetricsRefreshCron(getDb, { info, error }, 1000);
      expect(error).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000); // first tick: getDb throws → logged
      await Promise.resolve();
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Failed to refresh materialized view' })
      );

      jest.advanceTimersByTime(1000); // second tick: succeeds
      await Promise.resolve();
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ view: MATERIALIZED_VIEW_NAME }),
        'Materialized view refreshed in background'
      );

      clearInterval(handle);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Issue #897: live PostgreSQL staleness verification', () => {
  let client;
  let containerName = null;
  let live = false;
  let connectionString = process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!connectionString) {
      const port = Math.floor(Math.random() * (5900 - 5500) + 5500);
      containerName = `rwa-ephemeral-pg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      try {
        execSync(
          `docker run -d --name ${containerName} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=test_mv_refresh -p ${port}:5432 postgres:16-alpine`,
          { stdio: 'ignore' }
        );
        connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/test_mv_refresh`;
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
      } catch {
        connectionString = 'postgresql://rwa_user:rwa_password@127.0.0.1:5432/rwa_marketplace';
        containerName = null;
      }
    }

    try {
      client = new Client({ connectionString });
      await client.connect();
    } catch (connErr) {
      console.warn('PostgreSQL connection not reachable, skipping live DB assertions:', connErr.message);
      client = null;
      return;
    }

    // Schema exactly as created by migrations/20260726000004_create_mv_vault_metrics.js
    await client.query(`
      DROP TABLE IF EXISTS transactions CASCADE;
      DROP MATERIALIZED VIEW IF EXISTS ${MATERIALIZED_VIEW_NAME} CASCADE;

      CREATE TABLE transactions (
        id SERIAL PRIMARY KEY,
        contract_id VARCHAR(100) NOT NULL,
        total_amount NUMERIC(20, 2) DEFAULT 0,
        shares_purchased NUMERIC(20, 8) DEFAULT 0,
        buyer_address VARCHAR(100),
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE MATERIALIZED VIEW ${MATERIALIZED_VIEW_NAME} AS
      SELECT
        contract_id,
        SUM(total_amount) as historical_volume,
        SUM(shares_purchased) as historical_shares,
        COUNT(DISTINCT buyer_address) as historical_unique_buyers,
        COUNT(id) as historical_tx_count
      FROM transactions
      WHERE created_at < NOW() - INTERVAL '24 hours'
        AND status = 'completed'
      GROUP BY contract_id;

      CREATE UNIQUE INDEX idx_mv_historical_vault_metrics_contract_id
      ON ${MATERIALIZED_VIEW_NAME} (contract_id);
    `);
    live = true;
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
    if (containerName) {
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch {
        // Ephemeral container cleanup
      }
    }
  });

  const knexStyleDb = {
    client: { config: { client: 'pg' } },
    raw: (sql) => client.query(sql),
  };
  const quietLogger = { info: () => {}, error: () => {} };

  test('a mutation of the underlying table is reflected after refresh, within the documented bound', async () => {
    if (!live) return;

    // Seed: one aged, completed transaction (outside the 24h window)
    await client.query(
      `INSERT INTO transactions (contract_id, total_amount, shares_purchased, buyer_address, status, created_at)
       VALUES ('C_REFRESH_TEST', 100, 10, '0xabc', 'completed', NOW() - INTERVAL '30 days')`
    );

    // Mutation: a second aged, completed transaction
    const mutatedAt = Date.now();
    await client.query(
      `INSERT INTO transactions (contract_id, total_amount, shares_purchased, buyer_address, status, created_at)
       VALUES ('C_REFRESH_TEST', 250, 25, '0xdef', 'completed', NOW() - INTERVAL '7 days')`
    );

    // Pre-refresh: the view still serves the old snapshot (stale by design)
    let snap = await client.query(
      `SELECT historical_volume FROM ${MATERIALIZED_VIEW_NAME} WHERE contract_id = 'C_REFRESH_TEST'`
    );
    expect(snap.rows).toHaveLength(0); // view was empty at creation

    // The exact statement the production cron issues
    const result = await refreshVaultMetrics(knexStyleDb, quietLogger);
    expect(result.refreshed).toBe(true);

    // Post-refresh: mutation is visible
    snap = await client.query(
      `SELECT historical_volume, historical_shares, historical_tx_count
       FROM ${MATERIALIZED_VIEW_NAME} WHERE contract_id = 'C_REFRESH_TEST'`
    );
    expect(snap.rows).toHaveLength(1);
    expect(Number(snap.rows[0].historical_volume)).toBe(350);
    expect(Number(snap.rows[0].historical_shares)).toBe(35);
    expect(Number(snap.rows[0].historical_tx_count)).toBe(2);

    // Staleness bound: mutation → visible took only the refresh duration,
    // far below the documented bound of one refresh interval (1 hour).
    const stalenessMs = Date.now() - mutatedAt;
    expect(stalenessMs).toBeLessThan(DEFAULT_MV_REFRESH_INTERVAL_MS);
    expect(result.durationMs).toBeLessThan(DEFAULT_MV_REFRESH_INTERVAL_MS);
  });

  test('transactions that are recent (<24h) or not completed stay out of the view', async () => {
    if (!live) return;

    await client.query(
      `INSERT INTO transactions (contract_id, total_amount, shares_purchased, buyer_address, status, created_at)
       VALUES ('C_RECENT_TX', 999, 99, '0xrecent', 'completed', NOW() - INTERVAL '1 hour')`
    );
    await client.query(
      `INSERT INTO transactions (contract_id, total_amount, shares_purchased, buyer_address, status, created_at)
       VALUES ('C_FAILED_TX', 888, 88, '0xfailed', 'failed', NOW() - INTERVAL '30 days')`
    );

    await refreshVaultMetrics(knexStyleDb, quietLogger);

    const snap = await client.query(
      `SELECT contract_id FROM ${MATERIALIZED_VIEW_NAME} WHERE contract_id IN ('C_RECENT_TX', 'C_FAILED_TX')`
    );
    expect(snap.rows).toHaveLength(0);
  });

  test('CONCURRENTLY refresh is repeatable (unique index requirement from the migration holds)', async () => {
    if (!live) return;

    // Second consecutive concurrent refresh must succeed and stay consistent
    const result = await refreshVaultMetrics(knexStyleDb, quietLogger);
    expect(result.refreshed).toBe(true);

    const snap = await client.query(
      `SELECT historical_volume FROM ${MATERIALIZED_VIEW_NAME} WHERE contract_id = 'C_REFRESH_TEST'`
    );
    expect(Number(snap.rows[0].historical_volume)).toBe(350);
  });
});
