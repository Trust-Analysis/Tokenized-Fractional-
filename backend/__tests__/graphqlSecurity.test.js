// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect } from '@jest/globals';
import { calculateQueryComplexity, createGraphQLPlaygroundSecurityMiddleware } from '../graphql.js';
import express from 'express';
import request from 'supertest';

describe('GraphQL Playground Security Hardening (#286)', () => {
  describe('Query Complexity Calculator', () => {
    it('calculates query depth and field counts correctly', () => {
      const query = `
        query GetAsset {
          asset(contractId: "C123") {
            title
            location
            documents {
              name
              hash
            }
          }
        }
      `;

      const complexity = calculateQueryComplexity(query);
      expect(complexity.depth).toBeGreaterThan(1);
      expect(complexity.fieldCount).toBeGreaterThan(0);
    });
  });

  describe('Playground Security Middleware', () => {
    it('disables GraphQL Playground in production unless explicitly enabled', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_GRAPHQL_PLAYGROUND;

      const app = express();
      app.use(express.json());
      app.use(createGraphQLPlaygroundSecurityMiddleware());
      app.get('/graphql', (_req, res) => res.send('OK'));

      const res = await request(app).get('/graphql');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('GraphQL Playground is disabled in production');

      process.env.NODE_ENV = origEnv;
    });

    it('rejects queries exceeding max complexity depth', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGraphQLPlaygroundSecurityMiddleware({ maxDepth: 2 }));
      app.post('/graphql', (_req, res) => res.send('OK'));

      const deeplyNestedQuery = `
        query {
          assets {
            documents {
              hash
            }
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .send({ query: deeplyNestedQuery });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Query complexity limit exceeded');
    });

    it('enforces IP whitelisting when configured', async () => {
      const app = express();
      app.use(express.json());
      app.use(createGraphQLPlaygroundSecurityMiddleware({ allowedIps: ['127.0.0.1'] }));
      app.get('/graphql', (_req, res) => res.send('OK'));

      const res = await request(app).get('/graphql').set('x-forwarded-for', '192.168.1.100');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('IP address not authorized');
    });
  });
});
