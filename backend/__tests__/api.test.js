// Set env vars before importing the app (module-level constants are read at load time)
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app } from '../index.js';
import { setClient } from '../cache.js';

// Ensure Redis is disabled (null = graceful fallback) for these tests
beforeAll(() => setClient(null));
afterAll(() => setClient(null));

const API_KEY = 'test-key-for-jest';
const VALID_ID = 'C' + 'A'.repeat(55);
const VALID_BODY = {
  contractId: VALID_ID,
  title: 'Test Property',
  location: 'New York',
  description: 'A test property',
  assetType: 'Real Estate',
};

afterAll(() => {
  if (existsSync('test-data.json')) unlinkSync('test-data.json');
});

// ── Health check ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('returns ok with dependency statuses (no Redis configured)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.dependencies.storage.status).toBe('ok');
    expect(res.body.dependencies.redis.status).toBe('not_configured');
  });

  test('returns 503 degraded when Redis is configured but unreachable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:19999'; // nothing listening here
    const res = await request(app).get('/health');
    delete process.env.REDIS_URL;
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.redis.status).toBe('error');
  });
});

// ── 404 handling ──────────────────────────────────────────────────────────────
describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ── GET /api/rwa ──────────────────────────────────────────────────────────────
describe('GET /api/rwa', () => {
  const ID_A = 'C' + 'A'.repeat(55);
  const ID_B = 'C' + 'B'.repeat(55);

  beforeAll(async () => {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ contractId: ID_A, title: 'Coffee Farm', location: 'Ethiopia', description: 'Premium coffee plantation', assetType: 'Agriculture' });
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ contractId: ID_B, title: 'Downtown Office', location: 'NYC', description: 'Manhattan office building', assetType: 'Real Estate' });
  });

  test('returns paginated response shape', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });

  test('filters by assetType', async () => {
    const res = await request(app).get('/api/rwa?assetType=agriculture');
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.assetType.toLowerCase() === 'agriculture')).toBe(true);
  });

  test('filters by search on title', async () => {
    const res = await request(app).get('/api/rwa?search=coffee');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.title.toLowerCase().includes('coffee'))).toBe(true);
  });

  test('filters by search on description', async () => {
    const res = await request(app).get('/api/rwa?search=manhattan');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.description.toLowerCase().includes('manhattan'))).toBe(true);
  });

  test('paginates with limit=1', async () => {
    const res = await request(app).get('/api/rwa?limit=1&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.page).toBe(1);
  });

  test('page 2 with limit=1 returns next item', async () => {
    const page1 = await request(app).get('/api/rwa?limit=1&page=1');
    const page2 = await request(app).get('/api/rwa?limit=1&page=2');
    expect(page1.body.data[0].contractId).not.toBe(page2.body.data[0].contractId);
  });
});

// ── POST /api/rwa ─────────────────────────────────────────────────────────────
describe('POST /api/rwa', () => {
  test('creates asset with valid key and body', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(VALID_ID);
    expect(res.body.title).toBe('Test Property');
  });

  test('rejects missing API key', async () => {
    const res = await request(app).post('/api/rwa').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  test('rejects invalid API key', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', 'wrong-key')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  test('rejects invalid contract ID', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send({ ...VALID_BODY, contractId: 'BADID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid contract ID/);
  });

  test('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send({ contractId: VALID_ID, title: 'Only title' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });
});

// ── GET /api/rwa/:contractId ──────────────────────────────────────────────────
describe('GET /api/rwa/:contractId', () => {
  test('returns existing asset', async () => {
    const res = await request(app).get(`/api/rwa/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(VALID_ID);
  });

  test('returns 404 for unknown contract ID', async () => {
    const unknown = 'C' + 'Z'.repeat(55);
    const res = await request(app).get(`/api/rwa/${unknown}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── DELETE /api/rwa/:contractId ───────────────────────────────────────────────
describe('DELETE /api/rwa/:contractId', () => {
  test('rejects without API key', async () => {
    const res = await request(app).delete(`/api/rwa/${VALID_ID}`);
    expect(res.status).toBe(401);
  });

  test('deletes existing asset', async () => {
    const res = await request(app)
      .delete(`/api/rwa/${VALID_ID}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(VALID_ID);
  });

  test('returns 404 when already deleted', async () => {
    const res = await request(app)
      .delete(`/api/rwa/${VALID_ID}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(404);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('Rate limiting', () => {
  test('write limiter blocks after 20 requests', async () => {
    const ids = Array.from({ length: 21 }, (_, i) =>
      'C' + String(i).padStart(55, '0')
    );
    const statuses = [];
    for (const id of ids) {
      const res = await request(app)
        .post('/api/rwa')
        .set('x-api-key', API_KEY)
        .send({ ...VALID_BODY, contractId: id });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
