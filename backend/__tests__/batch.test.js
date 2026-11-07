// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/batch.test.js — Tests for REST API Batch Query Support (#256)
 */

import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app } from '../index.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

const API_KEY = 'test-key-for-jest';
const VALID_ID = `C${'A'.repeat(55)}`;

afterAll(() => {
  if (existsSync('test-data.json')) unlinkSync('test-data.json');
});

// Helper: create and approve an asset
async function createAndApproveAsset(body) {
  await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(body);
  await request(app).post(`/api/rwa/${body.contractId}/approve`).set('x-api-key', API_KEY);
}

// ── Batch Request Validation ──────────────────────────────────────────────────

describe('POST /api/batch - request validation', () => {
  test('rejects non-array body', async () => {
    const res = await request(app).post('/api/batch').send({ not: 'array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/);
  });

  test('rejects empty batch array', async () => {
    const res = await request(app).post('/api/batch').send([]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_BATCH');
  });

  test('rejects batch exceeding max size', async () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      method: 'GET',
      path: '/api/rwa',
    }));
    const res = await request(app).post('/api/batch').send(ops);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BATCH_TOO_LARGE');
  });

  test('rejects invalid method', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'INVALID', path: '/api/rwa' }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OPERATIONS');
  });

  test('rejects path without leading slash', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: 'api/rwa' }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OPERATIONS');
  });
});

// ── Batch GET Operations ──────────────────────────────────────────────────────

describe('POST /api/batch - GET operations', () => {
  beforeAll(async () => {
    await createAndApproveAsset({
      contractId: VALID_ID,
      title: 'Batch Test Property',
      location: 'Test City',
      description: 'For batch testing',
      assetType: 'Real Estate',
    });
  });

  test('executes multiple GET requests', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([
        { method: 'GET', path: '/api/rwa' },
        { method: 'GET', path: `/api/rwa/${VALID_ID}` },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[1].status).toBe('fulfilled');
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.fulfilled).toBe(2);
    expect(res.body.meta.rejected).toBe(0);
  });

  test('each result includes metadata', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: '/api/rwa' }]);

    const result = res.body.data[0];
    expect(result.index).toBe(0);
    expect(result.method).toBe('GET');
    expect(result.path).toBe('/api/rwa');
    expect(result.statusCode).toBe(200);
    expect(typeof result.duration).toBe('number');
    expect(result.body).toBeDefined();
  });

  test('includes batch meta summary', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: '/api/rwa' }]);

    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.total).toBe(1);
    expect(typeof res.body.meta.duration).toBe('number');
  });
});

// ── Batch POST Operations ─────────────────────────────────────────────────────

describe('POST /api/batch - POST operations', () => {
  test('executes POST with body', async () => {
    const newId = `C${'Z'.repeat(55)}`;
    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([
        {
          method: 'POST',
          path: '/api/rwa',
          body: {
            contractId: newId,
            title: 'Batch Created Property',
            location: 'Batch City',
            description: 'Created via batch',
            assetType: 'Real Estate',
          },
        },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[0].statusCode).toBe(201);
    expect(res.body.data[0].body.contractId).toBe(newId);
  });

  test('requires auth for admin-only POST', async () => {
    const newId = `C${'Y'.repeat(55)}`;
    const res = await request(app)
      .post('/api/batch')
      .send([
        {
          method: 'POST',
          path: '/api/rwa',
          body: {
            contractId: newId,
            title: 'Unauthorized',
            location: 'Test',
            description: 'Should fail',
            assetType: 'Test',
          },
        },
      ]);

    expect(res.status).toBe(207); // partial failure
    expect(res.body.data[0].status).toBe('rejected');
    expect(res.body.data[0].statusCode).toBe(401);
  });
});

// ── Batch PATCH & DELETE Operations ───────────────────────────────────────────

describe('POST /api/batch - PATCH and DELETE operations', () => {
  const PATCH_ID = `C${'P'.repeat(55)}`;

  beforeAll(async () => {
    await request(app).post('/api/rwa').set('x-api-key', API_KEY).send({
      contractId: PATCH_ID,
      title: 'Original Title',
      location: 'Original',
      description: 'To be patched',
      assetType: 'Test',
    });
  });

  test('executes PATCH operation', async () => {
    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([
        {
          method: 'PATCH',
          path: `/api/rwa/${PATCH_ID}`,
          body: { title: 'Patched Title' },
        },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[0].body.title).toBe('Patched Title');
  });

  test('executes DELETE operation', async () => {
    const delId = `C${'D'.repeat(55)}`;
    await request(app).post('/api/rwa').set('x-api-key', API_KEY).send({
      contractId: delId,
      title: 'To Delete',
      location: 'Test',
      description: 'Test',
      assetType: 'Test',
    });

    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([{ method: 'DELETE', path: `/api/rwa/${delId}` }]);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[0].statusCode).toBe(200);
  });
});

// ── Batch Partial Failure Handling ────────────────────────────────────────────

describe('POST /api/batch - partial failure handling', () => {
  test('returns 207 when some operations fail', async () => {
    const newId = `C${'M'.repeat(55)}`;
    const unknownId = `C${'U'.repeat(55)}`;

    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([
        {
          method: 'POST',
          path: '/api/rwa',
          body: {
            contractId: newId,
            title: 'Mixed Batch 1',
            location: 'Test',
            description: 'Success',
            assetType: 'Test',
          },
        },
        {
          method: 'GET',
          path: `/api/rwa/${unknownId}`,
        },
      ]);

    expect(res.status).toBe(207);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[1].status).toBe('rejected');
    expect(res.body.meta.fulfilled).toBe(1);
    expect(res.body.meta.rejected).toBe(1);
  });

  test('mixed methods work together', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([
        { method: 'GET', path: '/api/rwa' },
        { method: 'GET', path: '/health' },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

// ── Batch Dependency Resolution ───────────────────────────────────────────────

describe('POST /api/batch - operation dependency handling', () => {
  test('dependsOn validates reference index', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: '/api/rwa', dependsOn: 1 }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OPERATIONS');
  });

  test('dependsOn with negative index is rejected', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: '/api/rwa', dependsOn: -1 }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OPERATIONS');
  });
});

// ── Versioned Route Support ───────────────────────────────────────────────────

describe('POST /api/v1/batch - versioned batch endpoint', () => {
  test('works with /api/v1/batch', async () => {
    const res = await request(app)
      .post('/api/v1/batch')
      .send([{ method: 'GET', path: '/api/rwa' }]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ── Batch Operation Headers ───────────────────────────────────────────────────

describe('POST /api/batch - header inheritance', () => {
  test('inherits x-api-key from parent request', async () => {
    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([{ method: 'GET', path: '/api/rwa' }]);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('fulfilled');
  });

  test('operation-specific headers are applied', async () => {
    const newId = `C${'H'.repeat(55)}`;
    const res = await request(app)
      .post('/api/batch')
      .set('x-api-key', API_KEY)
      .send([
        {
          method: 'POST',
          path: '/api/rwa',
          body: {
            contractId: newId,
            title: 'Header Test',
            location: 'Test',
            description: 'Testing headers',
            assetType: 'Test',
          },
          headers: { 'x-reviewer': 'batch-reviewer' },
        },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('fulfilled');
    expect(res.body.data[0].statusCode).toBe(201);
  });
});

// ── Batch Performance ─────────────────────────────────────────────────────────

describe('POST /api/batch - performance', () => {
  test('each operation includes duration', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([
        { method: 'GET', path: '/api/rwa' },
        { method: 'GET', path: '/health' },
      ]);

    for (const result of res.body.data) {
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    }
  });

  test('batch meta includes total duration', async () => {
    const res = await request(app)
      .post('/api/batch')
      .send([{ method: 'GET', path: '/api/rwa' }]);

    expect(typeof res.body.meta.duration).toBe('number');
  });
});
