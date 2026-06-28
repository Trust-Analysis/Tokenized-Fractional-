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

// ── X-Request-ID ──────────────────────────────────────────────────────────────
describe('X-Request-ID', () => {
  test('response includes X-Request-ID header (auto-generated)', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('echoes back a supplied X-Request-ID', async () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const res = await request(app).get('/health').set('X-Request-ID', id);
    expect(res.headers['x-request-id']).toBe(id);
  });

  test('404 response body includes requestId', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.requestId).toBeDefined();
  });

  test('401 response body includes requestId', async () => {
    const res = await request(app).post('/api/rwa').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.requestId).toBeDefined();
  });
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

// ── PATCH /api/rwa/:contractId ────────────────────────────────────────────────
describe('PATCH /api/rwa/:contractId', () => {
  const ID = 'C' + 'P'.repeat(55);

  beforeAll(async () => {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ contractId: ID, title: 'Original Title', location: 'Original Location', description: 'Original description', assetType: 'Real Estate' });
  });

  test('rejects without API key', async () => {
    const res = await request(app).patch(`/api/rwa/${ID}`).send({ title: 'New Title' });
    expect(res.status).toBe(401);
  });

  test('updates single field', async () => {
    const res = await request(app)
      .patch(`/api/rwa/${ID}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.location).toBe('Original Location'); // unchanged
  });

  test('updates multiple fields', async () => {
    const res = await request(app)
      .patch(`/api/rwa/${ID}`)
      .set('x-api-key', API_KEY)
      .send({ location: 'New Location', imageUrl: 'ipfs://hash' });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe('New Location');
    expect(res.body.imageUrl).toBe('ipfs://hash');
    expect(res.body.title).toBe('Updated Title'); // from previous patch
  });

  test('rejects empty request body', async () => {
    const res = await request(app)
      .patch(`/api/rwa/${ID}`)
      .set('x-api-key', API_KEY)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one field/i);
  });

  test('returns 404 for non-existent asset', async () => {
    const unknown = 'C' + 'Z'.repeat(55);
    const res = await request(app)
      .patch(`/api/rwa/${unknown}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'New Title' });
    expect(res.status).toBe(404);
  });

  test('updates updatedAt timestamp', async () => {
    const before = new Date().toISOString();
    const res = await request(app)
      .patch(`/api/rwa/${ID}`)
      .set('x-api-key', API_KEY)
      .send({ description: 'Updated description' });
    const after = new Date().toISOString();
    expect(res.status).toBe(200);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(new Date(res.body.updatedAt).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
  });

  test('ignores unknown fields', async () => {
    const res = await request(app)
      .patch(`/api/rwa/${ID}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'Another Title', unknownField: 'should be ignored' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Another Title');
    expect(res.body.unknownField).toBeUndefined();
  });
});

// ── Versioned routes: GET /api/v1/rwa ─────────────────────────────────────────
describe('GET /api/v1/rwa', () => {
  const ID_A = 'C' + 'A'.repeat(55);
  const ID_B = 'C' + 'B'.repeat(55);

  beforeAll(async () => {
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
      .send({ contractId: ID_A, title: 'Coffee Farm', location: 'Ethiopia', description: 'Premium coffee plantation', assetType: 'Agriculture' });
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
      .send({ contractId: ID_B, title: 'Downtown Office', location: 'NYC', description: 'Manhattan office building', assetType: 'Real Estate' });
  });

  test('returns paginated response shape', async () => {
    const res = await request(app).get('/api/v1/rwa');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  test('filters by assetType', async () => {
    const res = await request(app).get('/api/v1/rwa?assetType=agriculture');
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.assetType.toLowerCase() === 'agriculture')).toBe(true);
  });

  test('filters by search on title', async () => {
    const res = await request(app).get('/api/v1/rwa?search=coffee');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.title.toLowerCase().includes('coffee'))).toBe(true);
  });

  test('paginates with limit=1', async () => {
    const res = await request(app).get('/api/v1/rwa?limit=1&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });
});

// ── Versioned routes: POST /api/v1/rwa ────────────────────────────────────────
describe('POST /api/v1/rwa', () => {
  test('creates asset with valid key and body', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(VALID_ID);
    expect(res.body.title).toBe('Test Property');
  });

  test('rejects missing API key', async () => {
    const res = await request(app).post('/api/v1/rwa').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  test('rejects invalid contract ID', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send({ ...VALID_BODY, contractId: 'BADID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid contract ID/);
  });

  test('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send({ contractId: VALID_ID, title: 'Only title' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });
});

// ── Versioned routes: GET /api/v1/rwa/:contractId ─────────────────────────────
describe('GET /api/v1/rwa/:contractId', () => {
  test('returns existing asset', async () => {
    const res = await request(app).get(`/api/v1/rwa/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(VALID_ID);
  });

  test('returns 404 for unknown contract ID', async () => {
    const unknown = 'C' + 'Z'.repeat(55);
    const res = await request(app).get(`/api/v1/rwa/${unknown}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── Versioned routes: DELETE /api/v1/rwa/:contractId ─────────────────────────
describe('DELETE /api/v1/rwa/:contractId', () => {
  const V1_DELETE_ID = 'C' + 'D'.repeat(55);

  beforeAll(async () => {
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
      .send({ contractId: V1_DELETE_ID, title: 'To Delete', location: 'Test', description: 'Asset to delete', assetType: 'Test' });
  });

  test('rejects without API key', async () => {
    const res = await request(app).delete(`/api/v1/rwa/${V1_DELETE_ID}`);
    expect(res.status).toBe(401);
  });

  test('deletes existing asset', async () => {
    const res = await request(app)
      .delete(`/api/v1/rwa/${V1_DELETE_ID}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(V1_DELETE_ID);
  });

  test('returns 404 when already deleted', async () => {
    const res = await request(app)
      .delete(`/api/v1/rwa/${V1_DELETE_ID}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/rwa/export ───────────────────────────────────────────────────────
describe('GET /api/rwa/export', () => {
  test('requires admin API key', async () => {
    const res = await request(app).get('/api/rwa/export');
    expect(res.status).toBe(401);
  });

  test('returns JSON by default', async () => {
    const res = await request(app).get('/api/rwa/export').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="rwa-export-\d+\.json"/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns JSON when format=json', async () => {
    const res = await request(app).get('/api/rwa/export?format=json').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns CSV when format=csv', async () => {
    const res = await request(app).get('/api/rwa/export?format=csv').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="rwa-export-\d+\.csv"/);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('contractId,id,title,location,description,assetType,imageUrl,totalValuation,createdAt,updatedAt');
    expect(lines.length).toBeGreaterThan(1);
  });

  test('CSV escapes double-quotes in values', async () => {
    // Write test data directly to the data file to avoid rate limiter
    const { readFileSync, writeFileSync } = await import('fs');
    const dataPath = 'test-data.json';
    const existing = JSON.parse(existsSync(dataPath) ? readFileSync(dataPath, 'utf-8') : '{}');
    const ID_QUOTES = 'C' + 'Q'.repeat(55);
    existing[ID_QUOTES] = { id: ID_QUOTES, title: 'Say "hello"', location: 'L', description: 'D', assetType: 'T', imageUrl: '', totalValuation: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeFileSync(dataPath, JSON.stringify(existing), 'utf-8');

    const res = await request(app).get('/api/rwa/export?format=csv').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"Say ""hello"""');
  });

  test('rejects invalid format', async () => {
    const res = await request(app).get('/api/rwa/export?format=xml').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/);
  });

  test('rejects invalid from date', async () => {
    const res = await request(app).get('/api/rwa/export?from=not-a-date').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"from"/);
  });

  test('rejects invalid to date', async () => {
    const res = await request(app).get('/api/rwa/export?to=not-a-date').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"to"/);
  });

  test('date range filter: from in the future returns empty', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    const res = await request(app)
      .get(`/api/rwa/export?from=${encodeURIComponent(future)}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  test('date range filter: from in the past returns existing assets', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const res = await request(app)
      .get(`/api/rwa/export?from=${encodeURIComponent(past)}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('also works on /api/v1/rwa/export', async () => {
    const res = await request(app).get('/api/v1/rwa/export').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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
