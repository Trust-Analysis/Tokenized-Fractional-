// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/apiKeys.test.js — Tests for API key management routes and service
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

describe('API Key Management', () => {
  // Helper: Create a test API key for use in authenticated requests
  async function createTestKey() {
    const res = await request(app).post('/api/v1/api-keys').set('x-api-key', testApiKey).send({
      name: 'test-key-for-tests',
      description: 'Used for testing',
    });

    if (res.status !== 201) {
      throw new Error(`Failed to create test key: ${res.body.error}`);
    }

    testApiKey = res.body.key;
    return res.body;
  }

  describe('Bootstrapping', () => {
    test('should create first admin API key via direct database access', async () => {
      const apiKeyService = createApiKeyService(db, console);

      const result = await apiKeyService.create({
        name: 'Bootstrap Admin Key',
        description: 'Initial admin key for local testing',
      });

      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('Bootstrap Admin Key');
      expect(result.key).toMatch(/^rwa_/);

      testApiKey = result.key;
    });
  });

  describe('POST /api/v1/api-keys', () => {
    test('should create a new API key', async () => {
      const res = await request(app).post('/api/v1/api-keys').set('x-api-key', testApiKey).send({
        name: 'Production API Key',
        description: 'For production environment',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('key');
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Production API Key');
      expect(res.body.description).toBe('For production environment');
      expect(res.body.key).toMatch(/^rwa_/);
    });

    test('should create an API key with expiration', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app).post('/api/v1/api-keys').set('x-api-key', testApiKey).send({
        name: 'Expiring Key',
        expiresAt: futureDate,
      });

      expect(res.status).toBe(201);
      expect(res.body.expiresAt).toBeDefined();
    });

    test('should reject key creation without name', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ description: 'No name' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name');
    });

    test('should reject past expiration dates', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const res = await request(app).post('/api/v1/api-keys').set('x-api-key', testApiKey).send({
        name: 'Past Expiry Key',
        expiresAt: pastDate,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('future');
    });

    test('should reject invalid date format', async () => {
      const res = await request(app).post('/api/v1/api-keys').set('x-api-key', testApiKey).send({
        name: 'Bad Date Key',
        expiresAt: 'not-a-date',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ISO 8601');
    });

    test('should require authentication', async () => {
      const res = await request(app).post('/api/v1/api-keys').send({ name: 'Unauth Key' });

      expect(res.status).toBe(401);
    });

    test('should reject invalid API key', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', 'invalid-key-xyz')
        .send({ name: 'Invalid Auth Key' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys', () => {
    test('should list all active API keys', async () => {
      // Create a couple of keys first
      await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'Key 1' });

      await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'Key 2' });

      const res = await request(app).get('/api/v1/api-keys').set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('name');
      // The actual key material should never be returned
      expect(res.body.data[0]).not.toHaveProperty('key');
    });

    test('should exclude revoked keys by default', async () => {
      // Create and revoke a key
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'To Revoke' });

      await request(app)
        .delete(`/api/v1/api-keys/${createRes.body.id}`)
        .set('x-api-key', testApiKey);

      const listRes = await request(app).get('/api/v1/api-keys').set('x-api-key', testApiKey);

      const revokedInList = listRes.body.data.some((k) => k.id === createRes.body.id);
      expect(revokedInList).toBe(false);
    });

    test('should include revoked keys when requested', async () => {
      const listRes = await request(app)
        .get('/api/v1/api-keys?includeRevoked=true')
        .set('x-api-key', testApiKey);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toBeInstanceOf(Array);
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/api-keys');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys/:id', () => {
    test('should return key details', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'Details Test Key' });

      const detailsRes = await request(app)
        .get(`/api/v1/api-keys/${createRes.body.id}`)
        .set('x-api-key', testApiKey);

      expect(detailsRes.status).toBe(200);
      expect(detailsRes.body.id).toBe(createRes.body.id);
      expect(detailsRes.body.name).toBe('Details Test Key');
      expect(detailsRes.body).toHaveProperty('createdAt');
    });

    test('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys/key_nonexistent')
        .set('x-api-key', testApiKey);

      expect(res.status).toBe(404);
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/api-keys/key_xyz');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys/:id/usage', () => {
    test('should return usage statistics', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'Usage Test Key' });

      // Use the key to trigger usage tracking
      await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', createRes.body.key)
        .send({ name: 'Another Key' });

      const usageRes = await request(app)
        .get(`/api/v1/api-keys/${createRes.body.id}/usage`)
        .set('x-api-key', testApiKey);

      expect(usageRes.status).toBe(200);
      expect(usageRes.body.id).toBe(createRes.body.id);
      expect(usageRes.body.usageCount).toBeGreaterThanOrEqual(1);
      expect(usageRes.body).toHaveProperty('lastUsedAt');
    });

    test('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys/key_nonexistent/usage')
        .set('x-api-key', testApiKey);

      expect(res.status).toBe(404);
    });

    test('should require authentication', async () => {
      const res = await request(app).get('/api/v1/api-keys/key_xyz/usage');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/api-keys/:id/rotate', () => {
    test('should rotate an API key', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'To Rotate' });

      const rotateRes = await request(app)
        .post(`/api/v1/api-keys/${createRes.body.id}/rotate`)
        .set('x-api-key', testApiKey)
        .send({});

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.oldKey.id).toBe(createRes.body.id);
      expect(rotateRes.body.newKey).toHaveProperty('key');
      expect(rotateRes.body.newKey).toHaveProperty('id');
      expect(rotateRes.body.newKey.id).not.toBe(createRes.body.id);
      expect(rotateRes.body.oldKey).toHaveProperty('revokedAt');
    });

    test('should allow specifying new expiration during rotation', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'To Rotate With Expiry' });

      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const rotateRes = await request(app)
        .post(`/api/v1/api-keys/${createRes.body.id}/rotate`)
        .set('x-api-key', testApiKey)
        .send({ expiresAt: futureDate });

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.newKey.expiresAt).toBeDefined();
    });

    test('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys/key_nonexistent/rotate')
        .set('x-api-key', testApiKey)
        .send({});

      expect(res.status).toBe(404);
    });

    test('should reject rotation of already revoked key', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'Already Revoked' });

      // Revoke the key
      await request(app)
        .delete(`/api/v1/api-keys/${createRes.body.id}`)
        .set('x-api-key', testApiKey);

      // Try to rotate
      const rotateRes = await request(app)
        .post(`/api/v1/api-keys/${createRes.body.id}/rotate`)
        .set('x-api-key', testApiKey)
        .send({});

      expect(rotateRes.status).toBe(400);
      expect(rotateRes.body.error).toContain('revoked');
    });

    test('should require authentication', async () => {
      const res = await request(app).post('/api/v1/api-keys/key_xyz/rotate').send({});

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/api-keys/:id', () => {
    test('should revoke (soft delete) an API key by default', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'To Revoke' });

      const deleteRes = await request(app)
        .delete(`/api/v1/api-keys/${createRes.body.id}`)
        .set('x-api-key', testApiKey);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('revoked');
      expect(deleteRes.body.revokedAt).toBeDefined();

      // Try to use the revoked key
      const useRes = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', createRes.body.key);

      expect(useRes.status).toBe(401);
      expect(useRes.body.error).toContain('revoked');
    });

    test('should hard delete with hardDelete query parameter', async () => {
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({ name: 'To Hard Delete' });

      const deleteRes = await request(app)
        .delete(`/api/v1/api-keys/${createRes.body.id}?hardDelete=true`)
        .set('x-api-key', testApiKey);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('deleted permanently');

      // Key should not exist anymore
      const detailsRes = await request(app)
        .get(`/api/v1/api-keys/${createRes.body.id}`)
        .set('x-api-key', testApiKey);

      expect(detailsRes.status).toBe(404);
    });

    test('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .delete('/api/v1/api-keys/key_nonexistent')
        .set('x-api-key', testApiKey);

      expect(res.status).toBe(404);
    });

    test('should require authentication', async () => {
      const res = await request(app).delete('/api/v1/api-keys/key_xyz');
      expect(res.status).toBe(401);
    });
  });

  describe('API Key Expiration', () => {
    test('should reject expired keys', async () => {
      // Create a key that expires in 1 second
      const expiresSoon = new Date(Date.now() + 1000).toISOString();
      const createRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testApiKey)
        .send({
          name: 'Expiring Soon',
          expiresAt: expiresSoon,
        });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Try to use the expired key
      const useRes = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', createRes.body.key);

      expect(useRes.status).toBe(401);
      expect(useRes.body.error).toContain('expired');
    });
  });

  describe('Backward Compatibility', () => {
    test('should work with /api/api-keys (without /v1)', async () => {
      const res = await request(app).get('/api/api-keys').set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });
  });
});
