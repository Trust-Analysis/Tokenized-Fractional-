import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import express from 'express';
import knex from 'knex';
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import { createPriceHistoryRoutes } from '../src/routes/priceHistory.js';
import { createTransactionService } from '../src/services/transactionService.js';
import { setClient } from '../cache.js';

describe('GET /api/v1/rwa/:contractId/price-history', () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 1));
  let db;
  let app;

  beforeAll(async () => {
    setClient(null);
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('transactions', (table) => {
      table.increments('id').primary();
      table.string('contract_id').notNullable();
      table.string('status').notNullable();
      table.timestamp('created_at').notNullable();
      table.decimal('price_per_share', 20, 8).notNullable();
      table.decimal('total_amount', 20, 8).notNullable();
    });

    await db('transactions').insert([
      { contract_id: contractId, status: 'completed', created_at: '2026-01-01 10:00:00', price_per_share: 10, total_amount: 10 },
      { contract_id: contractId, status: 'completed', created_at: '2026-01-01 11:00:00', price_per_share: 20, total_amount: 40 },
      { contract_id: contractId, status: 'completed', created_at: '2026-01-02 12:00:00', price_per_share: 30, total_amount: 60 },
      { contract_id: contractId, status: 'failed', created_at: '2026-01-02 13:00:00', price_per_share: 100, total_amount: 100 },
      { contract_id: 'COTHER', status: 'completed', created_at: '2026-01-01 10:00:00', price_per_share: 500, total_amount: 500 },
    ]);

    const logger = { error: jest.fn() };
    app = express();
    app.use('/api/v1/rwa', createPriceHistoryRoutes(createTransactionService(db, logger), logger));
  });

  afterAll(async () => {
    setClient(null);
    await db.destroy();
  });

  test('returns real seeded purchases grouped by day and paginated', async () => {
    const response = await request(app)
      .get(`/api/v1/rwa/${contractId}/price-history?resolution=day&limit=1`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.body.pagination).toEqual({ total: 2, limit: 1, offset: 0, hasNext: true });
    expect(response.body.data).toEqual([{
      timestamp: '2026-01-01T00:00:00.000Z',
      price: 15,
      volume: 50,
      transactions: 2,
    }]);
  });

  test('returns raw transaction prices and rejects invalid query parameters', async () => {
    const response = await request(app)
      .get(`/api/v1/rwa/${contractId}/price-history?resolution=raw&limit=2`);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ total: 3, limit: 2, offset: 0, hasNext: true });
    expect(response.body.data.map(point => point.price)).toEqual([10, 20]);

    const invalid = await request(app)
      .get(`/api/v1/rwa/${contractId}/price-history?resolution=minute`);
    expect(invalid.status).toBe(400);
  });
});
