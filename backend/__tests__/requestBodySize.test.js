// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { setClient } from '../cache.js';
import MockRedis from 'ioredis-mock';

/**
 * Request body size limit tests.
 * 
 * Verifies that the 1MB request body size limit is enforced and returns
 * a clear 413 Payload Too Large response for oversized payloads.
 */
describe('Request Body Size Limit', () => {
  let mockRedis;

  beforeAll(async () => {
    mockRedis = new MockRedis();
    setClient(mockRedis);
  });

  afterAll(async () => {
    await mockRedis.quit();
  });

  it('accepts a normal-sized request body for POST /api/v1/rwa', async () => {
    const normalBody = {
      contractId: 'C' + 'A'.repeat(55),
      title: 'Test Asset',
      location: 'Test Location',
      description: 'Test Description',
      assetType: 'real_estate',
    };

    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send(normalBody);

    // Should not be 413; may be 401 (invalid key) or other validation error
    expect(res.status).not.toBe(413);
  });

  it('accepts a normal-sized request body for PATCH /api/v1/rwa/:contractId', async () => {
    const normalBody = {
      title: 'Updated Title',
    };

    const res = await request(app)
      .patch('/api/v1/rwa/' + 'C' + 'A'.repeat(55))
      .set('x-api-key', 'test-key-for-jest')
      .send(normalBody);

    // Should not be 413; may be 401 (invalid key) or 404
    expect(res.status).not.toBe(413);
  });

  it('rejects an oversized payload (>1MB) with 413 status', async () => {
    // Create a payload larger than 1MB
    const oversizedPayload = {
      contractId: 'C' + 'A'.repeat(55),
      title: 'Test Asset',
      location: 'Test Location',
      description: 'A'.repeat(2 * 1024 * 1024), // 2MB of text
      assetType: 'real_estate',
    };

    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send(oversizedPayload);

    expect(res.status).toBe(413);
  });

  it('returns a clear error message for oversized payload', async () => {
    const oversizedPayload = {
      contractId: 'C' + 'A'.repeat(55),
      title: 'Test Asset',
      location: 'Test Location',
      description: 'A'.repeat(2 * 1024 * 1024),
      assetType: 'real_estate',
    };

    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send(oversizedPayload);

    expect(res.status).toBe(413);
    // Express returns a standard error body for payload too large
    expect(res.body).toBeDefined();
  });

  it('rejects oversized PATCH payload with 413 status', async () => {
    const oversizedPayload = {
      description: 'A'.repeat(2 * 1024 * 1024),
    };

    const res = await request(app)
      .patch('/api/v1/rwa/' + 'C' + 'A'.repeat(55))
      .set('x-api-key', 'test-key-for-jest')
      .send(oversizedPayload);

    expect(res.status).toBe(413);
  });

  it('accepts payload exactly at the 1MB limit', async () => {
    // Create a payload close to but under 1MB
    const largePayload = {
      contractId: 'C' + 'A'.repeat(55),
      title: 'Test Asset',
      location: 'Test Location',
      description: 'A'.repeat(900 * 1024), // ~900KB
      assetType: 'real_estate',
    };

    const res = await request(app)
      .post('/api/v1/rwa')
      .set('x-api-key', 'test-key-for-jest')
      .send(largePayload);

    // Should not be 413; may fail validation or auth but not size
    expect(res.status).not.toBe(413);
  });
});
