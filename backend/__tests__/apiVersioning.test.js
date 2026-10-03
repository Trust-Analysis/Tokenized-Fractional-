// Set env vars before importing the app (module-level constants are read at load time)
import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app, rateLimiterService } from '../index.js';
import { setClient } from '../cache.js';
import { swaggerSpec } from '../docs.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

// Issue #704: a versioned /api/v1 prefix must cover the API surface, the legacy
// /api alias must stay backward-compatible and advertise its deprecation, and the
// OpenAPI spec must document the versioned paths.

beforeAll(() => {
  setClient(null);
  rateLimiterService.configureApiKey('test-key-for-jest', 'enterprise');
});

afterAll(() => {
  setClient(null);
  if (existsSync('test-data.json')) unlinkSync('test-data.json');
});

const API_KEY = 'test-key-for-jest';
const makeId = (letter) => `C${letter.repeat(55)}`;

async function createAndApprove(contractId, title) {
  await request(app)
    .post('/api/v1/rwa')
    .set('x-api-key', API_KEY)
    .send({
      contractId,
      title,
      location: 'Berlin',
      description: `${title} description`,
      assetType: 'Real Estate',
    });
  await request(app).post(`/api/v1/rwa/${contractId}/approve`).set('x-api-key', API_KEY);
}

describe('POST /api/v1/rwa', () => {
  test('creates an asset under the versioned prefix', async () => {
    const contractId = makeId('A');
    const res = await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY).send({
      contractId,
      title: 'Versioned Asset',
      location: 'Lisbon',
      description: 'Created through /api/v1',
      assetType: 'Real Estate',
    });

    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(contractId);
  });

  test('requires an admin API key', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .send({
        contractId: makeId('B'),
        title: 't',
        location: 'l',
        description: 'd',
        assetType: 'a',
      });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/rwa/:contractId', () => {
  test('returns an approved asset', async () => {
    const contractId = makeId('C');
    await createAndApprove(contractId, 'Detail Asset');

    const res = await request(app).get(`/api/v1/rwa/${contractId}`);
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(contractId);
  });

  test('returns 404 for an unknown contract id', async () => {
    const res = await request(app).get(`/api/v1/rwa/${makeId('Z')}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/rwa/:contractId', () => {
  test('deletes an asset under the versioned prefix', async () => {
    const contractId = makeId('D');
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY).send({
      contractId,
      title: 'To Delete',
      location: 'Oslo',
      description: 'temp',
      assetType: 'Test',
    });

    const res = await request(app).delete(`/api/v1/rwa/${contractId}`).set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(contractId);
  });
});

describe('versioned sub-resources', () => {
  test('GET /api/v1/rwa/pending lists pending assets for admins', async () => {
    const contractId = makeId('E');
    await request(app).post('/api/v1/rwa').set('x-api-key', API_KEY).send({
      contractId,
      title: 'Pending One',
      location: 'Rome',
      description: 'awaiting review',
      assetType: 'Test',
    });

    const res = await request(app).get('/api/v1/rwa/pending').set('x-api-key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.some((a) => a.contractId === contractId)).toBe(true);
  });

  test('GET /api/v1/rwa/search returns ranked approved assets', async () => {
    const contractId = makeId('F');
    await createAndApprove(contractId, 'Unique Pineapple Estate');

    const res = await request(app).get('/api/v1/rwa/search?q=pineapple');
    expect(res.status).toBe(200);
    expect(res.body.data.some((a) => a.contractId === contractId)).toBe(true);
  });

  test('GET /api/v1/rwa/search rejects a missing query', async () => {
    const res = await request(app).get('/api/v1/rwa/search');
    expect(res.status).toBe(400);
  });
});

describe('version advertisement and legacy alias', () => {
  test('versioned responses advertise X-API-Version', async () => {
    const res = await request(app).get('/api/v1/rwa');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers.deprecation).toBeUndefined();
  });

  test('legacy responses carry the deprecation headers', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.link).toBe('</api/v1>; rel="successor-version"');
  });

  test('legacy alias is served by the same handler as v1', async () => {
    const contractId = makeId('G');
    await createAndApprove(contractId, 'Alias Asset');

    const [v1Res, legacyRes] = await Promise.all([
      request(app).get(`/api/v1/rwa/${contractId}`),
      request(app).get(`/api/rwa/${contractId}`),
    ]);

    expect(v1Res.status).toBe(200);
    expect(legacyRes.status).toBe(200);
    expect(legacyRes.body.contractId).toBe(v1Res.body.contractId);
    expect(legacyRes.body.title).toBe(v1Res.body.title);
  });
});

describe('OpenAPI versioning coverage', () => {
  test('documents the versioned asset paths', () => {
    expect(swaggerSpec.paths['/api/v1/rwa']).toBeDefined();
    expect(swaggerSpec.paths['/api/v1/rwa/{contractId}']).toBeDefined();
    expect(swaggerSpec.paths['/api/v1/rwa/search']).toBeDefined();
    expect(swaggerSpec.paths['/api/v1/rwa/pending']).toBeDefined();
    expect(swaggerSpec.paths['/api/v1/webhooks']).toBeDefined();
  });

  test('marks the legacy alias operations as deprecated', () => {
    expect(swaggerSpec.paths['/api/rwa'].get.deprecated).toBe(true);
    expect(swaggerSpec.paths['/api/rwa'].post.deprecated).toBe(true);
    expect(swaggerSpec.paths['/api/rwa/{contractId}'].get.deprecated).toBe(true);
  });
});
