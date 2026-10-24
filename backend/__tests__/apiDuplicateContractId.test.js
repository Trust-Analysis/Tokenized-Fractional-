// Set env vars before importing the app (module-level constants are read at load time)
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app, rateLimiterService } from '../index.js';
import { setClient } from '../cache.js';

// Issue #706: POST /api/rwa is create-only. A duplicate contractId must return
// 409 Conflict and must NOT overwrite the existing asset's metadata.

beforeAll(() => {
  setClient(null);
  rateLimiterService.configureApiKey('test-key-for-jest', 'enterprise');
});

afterAll(() => {
  setClient(null);
  if (existsSync('test-data.json')) unlinkSync('test-data.json');
});

const API_KEY = 'test-key-for-jest';
const bodyFor = (contractId, title) => ({
  contractId,
  title,
  location: 'Zurich',
  description: `${title} description`,
  assetType: 'Real Estate',
});

describe('POST /api/v1/rwa duplicate contractId', () => {
  test('returns 409 Conflict for an existing contractId', async () => {
    const contractId = 'C' + 'A'.repeat(55);

    const first = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Original Asset'));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Overwrite Attempt'));

    // The global problem-details interceptor renders 4xx bodies as RFC 7807:
    // the message lands in `detail` and the stable `code` is preserved.
    expect(second.status).toBe(409);
    expect(second.body.detail).toMatch(/already exists/i);
    expect(second.body.detail).toMatch(/PATCH/);
    expect(second.body.code).toBe('ASSET_ALREADY_EXISTS');
  });

  test('does not overwrite the existing asset metadata', async () => {
    const contractId = 'C' + 'B'.repeat(55);

    await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Keep Me'));
    await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Replacement'));

    // Asset must remain pending but keep its original title.
    const pending = await request(app)
      .get('/api/v1/rwa/pending')
      .set('x-api-key', API_KEY);

    const stored = pending.body.find((a) => a.contractId === contractId);
    expect(stored).toBeDefined();
    expect(stored.title).toBe('Keep Me');
  });

  test('returns 409 on the legacy /api alias too', async () => {
    const contractId = 'C' + 'C'.repeat(55);

    await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Legacy Asset'));

    const res = await request(app)
      .post('/api/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Legacy Overwrite'));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_ALREADY_EXISTS');
  });

  test('still creates a brand-new contractId', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor('C' + 'D'.repeat(55), 'Brand New Asset'));

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Brand New Asset');
  });
});

describe('updates remain possible via PATCH', () => {
  test('PATCH updates an asset created by POST', async () => {
    const contractId = 'C' + 'E'.repeat(55);

    await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Before Patch'));

    const res = await request(app)
      .patch(`/api/v1/rwa/${contractId}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'After Patch' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('After Patch');
  });
});

describe('validation still precedes the conflict check', () => {
  test('missing required fields returns 400, not 409', async () => {
    const contractId = 'C' + 'F'.repeat(55);
    await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send(bodyFor(contractId, 'Valid Asset'));

    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', API_KEY)
      .send({ contractId, title: 'Incomplete' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Missing required fields/i);
  });
});
