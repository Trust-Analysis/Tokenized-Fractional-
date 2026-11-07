// Set env vars before importing the app (module-level constants are read at load time)
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'integration-test-key';
process.env.DATA_FILE = 'integration-test-data.json';

import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app, rateLimiterService } from '../index.js';
import { setClient } from '../cache.js';

// Disable Redis (null = graceful fallback) for these tests so the suite is
// self-contained, and exempt the test key from the write rate limiter.
beforeAll(() => {
  setClient(null);
  rateLimiterService.configureApiKey('integration-test-key', 'enterprise');
});
afterAll(() => setClient(null));

afterAll(() => {
  if (existsSync('integration-test-data.json')) unlinkSync('integration-test-data.json');
});

const API_KEY = 'integration-test-key';
const VALID_ID = 'C' + 'A'.repeat(55);
const VALID_BODY = {
  contractId: VALID_ID,
  title: 'Integration Test Tower',
  location: 'Amsterdam',
  description: 'E2E asset created by the backend integration suite',
  assetType: 'Commercial',
};

// Issue #673: supertest integration suite bootstrapping the real backend app
// and exercising the core metadata API routes end-to-end.
describe('Integration: backend core API (supertest)', () => {
  test('GET /health reports service health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('serviceName');
    expect(res.body).toHaveProperty('buildId');
    expect(res.body.deps.storage.status).toBe('ok');
  });

  test('GET /api/rwa returns a paginated list', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toHaveProperty('total');
  });

  test('POST /api/rwa rejects a request without an API key', async () => {
    const res = await request(app).post('/api/rwa').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or missing API key/i);
  });

  test('POST /api/rwa rejects an invalid contract id', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send({ ...VALID_BODY, contractId: 'not-a-valid-contract-id' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid contract id/i);
  });

  test('POST /api/rwa creates an asset with a valid API key', async () => {
    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(VALID_ID);
    expect(res.body.title).toBe(VALID_BODY.title);
    expect(res.body.status).toBe('pending');
  });

  test('created asset appears in the list but stays unpublished until approved', async () => {
    const listRes = await request(app).get('/api/rwa');
    expect(listRes.status).toBe(200);
    const ids = listRes.body.data.map((a) => a.contractId);
    expect(ids).toContain(VALID_ID);

    const getRes = await request(app).get(`/api/rwa/${VALID_ID}`);
    expect(getRes.status).toBe(404);
  });

  test('GET /api/rwa/:contractId returns metadata after approval', async () => {
    const approveRes = await request(app)
      .post(`/api/v1/rwa/${VALID_ID}/approve`)
      .set('x-api-key', API_KEY);
    expect(approveRes.status).toBe(200);

    const res = await request(app).get(`/api/rwa/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(VALID_ID);
    expect(res.body.title).toBe(VALID_BODY.title);
    expect(res.body.status).toBe('approved');
  });

  test('GET /api/rwa/:contractId returns 404 for an unknown contract id', async () => {
    const res = await request(app).get(`/api/rwa/C${'B'.repeat(55)}`);
    expect(res.status).toBe(404);
  });
});