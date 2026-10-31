// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import {
  createGraphQLRateLimiter,
  GRAPHQL_RATE_LIMIT_TIERS,
  getUserTier,
} from '../src/middleware/tieredRateLimiter.js';

describe('GraphQL Tiered Rate Limiting (Issue #464)', () => {
  test('tier configuration matches specification: 100 req/min anon, 1000 req/min auth', () => {
    expect(GRAPHQL_RATE_LIMIT_TIERS.anonymous.max).toBe(100);
    expect(GRAPHQL_RATE_LIMIT_TIERS.anonymous.windowMs).toBe(60 * 1000);

    expect(GRAPHQL_RATE_LIMIT_TIERS.authenticated.max).toBe(1000);
    expect(GRAPHQL_RATE_LIMIT_TIERS.authenticated.windowMs).toBe(60 * 1000);

    expect(GRAPHQL_RATE_LIMIT_TIERS.admin.max).toBe(10000);
    expect(GRAPHQL_RATE_LIMIT_TIERS.admin.windowMs).toBe(60 * 1000);
  });

  test('detects correct tiers based on headers and request context', () => {
    // Anonymous
    expect(getUserTier({ headers: {} })).toBe('anonymous');

    // Authenticated via x-wallet-address
    expect(getUserTier({ headers: { 'x-wallet-address': 'GBXYZ...' } })).toBe('authenticated');

    // Authenticated via Authorization header
    expect(getUserTier({ headers: { authorization: 'Bearer token123' } })).toBe('authenticated');

    // Authenticated via req.wallet
    expect(getUserTier({ headers: {}, wallet: 'GBXYZ...' })).toBe('authenticated');

    // Admin via x-api-key
    expect(getUserTier({ headers: { 'x-api-key': 'admin-key' } })).toBe('admin');
  });

  test('sets rate limit headers on GraphQL requests', async () => {
    const app = express();
    app.use('/graphql', createGraphQLRateLimiter({
      tiers: {
        anonymous: { max: 100, windowMs: 60000 },
        authenticated: { max: 1000, windowMs: 60000 },
      },
    }));
    app.post('/graphql', (req, res) => res.json({ data: { message: 'success' } }));

    const res = await request(app)
      .post('/graphql')
      .send({ query: '{ assets { id } }' });

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('100');
    expect(res.headers['x-ratelimit-remaining']).toBe('99');
    expect(res.headers['x-ratelimit-tier']).toBe('anonymous');
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  test('recognizes authenticated user and applies 1000 limit', async () => {
    const app = express();
    app.use('/graphql', createGraphQLRateLimiter({
      tiers: {
        anonymous: { max: 100, windowMs: 60000 },
        authenticated: { max: 1000, windowMs: 60000 },
      },
    }));
    app.post('/graphql', (req, res) => res.json({ data: { message: 'success' } }));

    const res = await request(app)
      .post('/graphql')
      .set('x-wallet-address', 'GBAUTHUSER123')
      .send({ query: '{ assets { id } }' });

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('1000');
    expect(res.headers['x-ratelimit-remaining']).toBe('999');
    expect(res.headers['x-ratelimit-tier']).toBe('authenticated');
  });

  test('returns standardized HTTP 429 Too Many Requests response with Retry-After header', async () => {
    const app = express();
    // Configure small limit to test threshold breach
    app.use('/graphql', createGraphQLRateLimiter({
      tiers: {
        anonymous: { max: 2, windowMs: 60000 },
        authenticated: { max: 5, windowMs: 60000 },
      },
    }));
    app.post('/graphql', (req, res) => res.json({ data: { message: 'ok' } }));

    // Request 1
    const res1 = await request(app).post('/graphql').send({ query: '{ test }' });
    expect(res1.status).toBe(200);

    // Request 2
    const res2 = await request(app).post('/graphql').send({ query: '{ test }' });
    expect(res2.status).toBe(200);

    // Request 3 (exceeds limit 2)
    const res3 = await request(app).post('/graphql').send({ query: '{ test }' });
    expect(res3.status).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();
    expect(res3.body).toMatchObject({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      tier: 'anonymous',
    });
    expect(res3.body.retryAfter).toBeGreaterThan(0);
    expect(res3.body.message).toContain('Rate limit exceeded for anonymous users');
  });
});
