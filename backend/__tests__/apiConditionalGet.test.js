// Set env vars before importing the app (module-level constants are read at load time)
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app, rateLimiterService } from '../index.js';
import { setClient } from '../cache.js';

// Issue #709: the read-only list/detail endpoints must expose validators
// (ETag / Last-Modified) and cache directives, and answer conditional GETs
// with 304 Not Modified while the resource is unchanged.

beforeAll(() => {
  setClient(null);
  rateLimiterService.configureApiKey('test-key-for-jest', 'enterprise');
});

afterAll(() => {
  setClient(null);
  if (existsSync('test-data.json')) unlinkSync('test-data.json');
});

const API_KEY = 'test-key-for-jest';
const makeId = (letter) => 'C' + letter.repeat(55);

async function createAndApprove(contractId, title) {
  await request(app)
    .post('/api/v1/rwa')
    .set('x-api-key', API_KEY)
    .send({ contractId, title, location: 'Paris', description: `${title} description`, assetType: 'Real Estate' });
  await request(app)
    .post(`/api/v1/rwa/${contractId}/approve`)
    .set('x-api-key', API_KEY);
}

describe('GET /api/v1/rwa (list)', () => {
  beforeAll(async () => {
    await createAndApprove(makeId('A'), 'Cached Asset One');
  });

  test('sends ETag and Cache-Control validators', async () => {
    const res = await request(app).get('/api/v1/rwa');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['cache-control']).toContain('max-age=30');
  });

  test('returns 304 Not Modified for a matching If-None-Match', async () => {
    const first = await request(app).get('/api/v1/rwa');
    expect(first.status).toBe(200);

    const second = await request(app)
      .get('/api/v1/rwa')
      .set('If-None-Match', first.headers.etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  test('returns 200 with a new ETag once the collection changes', async () => {
    const before = await request(app).get('/api/v1/rwa');
    expect(before.status).toBe(200);

    await createAndApprove(makeId('B'), 'Cached Asset Two');

    const after = await request(app)
      .get('/api/v1/rwa')
      .set('If-None-Match', before.headers.etag);

    expect(after.status).toBe(200);
    expect(after.headers.etag).toBeDefined();
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });

  test('the legacy /api alias is cached too', async () => {
    const first = await request(app).get('/api/rwa');
    expect(first.headers.etag).toBeDefined();

    const second = await request(app)
      .get('/api/rwa')
      .set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
  });
});

describe('GET /api/v1/rwa/:contractId (detail)', () => {
  const contractId = makeId('C');

  beforeAll(async () => {
    await createAndApprove(contractId, 'Detail Caching Asset');
  });

  test('sends ETag, Last-Modified and Cache-Control', async () => {
    const res = await request(app).get(`/api/v1/rwa/${contractId}`);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.headers['last-modified']).toBeDefined();
    expect(res.headers['cache-control']).toContain('max-age=60');
  });

  test('returns 304 Not Modified for a matching If-None-Match', async () => {
    const first = await request(app).get(`/api/v1/rwa/${contractId}`);

    const second = await request(app)
      .get(`/api/v1/rwa/${contractId}`)
      .set('If-None-Match', first.headers.etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  test('honours If-Modified-Since', async () => {
    const first = await request(app).get(`/api/v1/rwa/${contractId}`);
    const lastModified = first.headers['last-modified'];

    const second = await request(app)
      .get(`/api/v1/rwa/${contractId}`)
      .set('If-Modified-Since', lastModified);

    expect(second.status).toBe(304);
  });

  test('revalidates after an update', async () => {
    const before = await request(app).get(`/api/v1/rwa/${contractId}`);

    await request(app)
      .patch(`/api/v1/rwa/${contractId}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'Detail Caching Asset (updated)' });

    const after = await request(app)
      .get(`/api/v1/rwa/${contractId}`)
      .set('If-None-Match', before.headers.etag);

    expect(after.status).toBe(200);
    expect(after.body.title).toBe('Detail Caching Asset (updated)');
  });

  test('an unknown asset is still a plain 404 without our cache directives', async () => {
    const res = await request(app).get(`/api/v1/rwa/${makeId('Z')}`);
    expect(res.status).toBe(404);
    // The conditional-GET helper only runs for a found asset; a missing asset
    // must not get a public Cache-Control (it would let intermediaries cache a
    // 404 as if it were an asset representation).
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['last-modified']).toBeUndefined();
  });
});
