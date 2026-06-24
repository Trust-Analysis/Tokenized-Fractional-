process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-cache-data.json';

import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app } from '../index.js';
import { setClient, cacheGet, cacheSet, cacheDel } from '../cache.js';

const API_KEY = 'test-key-for-jest';
const VALID_ID = 'C' + 'D'.repeat(55);
const VALID_BODY = {
  contractId: VALID_ID,
  title: 'Cache Test Property',
  location: 'London',
  description: 'Testing cache layer',
  assetType: 'Real Estate',
};

// ── In-memory mock Redis client ───────────────────────────────────────────────
function makeMockRedis() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    // Redis SET key value EX ttl — ignore extra args
    set: async (key, val, _ex, _ttl) => { store.set(key, val); return 'OK'; },
    del: async (...keys) => { keys.forEach(k => store.delete(k)); return keys.length; },
    on: () => {},
  };
}

let mockRedis;

beforeEach(() => {
  mockRedis = makeMockRedis();
  setClient(mockRedis);
});

afterAll(() => {
  setClient(null);
  if (existsSync('test-cache-data.json')) unlinkSync('test-cache-data.json');
});

// ── Cache module unit tests ───────────────────────────────────────────────────
describe('cache module', () => {
  test('cacheSet stores and cacheGet retrieves a value', async () => {
    await cacheSet('test:key', { foo: 'bar' });
    const result = await cacheGet('test:key');
    expect(result).toEqual({ foo: 'bar' });
  });

  test('cacheGet returns null for missing key', async () => {
    const result = await cacheGet('test:nonexistent');
    expect(result).toBeNull();
  });

  test('cacheDel removes a key', async () => {
    await cacheSet('test:del', { x: 1 });
    await cacheDel('test:del');
    const result = await cacheGet('test:del');
    expect(result).toBeNull();
  });

  test('graceful fallback when Redis is unavailable', async () => {
    setClient(null); // simulate unavailable
    await expect(cacheSet('k', 'v')).resolves.toBeUndefined();
    await expect(cacheGet('k')).resolves.toBeNull();
    await expect(cacheDel('k')).resolves.toBeUndefined();
    setClient(mockRedis); // restore
  });
});

// ── Cache integration tests ───────────────────────────────────────────────────
describe('GET /api/rwa caching', () => {
  beforeAll(async () => {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(VALID_BODY);
  });

  test('response is cached after first GET /api/rwa', async () => {
    mockRedis.store.clear();
    await request(app).get('/api/rwa');
    expect(mockRedis.store.has('rwa:all')).toBe(true);
  });

  test('POST invalidates rwa:all cache', async () => {
    await request(app).get('/api/rwa'); // prime cache
    expect(mockRedis.store.has('rwa:all')).toBe(true);

    const newId = 'C' + 'E'.repeat(55);
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ ...VALID_BODY, contractId: newId });

    expect(mockRedis.store.has('rwa:all')).toBe(false);
  });

  test('DELETE invalidates rwa:all and per-asset cache', async () => {
    // prime both caches
    await request(app).get('/api/rwa');
    await request(app).get(`/api/rwa/${VALID_ID}`);
    expect(mockRedis.store.has('rwa:all')).toBe(true);
    expect(mockRedis.store.has(`rwa:${VALID_ID}`)).toBe(true);

    await request(app).delete(`/api/rwa/${VALID_ID}`).set('x-api-key', API_KEY);
    expect(mockRedis.store.has('rwa:all')).toBe(false);
    expect(mockRedis.store.has(`rwa:${VALID_ID}`)).toBe(false);
  });
});

describe('GET /api/rwa/:contractId caching', () => {
  const ID = 'C' + 'F'.repeat(55);

  beforeAll(async () => {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY)
      .send({ ...VALID_BODY, contractId: ID });
  });

  test('individual asset is cached after first GET', async () => {
    mockRedis.store.clear();
    await request(app).get(`/api/rwa/${ID}`);
    expect(mockRedis.store.has(`rwa:${ID}`)).toBe(true);
  });

  test('serves from cache on second GET', async () => {
    const cached = { contractId: ID, title: 'From Cache', location: 'X', description: 'Y', assetType: 'Z' };
    mockRedis.store.set(`rwa:${ID}`, JSON.stringify(cached));
    const res = await request(app).get(`/api/rwa/${ID}`);
    expect(res.body.title).toBe('From Cache');
  });
});
