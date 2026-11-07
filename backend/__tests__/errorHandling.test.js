// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { setClient } from '../cache.js';
import MockRedis from 'ioredis-mock';

/**
 * Centralized error-handling middleware tests.
 * 
 * Verifies that the problem-details error handler returns consistent
 * RFC 7807 responses and never leaks stack traces in production.
 */
describe('Centralized Error-Handling Middleware', () => {
  let mockRedis;

  beforeAll(async () => {
    mockRedis = new MockRedis();
    setClient(mockRedis);
  });

  afterAll(async () => {
    await mockRedis.quit();
  });

  it('returns consistent RFC 7807 problem+json response for errors', async () => {
    const res = await request(app).get('/non-existent-route-xyz-123');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toHaveProperty('type');
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('detail');
    expect(res.body).toHaveProperty('instance');
  });

  it('includes required RFC 7807 fields in error response', async () => {
    const res = await request(app).get('/non-existent-route');

    expect(res.body.type).toBeDefined();
    expect(res.body.title).toBeDefined();
    expect(res.body.status).toBe(404);
    expect(res.body.detail).toBeDefined();
    expect(res.body.instance).toBeDefined();
  });

  it('never includes stack trace in error response', async () => {
    const res = await request(app).get('/non-existent-route');

    expect(res.body.stack).toBeUndefined();
    expect(res.body.message).toBeUndefined(); // Should use 'detail' instead
  });

  it('returns consistent error shape for validation errors', async () => {
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send({ invalid: 'data' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toHaveProperty('type');
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('detail');
  });

  it('includes error code when provided', async () => {
    const contractId = 'C' + 'A'.repeat(55);
    
    // First create an asset
    await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send({
        contractId,
        title: 'Test Asset',
        location: 'Test Location',
        description: 'Test Description',
        assetType: 'real_estate',
      });

    // Try to create again - should return 409 with code
    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send({
        contractId,
        title: 'Test Asset 2',
        location: 'Test Location',
        description: 'Test Description',
        assetType: 'real_estate',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSET_ALREADY_EXISTS');
  });

  it('includes requestId in error response when available', async () => {
    const res = await request(app)
      .get('/non-existent-route')
      .set('X-Request-ID', 'test-request-123');

    expect(res.status).toBe(404);
    expect(res.body.requestId).toBeDefined();
  });
});
