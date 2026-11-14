// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/statementsAuth.test.js — Issue #908: Statements Authentication & IDOR Protection Tests
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createStatementRoutes } from '../src/routes/statements.js';

describe('Issue #908: Statements Authentication & IDOR Protection', () => {
  let app;
  const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/statements', createStatementRoutes());
  });

  function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
  }

  test('blocks unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/v1/statements/2026-05');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  test('prevents IDOR: non-admin user cannot request another user statement', async () => {
    const userToken = generateToken({ id: 'user_123', role: 'user' });

    const res = await request(app)
      .get('/api/v1/statements/2026-05?userId=victim_999')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.error).toContain('You may only generate statements for your own account');
  });

  test('non-admin user can generate statement for their own account', async () => {
    const userToken = generateToken({ id: 'user_123', role: 'user' });

    const res = await request(app)
      .get('/api/v1/statements/2026-05')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-statement-sha256']).toBeDefined();
  });

  test('admin user can generate statement for any user via query parameter', async () => {
    const adminToken = generateToken({ id: 'admin_1', role: 'admin' });

    const res = await request(app)
      .get('/api/v1/statements/2026-05?userId=client_456')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('client_456');
  });

  test('admin API key can access statements for any user', async () => {
    const res = await request(app)
      .get('/api/v1/statements/2026-05?userId=client_789')
      .set('x-api-key', 'admin-super-key');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('client_789');
  });
});
