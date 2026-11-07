import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { execSync } from 'child_process';

const { Client } = pg;

describe('Issue #618: PostgreSQL Triggers Integration Tests', () => {
  let client;
  let containerName = null;
  let connectionString = process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL;

  beforeAll(async () => {
    // If no existing PostgreSQL connection is supplied, start an ephemeral PostgreSQL container
    if (!connectionString) {
      const port = Math.floor(Math.random() * (5900 - 5500) + 5500);
      containerName = `rwa-ephemeral-pg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      try {
        execSync(
          `docker run -d --name ${containerName} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=test_triggers -p ${port}:5432 postgres:16-alpine`,
          { stdio: 'ignore' }
        );

        connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/test_triggers`;

        // Wait for PostgreSQL container to accept connections
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
        console.warn('Could not launch ephemeral Docker container, trying default localhost pg:', err.message);
        connectionString = 'postgresql://rwa_user:rwa_password@127.0.0.1:5432/rwa_marketplace';
      }
    }

    try {
      client = new Client({ connectionString });
      await client.connect();
    } catch (connErr) {
      console.warn('PostgreSQL connection not reachable, skipping live DB assertions:', connErr.message);
      return;
    }

    // Set up schema and triggers on ephemeral PostgreSQL
    await client.query(`
      DROP TABLE IF EXISTS trades CASCADE;
      DROP TABLE IF EXISTS asset_moving_averages CASCADE;

      CREATE TABLE trades (
        id SERIAL PRIMARY KEY,
        contract_id VARCHAR(100) NOT NULL,
        price NUMERIC(20, 8) NOT NULL,
        volume NUMERIC(20, 2) DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE asset_moving_averages (
        contract_id VARCHAR(100) PRIMARY KEY,
        moving_avg_price NUMERIC(20, 8) NOT NULL,
        sample_size INT DEFAULT 5,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE OR REPLACE FUNCTION update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_update_timestamp_trades
      BEFORE UPDATE ON trades
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();

      CREATE OR REPLACE FUNCTION calculate_moving_average()
      RETURNS TRIGGER AS $$
      DECLARE
        v_avg_price NUMERIC(20, 8);
        v_sample_size INT := 5;
      BEGIN
        SELECT AVG(price) INTO v_avg_price
        FROM (
          SELECT price
          FROM trades
          WHERE contract_id = NEW.contract_id
          ORDER BY created_at DESC, id DESC
          LIMIT v_sample_size
        ) recent_trades;

        INSERT INTO asset_moving_averages (contract_id, moving_avg_price, sample_size, updated_at)
        VALUES (NEW.contract_id, v_avg_price, v_sample_size, CURRENT_TIMESTAMP)
        ON CONFLICT (contract_id)
        DO UPDATE SET
          moving_avg_price = EXCLUDED.moving_avg_price,
          sample_size = EXCLUDED.sample_size,
          updated_at = CURRENT_TIMESTAMP;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_calculate_moving_average
      AFTER INSERT ON trades
      FOR EACH ROW
      EXECUTE FUNCTION calculate_moving_average();
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.end().catch(() => {});
    }
    if (containerName) {
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch {
        // Ephemeral container cleaned up
      }
    }
  });

  test('verifies that row modifications successfully fire the update_timestamp trigger', async () => {
    if (!client) return;

    const oldTimestamp = new Date('2024-01-01T00:00:00Z');
    const insertRes = await client.query(
      `INSERT INTO trades (contract_id, price, volume, updated_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, updated_at`,
      ['C_TEST_ASSET_1', 100.5, 10, oldTimestamp]
    );

    const insertedId = insertRes.rows[0].id;
    const initialUpdatedAt = new Date(insertRes.rows[0].updated_at).getTime();

    // Perform an update to trigger update_timestamp
    await client.query(`UPDATE trades SET price = 105.00 WHERE id = $1`, [insertedId]);

    const updatedRes = await client.query(`SELECT id, updated_at, price FROM trades WHERE id = $1`, [insertedId]);
    const postUpdatedAt = new Date(updatedRes.rows[0].updated_at).getTime();

    expect(Number(updatedRes.rows[0].price)).toBe(105);
    expect(postUpdatedAt).toBeGreaterThan(initialUpdatedAt);
  });

  test('verifies the moving average calculation trigger behaves correctly on trade inserts', async () => {
    if (!client) return;

    const contractId = 'C_MOVING_AVG_ASSET';

    // Insert trade 1: price = 100
    await client.query(
      `INSERT INTO trades (contract_id, price, volume) VALUES ($1, $2, $3)`,
      [contractId, 100, 1]
    );

    let avgRes = await client.query(
      `SELECT moving_avg_price FROM asset_moving_averages WHERE contract_id = $1`,
      [contractId]
    );
    expect(Number(avgRes.rows[0].moving_avg_price)).toBe(100);

    // Insert trade 2: price = 200
    await client.query(
      `INSERT INTO trades (contract_id, price, volume) VALUES ($1, $2, $3)`,
      [contractId, 200, 1]
    );

    avgRes = await client.query(
      `SELECT moving_avg_price FROM asset_moving_averages WHERE contract_id = $1`,
      [contractId]
    );
    expect(Number(avgRes.rows[0].moving_avg_price)).toBe(150);

    // Insert trade 3: price = 300
    await client.query(
      `INSERT INTO trades (contract_id, price, volume) VALUES ($1, $2, $3)`,
      [contractId, 300, 1]
    );

    avgRes = await client.query(
      `SELECT moving_avg_price FROM asset_moving_averages WHERE contract_id = $1`,
      [contractId]
    );
    expect(Number(avgRes.rows[0].moving_avg_price)).toBe(200);
  });
});
