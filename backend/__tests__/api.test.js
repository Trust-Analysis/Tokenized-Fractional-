// Set env vars before importing the app (module-level constants are read at load time)
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import crypto from 'crypto';
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

// Helper: create an asset and approve it for use in public GET tests
async function createAndApproveAsset(body) {
  const createRes = await request(app)
    .post('/api/rwa')
    .set('x-api-key', API_KEY)
    .send(body);
  await request(app)
    .post(`/api/rwa/${body.contractId}/approve`)
    .set('x-api-key', API_KEY);
  return createRes;
}

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
    await createAndApproveAsset({ contractId: ID_A, title: 'Coffee Farm', location: 'Ethiopia', description: 'Premium coffee plantation', assetType: 'Agriculture' });
    await createAndApproveAsset({ contractId: ID_B, title: 'Downtown Office', location: 'NYC', description: 'Manhattan office building', assetType: 'Real Estate' });
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
  beforeAll(async () => {
    // Approve the asset created in POST tests so it's visible publicly
    await request(app).post(`/api/rwa/${VALID_ID}/approve`).set('x-api-key', API_KEY);
  });

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

  test('returns 404 for pending asset', async () => {
    const pendingId = 'C' + 'P'.repeat(55);
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ contractId: pendingId, title: 'Pending Asset', location: 'Test', description: 'Not yet approved', assetType: 'Test' });
    const res = await request(app).get(`/api/rwa/${pendingId}`);
    expect(res.status).toBe(404);
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
    await createAndApproveAsset({ contractId: ID_A, title: 'Coffee Farm', location: 'Ethiopia', description: 'Premium coffee plantation', assetType: 'Agriculture' });
    await createAndApproveAsset({ contractId: ID_B, title: 'Downtown Office', location: 'NYC', description: 'Manhattan office building', assetType: 'Real Estate' });
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
  const V1_GET_ID = 'C' + 'G'.repeat(55);

  beforeAll(async () => {
    await createAndApproveAsset({ contractId: V1_GET_ID, title: 'V1 Get Asset', location: 'Paris', description: 'For v1 GET test', assetType: 'Real Estate' });
  });

  test('returns existing asset', async () => {
    const res = await request(app).get(`/api/v1/rwa/${V1_GET_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(V1_GET_ID);
  });

  test('returns 404 for unknown contract ID', async () => {
    const unknown = 'C' + 'Z'.repeat(55);
    const res = await request(app).get(`/api/v1/rwa/${unknown}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 404 for pending asset', async () => {
    const pendingId = 'C' + 'V'.repeat(55);
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
      .send({ contractId: pendingId, title: 'Pending V1', location: 'Test', description: 'Not yet approved', assetType: 'Test' });
    const res = await request(app).get(`/api/v1/rwa/${pendingId}`);
    expect(res.status).toBe(404);
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

// ── Asset Verification Workflow ───────────────────────────────────────────────
describe('Asset Verification Workflow', () => {
  const PENDING_ID = 'C' + 'W'.repeat(55);
  const PENDING_BODY = {
    contractId: PENDING_ID,
    title: 'Pending Warehouse',
    location: 'Chicago',
    description: 'A warehouse awaiting review',
    assetType: 'Logistics',
  };

  describe('POST /api/rwa (status field)', () => {
    test('creates asset with status pending and submittedAt', async () => {
      const res = await request(app)
        .post('/api/rwa')
        .set('x-api-key', API_KEY)
        .send(PENDING_BODY);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(res.body.submittedAt).toBeDefined();
      expect(res.body.reviewedAt).toBeUndefined();
      expect(res.body.reviewedBy).toBeUndefined();
    });
  });

  describe('GET /api/rwa/pending', () => {
    test('requires admin API key', async () => {
      const res = await request(app).get('/api/rwa/pending');
      expect(res.status).toBe(401);
    });

    test('returns pending assets for admin', async () => {
      const res = await request(app).get('/api/rwa/pending').set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some(a => a.contractId === PENDING_ID)).toBe(true);
      expect(res.body.every(a => a.status === 'pending')).toBe(true);
    });

    test('works on /api/v1/rwa/pending', async () => {
      const res = await request(app).get('/api/v1/rwa/pending').set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.some(a => a.contractId === PENDING_ID)).toBe(true);
    });

    test('does not include approved or rejected assets', async () => {
      const res = await request(app).get('/api/rwa/pending').set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.every(a => a.status === 'pending')).toBe(true);
    });
  });

  describe('POST /api/rwa/:contractId/approve', () => {
    test('requires admin API key', async () => {
      const res = await request(app).post(`/api/rwa/${PENDING_ID}/approve`);
      expect(res.status).toBe(401);
    });

    test('approves a pending asset', async () => {
      const res = await request(app)
        .post(`/api/rwa/${PENDING_ID}/approve`)
        .set('x-api-key', API_KEY)
        .set('x-reviewer', 'test-admin');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.reviewedAt).toBeDefined();
      expect(res.body.reviewedBy).toBe('test-admin');
      expect(res.body.contractId).toBe(PENDING_ID);
    });

    test('approved asset appears in public GET list', async () => {
      const res = await request(app).get('/api/rwa');
      expect(res.status).toBe(200);
      expect(res.body.data.some(a => a.contractId === PENDING_ID)).toBe(true);
    });

    test('returns 404 for non-existent asset', async () => {
      const unknown = 'C' + 'Z'.repeat(55);
      const res = await request(app)
        .post(`/api/rwa/${unknown}/approve`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(404);
    });

    test('works on /api/v1/rwa/:contractId/approve', async () => {
      const v1ApproveId = 'C' + 'X'.repeat(55);
      await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
        .send({ contractId: v1ApproveId, title: 'V1 Approve', location: 'Test', description: 'Test', assetType: 'Test' });
      const res = await request(app)
        .post(`/api/v1/rwa/${v1ApproveId}/approve`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
    });
  });

  describe('POST /api/rwa/:contractId/reject', () => {
    const REJECT_ID = 'C' + 'Y'.repeat(55);
    const REJECT_BODY = {
      contractId: REJECT_ID,
      title: 'Rejected Property',
      location: 'Detroit',
      description: 'A property to reject',
      assetType: 'Real Estate',
    };

    beforeAll(async () => {
      await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(REJECT_BODY);
    });

    test('requires admin API key', async () => {
      const res = await request(app).post(`/api/rwa/${REJECT_ID}/reject`);
      expect(res.status).toBe(401);
    });

    test('rejects a pending asset', async () => {
      const res = await request(app)
        .post(`/api/rwa/${REJECT_ID}/reject`)
        .set('x-api-key', API_KEY)
        .set('x-reviewer', 'reviewer-2');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
      expect(res.body.reviewedAt).toBeDefined();
      expect(res.body.reviewedBy).toBe('reviewer-2');
    });

    test('rejected asset does not appear in public GET list', async () => {
      const res = await request(app).get('/api/rwa');
      expect(res.status).toBe(200);
      expect(res.body.data.some(a => a.contractId === REJECT_ID)).toBe(false);
    });

    test('returns 404 for non-existent asset', async () => {
      const unknown = 'C' + 'Z'.repeat(55);
      const res = await request(app)
        .post(`/api/rwa/${unknown}/reject`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(404);
    });

    test('works on /api/v1/rwa/:contractId/reject', async () => {
      const v1RejectId = 'C' + 'Z'.repeat(55);
      await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY)
        .send({ contractId: v1RejectId, title: 'V1 Reject', location: 'Test', description: 'Test', assetType: 'Test' });
      const res = await request(app)
        .post(`/api/v1/rwa/${v1RejectId}/reject`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });
  });
});

// ── Webhook Management ────────────────────────────────────────────────────────
describe('Webhook Management', () => {
  const WEBHOOK_URL = 'https://httpbin.org/post';
  let webhookId;

  describe('POST /api/webhooks', () => {
    test('requires admin API key', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .send({ url: WEBHOOK_URL, events: ['asset.created'] });
      expect(res.status).toBe(401);
    });

    test('creates a webhook', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: WEBHOOK_URL, events: ['asset.created', 'asset.updated'], secret: 'whsec_test' });
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^wh_/);
      expect(res.body.url).toBe(WEBHOOK_URL);
      expect(res.body.events).toEqual(['asset.created', 'asset.updated']);
      expect(res.body.secret).toBe('whsec_test');
      expect(res.body.active).toBe(true);
      expect(res.body.failureCount).toBe(0);
      webhookId = res.body.id;
    });

    test('rejects missing url', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ events: ['asset.created'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/url/i);
    });

    test('rejects invalid url', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: 'not-a-url', events: ['asset.created'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/url/i);
    });

    test('rejects missing events', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: WEBHOOK_URL });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/events/i);
    });

    test('rejects invalid events', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: WEBHOOK_URL, events: ['invalid.event'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid events/i);
    });

    test('works on /api/v1/webhooks', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: 'https://example.com/v1-hook', events: ['asset.deleted'] });
      expect(res.status).toBe(201);
      expect(res.body.url).toBe('https://example.com/v1-hook');
    });

    test('defaults active to true', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: WEBHOOK_URL, events: ['asset.created'] });
      expect(res.status).toBe(201);
      expect(res.body.active).toBe(true);
    });
  });

  describe('GET /api/webhooks', () => {
    test('requires admin API key', async () => {
      const res = await request(app).get('/api/webhooks');
      expect(res.status).toBe(401);
    });

    test('lists registered webhooks', async () => {
      const res = await request(app).get('/api/webhooks').set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some(w => w.id === webhookId)).toBe(true);
    });

    test('works on /api/v1/webhooks', async () => {
      const res = await request(app).get('/api/v1/webhooks').set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/webhooks/:id', () => {
    test('requires admin API key', async () => {
      const res = await request(app).get(`/api/webhooks/${webhookId}`);
      expect(res.status).toBe(401);
    });

    test('returns webhook by id', async () => {
      const res = await request(app).get(`/api/webhooks/${webhookId}`).set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(webhookId);
      expect(res.body.url).toBe(WEBHOOK_URL);
    });

    test('returns 404 for unknown id', async () => {
      const res = await request(app).get('/api/webhooks/wh_unknown').set('x-api-key', API_KEY);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/webhooks/:id', () => {
    test('requires admin API key', async () => {
      const res = await request(app).patch(`/api/webhooks/${webhookId}`).send({ active: false });
      expect(res.status).toBe(401);
    });

    test('updates webhook fields', async () => {
      const res = await request(app)
        .patch(`/api/webhooks/${webhookId}`)
        .set('x-api-key', API_KEY)
        .send({ active: false, events: ['asset.created'] });
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
      expect(res.body.events).toEqual(['asset.created']);
    });

    test('returns 404 for unknown id', async () => {
      const res = await request(app)
        .patch('/api/webhooks/wh_unknown')
        .set('x-api-key', API_KEY)
        .send({ active: true });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    let deleteId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: WEBHOOK_URL, events: ['asset.created'] });
      deleteId = res.body.id;
    });

    test('requires admin API key', async () => {
      const res = await request(app).delete(`/api/webhooks/${deleteId}`);
      expect(res.status).toBe(401);
    });

    test('deletes a webhook', async () => {
      const res = await request(app)
        .delete(`/api/webhooks/${deleteId}`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('returns 404 when already deleted', async () => {
      const res = await request(app)
        .delete(`/api/webhooks/${deleteId}`)
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(404);
    });

    test('returns 404 for unknown id', async () => {
      const res = await request(app)
        .delete('/api/webhooks/wh_nonexistent')
        .set('x-api-key', API_KEY);
      expect(res.status).toBe(404);
    });
  });

  describe('Webhook delivery on asset changes', () => {
    let receivedPayloads = [];
    let testServer;
    let testServerUrl;
    let whDeliveryId;

    beforeAll(async () => {
      const http = await import('http');
      testServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            receivedPayloads.push(JSON.parse(body));
          } catch { /* ignore malformed */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });
      await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
      const addr = testServer.address();
      testServerUrl = `http://127.0.0.1:${addr.port}/hooks`;

      // Create a dedicated webhook pointing at our test server for all events
      const whRes = await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: testServerUrl, events: ['asset.created', 'asset.updated', 'asset.deleted', 'asset.approved', 'asset.rejected'], active: true });
      whDeliveryId = whRes.body.id;
    });

    afterAll(async () => {
      if (whDeliveryId) {
        await request(app).delete(`/api/webhooks/${whDeliveryId}`).set('x-api-key', API_KEY).catch(() => {});
      }
      if (testServer) await new Promise(resolve => testServer.close(resolve));
    });

    // Helper: create asset, approve it, and return IDs
    async function createAsset(title) {
      const id = 'C' + crypto.randomUUID().replace(/-/g, '').repeat(2).slice(0, 55);
      const res = await request(app)
        .post('/api/rwa')
        .set('x-api-key', API_KEY)
        .send({ contractId: id, title, location: 'T', description: 'D', assetType: 'Test' });
      return { id, res };
    }

    async function waitForEvent(event, timeout = 5000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = receivedPayloads.find(p => p.event === event);
        if (found) return found;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error(`Timed out waiting for ${event}. Received: ${JSON.stringify(receivedPayloads)}`);
    }

    test('fires asset.created on POST', async () => {
      const { id } = await createAsset('Created');
      const payload = await waitForEvent('asset.created');
      expect(payload.data.contractId).toBe(id);
      expect(payload.timestamp).toBeDefined();
    });

    test('fires asset.approved on approve', async () => {
      const { id } = await createAsset('To Approve');
      receivedPayloads = [];

      await request(app)
        .post(`/api/rwa/${id}/approve`)
        .set('x-api-key', API_KEY);

      const payload = await waitForEvent('asset.approved');
      expect(payload.data.contractId).toBe(id);
    });

    test('fires asset.updated on PATCH', async () => {
      const { id } = await createAsset('To Update');
      receivedPayloads = [];

      await request(app)
        .patch(`/api/rwa/${id}`)
        .set('x-api-key', API_KEY)
        .send({ title: 'Updated' });

      const payload = await waitForEvent('asset.updated');
      expect(payload.data.title).toBe('Updated');
    });

    test('fires asset.deleted on DELETE', async () => {
      const { id } = await createAsset('To Delete');
      receivedPayloads = [];

      await request(app)
        .delete(`/api/rwa/${id}`)
        .set('x-api-key', API_KEY);

      const payload = await waitForEvent('asset.deleted');
      expect(payload.data.contractId).toBe(id);
    });

    test('retries on 5xx response', async () => {
      const http = await import('http');
      let failCount = 0;
      const failServer = http.createServer((_req, res) => {
        failCount++;
        res.writeHead(500);
        res.end();
      });
      await new Promise(resolve => failServer.listen(0, '127.0.0.1', resolve));
      const port = failServer.address().port;

      await request(app)
        .post('/api/webhooks')
        .set('x-api-key', API_KEY)
        .send({ url: `http://127.0.0.1:${port}/fail`, events: ['asset.created'], active: true });

      await createAsset('Fail Test');

      await new Promise(resolve => setTimeout(resolve, 6000));
      expect(failCount).toBeGreaterThanOrEqual(3);

      await new Promise(resolve => failServer.close(resolve));
    }, 15000);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('Rate limiting', () => {
  test('write requests succeed within test-mode limit (max: 1000)', async () => {
    const ids = Array.from({ length: 25 }, (_, i) =>
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
    // In test mode the write limit is 1000, so all 25 should succeed
    expect(statuses.every(s => s === 201)).toBe(true);
    expect(statuses.length).toBe(25);
  });
});
