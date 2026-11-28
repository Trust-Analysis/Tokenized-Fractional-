process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-pagination-key';
process.env.DATA_FILE = 'test-pagination-data.json';
process.env.ANOMALY_DETECTION_ENABLED = 'false';
process.env.GEO_LIMITING_ENABLED = 'false';
process.env.BILLING_INTEGRATION_ENABLED = 'false';
process.env.CURSOR_SECRET = 'test-cursor-secret';

import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app, rateLimiterService } from '../index.js';
import { applyCursorPagination, encodeCursor, decodeCursor, CursorError } from '../src/services/cursorPagination.js';

const API_KEY = 'test-pagination-key';

const ASSETS = [
  { contractId: 'C' + 'A'.repeat(55), title: 'Alpha Asset', location: 'NYC', description: 'First asset', assetType: 'Real Estate', createdAt: '2025-01-01T00:00:00.000Z' },
  { contractId: 'C' + 'B'.repeat(55), title: 'Beta Property', location: 'London', description: 'Second asset', assetType: 'Agriculture', createdAt: '2025-01-02T00:00:00.000Z' },
  { contractId: 'C' + 'C'.repeat(55), title: 'Gamma Tower', location: 'Tokyo', description: 'Third asset', assetType: 'Real Estate', createdAt: '2025-01-03T00:00:00.000Z' },
  { contractId: 'C' + 'D'.repeat(55), title: 'Delta Farm', location: 'Paris', description: 'Fourth asset', assetType: 'Agriculture', createdAt: '2025-01-04T00:00:00.000Z' },
  { contractId: 'C' + 'E'.repeat(55), title: 'Echo Mall', location: 'Dubai', description: 'Fifth asset', assetType: 'Commercial', createdAt: '2025-01-05T00:00:00.000Z' },
  { contractId: 'C' + 'F'.repeat(55), title: 'Foxtrot Hotel', location: 'Sydney', description: 'Sixth asset', assetType: 'Hospitality', createdAt: '2025-01-06T00:00:00.000Z' },
  { contractId: 'C' + 'G'.repeat(55), title: 'Golf Plaza', location: 'Mumbai', description: 'Seventh asset', assetType: 'Commercial', createdAt: '2025-01-07T00:00:00.000Z' },
  { contractId: 'C' + 'H'.repeat(55), title: 'Hotel Complex', location: 'Shanghai', description: 'Eighth asset', assetType: 'Hospitality', createdAt: '2025-01-08T00:00:00.000Z' },
];

beforeAll(async () => {
  rateLimiterService.configureApiKey(API_KEY, 'enterprise');
  for (const asset of ASSETS) {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(asset);
  }
});

afterAll(() => {
  if (existsSync('test-pagination-data.json')) unlinkSync('test-pagination-data.json');
});

describe('Cursor Pagination Service', () => {
  test('encodeCursor creates valid base64url string', () => {
    const cursor = encodeCursor('2025-01-01T00:00:00.000Z', 'Caaa', 'next', 'createdAt');
    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);
    expect(() => Buffer.from(cursor, 'base64url')).not.toThrow();
  });

  test('decodeCursor returns correct payload', () => {
    const cursor = encodeCursor('2025-01-05T00:00:00.000Z', 'Ceee', 'next', 'createdAt');
    const decoded = decodeCursor(cursor);
    expect(decoded.sortValue).toBe('2025-01-05T00:00:00.000Z');
    expect(decoded.secondarySort).toBe('Ceee');
    expect(decoded.direction).toBe('next');
    expect(decoded.sortField).toBe('createdAt');
  });

  test('decodeCursor returns null for empty input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('decodeCursor throws on malformed cursor', () => {
    expect(() => decodeCursor('not-a-valid-base64url-cursor')).toThrow(CursorError);
    expect(() => decodeCursor(Buffer.from('not-json').toString('base64url'))).toThrow(CursorError);
  });

  test('decodeCursor throws on tampered cursor', () => {
    const cursor = encodeCursor('val', 'sec', 'next', 'createdAt');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const payload = JSON.parse(decoded);
    payload.sv = 'tampered';
    payload.sig = 'fake';
    const tampered = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(() => decodeCursor(tampered)).toThrow(/signature/i);
  });

  test('applyCursorPagination returns first page by default (desc createdAt)', () => {
    const result = applyCursorPagination(ASSETS, { limit: 3 });
    expect(result.data.length).toBe(3);
    expect(result.data[0].contractId).toBe('C' + 'H'.repeat(55));
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(false);
    expect(result.pagination.total).toBe(8);
    expect(result.pagination.nextCursor).toBeDefined();
    expect(result.pagination.prevCursor).toBeUndefined();
  });

  test('applyCursorPagination supports forward pagination with after cursor', () => {
    const page1 = applyCursorPagination(ASSETS, { limit: 3 });
    expect(page1.data.length).toBe(3);

    const page2 = applyCursorPagination(ASSETS, { limit: 3, after: page1.pagination.nextCursor });
    expect(page2.data.length).toBe(3);
    expect(page2.data[0].contractId).toBe('C' + 'E'.repeat(55));
    expect(page2.pagination.hasNext).toBe(true);
    expect(page2.pagination.hasPrev).toBe(true);
  });

  test('applyCursorPagination supports backward pagination with before cursor', () => {
    const page1 = applyCursorPagination(ASSETS, { limit: 3 });
    const page2 = applyCursorPagination(ASSETS, { limit: 3, after: page1.pagination.nextCursor });
    const page3 = applyCursorPagination(ASSETS, { limit: 3, after: page2.pagination.nextCursor });
    expect(page3.data.length).toBe(2);
    expect(page3.data[0].contractId).toBe('C' + 'B'.repeat(55));
    expect(page3.pagination.hasNext).toBe(false);

    const backToPage2 = applyCursorPagination(ASSETS, { limit: 3, before: page3.pagination.prevCursor });
    expect(backToPage2.data.length).toBe(3);
    expect(backToPage2.data[0].contractId).toBe('C' + 'E'.repeat(55));
  });

  test('applyCursorPagination traverses all items page by page', () => {
    const allIds = [];
    let cursor = null;
    let pageNum = 0;

    while (true) {
      const result = applyCursorPagination(ASSETS, { limit: 2, after: cursor });
      allIds.push(...result.data.map(a => a.contractId));
      pageNum++;
      if (!result.pagination.hasNext) break;
      cursor = result.pagination.nextCursor;
    }

    expect(allIds.length).toBe(8);
    expect(pageNum).toBe(4);
    expect(allIds[0]).toBe('C' + 'H'.repeat(55));
    expect(allIds[allIds.length - 1]).toBe('C' + 'A'.repeat(55));
  });

  test('applyCursorPagination filters by assetType', () => {
    const result = applyCursorPagination(ASSETS, { limit: 10, assetType: 'agriculture' });
    expect(result.data.every(a => a.assetType.toLowerCase() === 'agriculture')).toBe(true);
    expect(result.pagination.total).toBe(2);
  });

  test('applyCursorPagination filters by search', () => {
    const result = applyCursorPagination(ASSETS, { limit: 10, search: 'asset' });
    expect(result.data.some(a => a.title.toLowerCase().includes('asset'))).toBe(true);
    expect(result.pagination.total).toBeGreaterThanOrEqual(1);
  });

  test('applyCursorPagination sorts by title ascending', () => {
    const result = applyCursorPagination(ASSETS, { limit: 10, sort: 'title', order: 'asc' });
    const titles = result.data.map(a => a.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  test('applyCursorPagination sorts by createdAt descending', () => {
    const result = applyCursorPagination(ASSETS, { limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.data[0].contractId).toBe('C' + 'H'.repeat(55));
    expect(result.data[result.data.length - 1].contractId).toBe('C' + 'A'.repeat(55));
  });

  test('applyCursorPagination enforces page size limits', () => {
    const result = applyCursorPagination(ASSETS, { limit: 200 });
    expect(result.data.length).toBeLessThanOrEqual(100);
    expect(result.pagination.limit).toBe(100);
  });

  test('applyCursorPagination returns empty data for invalid cursor', () => {
    const invalidCursor = encodeCursor('nonexistent', 'nonexistent', 'next', 'createdAt');
    expect(() => applyCursorPagination(ASSETS, { after: invalidCursor })).toThrow(/no longer exists/);
  });

  test('applyCursorPagination supports sort by totalValuation', () => {
    const assetsWithValues = ASSETS.map((a, i) => ({ ...a, totalValuation: String((10 - i) * 100000) }));
    const result = applyCursorPagination(assetsWithValues, { limit: 10, sort: 'totalValuation', order: 'desc' });
    expect(result.data[0].totalValuation).toBe('1000000');
    expect(result.data[result.data.length - 1].totalValuation).toBe('300000');
  });
});

describe('GET /api/rwa cursor pagination', () => {
  test('returns cursor-based pagination response shape', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(8);
    expect(res.body.pagination.limit).toBe(20);
    expect(typeof res.body.pagination.hasNext).toBe('boolean');
    expect(typeof res.body.pagination.hasPrev).toBe('boolean');
  });

  test('respects limit parameter', async () => {
    const res = await request(app).get('/api/rwa?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.limit).toBe(3);
  });

  test('supports forward pagination via nextCursor', async () => {
    const page1 = await request(app).get('/api/rwa?limit=3');
    expect(page1.body.pagination.hasNext).toBe(true);
    expect(page1.body.pagination.nextCursor).toBeDefined();

    const page2 = await request(app).get(`/api/rwa?limit=3&after=${page1.body.pagination.nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(3);
    expect(page2.body.data[0].contractId).not.toBe(page1.body.data[0].contractId);
    expect(page2.body.pagination.hasPrev).toBe(true);
  });

  test('supports backward pagination via prevCursor', async () => {
    const page1 = await request(app).get('/api/rwa?limit=3&sort=createdAt&order=asc');
    const page2 = await request(app).get(`/api/rwa?limit=3&sort=createdAt&order=asc&after=${page1.body.pagination.nextCursor}`);
    const page3 = await request(app).get(`/api/rwa?limit=3&sort=createdAt&order=asc&before=${page2.body.pagination.prevCursor}`);
    expect(page3.status).toBe(200);
    expect(page3.body.data.length).toBe(3);
    expect(page3.body.data[0].contractId).toBe(page1.body.data[0].contractId);
  });

  test('returns 400 for invalid cursor', async () => {
    const res = await request(app).get('/api/rwa?after=invalid-cursor-value');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('filters by assetType', async () => {
    const res = await request(app).get('/api/rwa?assetType=agriculture');
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.assetType.toLowerCase() === 'agriculture')).toBe(true);
  });

  test('filters by search', async () => {
    const res = await request(app).get('/api/rwa?search=Asset');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.title.toLowerCase().includes('asset'))).toBe(true);
  });

  test('sorts by title ascending', async () => {
    const res = await request(app).get('/api/rwa?sort=title&order=asc');
    expect(res.status).toBe(200);
    const titles = res.body.data.map(a => a.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  test('traverses all items via pagination', async () => {
    const allIds = [];
    let cursor = null;

    while (true) {
      const url = cursor ? `/api/rwa?limit=2&after=${cursor}` : '/api/rwa?limit=2';
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      allIds.push(...res.body.data.map(a => a.contractId));
      if (!res.body.pagination.hasNext) break;
      cursor = res.body.pagination.nextCursor;
    }

    expect(allIds.length).toBe(8);
  });

  test('returns correct total count', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(8);
  });
});

describe('GET /api/rwa backward compatibility', () => {
  test('handles empty dataset gracefully', async () => {
    const res = await request(app).get('/api/rwa?search=nonexistentxyz');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.hasNext).toBe(false);
    expect(res.body.pagination.hasPrev).toBe(false);
  });

  test('single page when items fit in one request', async () => {
    const res = await request(app).get('/api/rwa?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.pagination.hasNext).toBe(false);
    expect(res.body.pagination.hasPrev).toBe(false);
  });
});
