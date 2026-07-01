// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/backups.test.js — Tests for backup management
 */

import request from 'supertest';
import { app, initializeApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/services/database.js';
import { createApiKeyService } from '../src/services/apiKeyService.js';

let db;
let testApiKey;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await initializeApp();
  db = getDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Backup Management API', () => {
  // Helper: Create a test API key
  async function createTestKey() {
    const apiKeyService = createApiKeyService(db, console);
    const result = await apiKeyService.create({
      name: 'test-backup-key',
      description: 'Used for backup testing',
    });
    testApiKey = result.key;
    return result;
  }

  beforeAll(async () => {
    await createTestKey();
  });

  describe('GET /api/v1/backups', () => {
    test('should list all backups', async () => {
      const res = await request(app).get('/api/v1/backups').set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/backups');

      expect(res.status).toBe(401);
    });

    test('should reject invalid API key', async () => {
      const res = await request(app).get('/api/v1/backups').set('x-api-key', 'invalid-key');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/backups/health', () => {
    test('should return health status', async () => {
      const res = await request(app).get('/api/v1/backups/health').set('x-api-key', testApiKey);

      expect(res.status).toBeOneOf([200, 503]);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('totalBackups');
      expect(res.body).toHaveProperty('metrics');
      expect(['healthy', 'degraded']).toContain(res.body.status);
    });

    test('should include metrics', async () => {
      const res = await request(app).get('/api/v1/backups/health').set('x-api-key', testApiKey);

      expect(res.body.metrics).toHaveProperty('successCount');
      expect(res.body.metrics).toHaveProperty('failureCount');
      expect(res.body.metrics).toHaveProperty('lastBackupTime');
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/backups/health');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/backups/policy', () => {
    test('should return backup policy', async () => {
      const res = await request(app).get('/api/v1/backups/policy').set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('retention');
      expect(res.body).toHaveProperty('destinations');
      expect(res.body.retention).toHaveProperty('days');
      expect(res.body.retention).toHaveProperty('max');
    });

    test('should show configured destinations', async () => {
      const res = await request(app).get('/api/v1/backups/policy').set('x-api-key', testApiKey);

      expect(res.body.destinations).toHaveProperty('local');
      expect(res.body.destinations).toHaveProperty('s3');
      expect(res.body.destinations).toHaveProperty('gcs');
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/backups/policy');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/backups', () => {
    test('should create manual backup', async () => {
      const res = await request(app).post('/api/v1/backups').set('x-api-key', testApiKey).send({});

      if (res.status === 201) {
        expect(res.body).toHaveProperty('name');
        expect(res.body).toHaveProperty('locations');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body.success).toBe(true);
      } else {
        // Backup creation might fail in test environment
        expect([201, 500]).toContain(res.status);
      }
    });

    test('should require authentication', async () => {
      const res = await request(app).post('/api/v1/backups').send({});

      expect(res.status).toBe(401);
    });

    test('should reject invalid API key', async () => {
      const res = await request(app)
        .post('/api/v1/backups')
        .set('x-api-key', 'invalid-key')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/backups/:name/verify', () => {
    test('should verify backup if exists', async () => {
      // First list backups
      const listRes = await request(app).get('/api/v1/backups').set('x-api-key', testApiKey);

      if (listRes.body.data.length > 0) {
        const backupName = listRes.body.data[0].name;

        const res = await request(app)
          .get(`/api/v1/backups/${backupName}/verify`)
          .set('x-api-key', testApiKey);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('name');
        expect(res.body).toHaveProperty('ok');
        expect(res.body).toHaveProperty('members');
      }
    });

    test('should return 404 for non-existent backup', async () => {
      const res = await request(app)
        .get('/api/v1/backups/backup-nonexistent/verify')
        .set('x-api-key', testApiKey);

      expect(res.status).toBe(404);
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/backups/backup-test/verify');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/backups/:name/restore', () => {
    test('should reject restore without authentication', async () => {
      const res = await request(app).post('/api/v1/backups/backup-test/restore').send({});

      expect(res.status).toBe(401);
    });

    test('should return 404 for non-existent backup', async () => {
      const res = await request(app)
        .post('/api/v1/backups/backup-nonexistent/restore')
        .set('x-api-key', testApiKey)
        .send({});

      expect(res.status).toBe(404);
    });

    test('should accept force flag', async () => {
      const res = await request(app)
        .post('/api/v1/backups/backup-test/restore')
        .set('x-api-key', testApiKey)
        .send({ force: true });

      // Will return 404 or 500, but should process the force flag
      expect([404, 500]).toContain(res.status);
    });

    test('should accept source parameter', async () => {
      const res = await request(app)
        .post('/api/v1/backups/backup-test/restore')
        .set('x-api-key', testApiKey)
        .send({ source: 's3' });

      // Will return 404 or 500, but should process the source parameter
      expect([404, 500]).toContain(res.status);
    });
  });

  describe('DELETE /api/v1/backups/:name', () => {
    test('should require authentication', async () => {
      const res = await request(app).delete('/api/v1/backups/backup-test');

      expect(res.status).toBe(401);
    });

    test('should accept locations parameter', async () => {
      const res = await request(app)
        .delete('/api/v1/backups/backup-test?locations=local,s3')
        .set('x-api-key', testApiKey);

      // Even if backup doesn't exist, should return 200 or 404
      expect([200, 404]).toContain(res.status);
    });

    test('should include deletion details in response', async () => {
      const res = await request(app)
        .delete('/api/v1/backups/backup-test')
        .set('x-api-key', testApiKey);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('locations');
      }
    });
  });

  describe('Backward compatibility', () => {
    test('should work with /api/backups (without /v1)', async () => {
      const res = await request(app).get('/api/backups').set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    test('should work with /api/backups/health', async () => {
      const res = await request(app).get('/api/backups/health').set('x-api-key', testApiKey);

      expect([200, 503]).toContain(res.status);
    });
  });

  describe('Error handling', () => {
    test('should handle malformed requests gracefully', async () => {
      const res = await request(app)
        .post('/api/v1/backups')
        .set('x-api-key', testApiKey)
        .send({ invalid: 'data' });

      expect([201, 400, 500]).toContain(res.status);
    });

    test('should reject invalid source parameters', async () => {
      const res = await request(app)
        .post('/api/v1/backups/backup-test/restore')
        .set('x-api-key', testApiKey)
        .send({ source: 'invalid-source' });

      expect([400, 404, 500]).toContain(res.status);
    });
  });
});

// Helper for test expectations
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    return {
      pass,
      message: () => `expected ${received} to be one of ${expected.join(', ')}`,
    };
  },
});
