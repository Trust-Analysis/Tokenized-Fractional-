// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import {
  metricsMiddleware,
  metricsHandler,
  metricsAuthMiddleware,
  createMetricsAuthMiddleware,
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestErrors,
  websocketActiveConnections,
  dbPoolUtilization,
  dbPoolConnections,
  rwaTotalAssets,
  rwaAssetsByType,
  rwaPurchasesTotal,
  rwaPurchaseVolumeTotal,
  rwaUniqueBuyersTotal,
  rwaPurchasesProcessed,
  recordPurchaseMetric,
  setMetricsTransactionService,
  setMetricsApiKeyService,
  normalizeRoute,
  register,
} from '../src/services/metricsService.js';
import { wsManager } from '../websocket.js';

describe('Prometheus Metrics Observability & Production Authentication', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(metricsMiddleware);
    app.get('/metrics', metricsHandler);
    app.get('/test-success', (req, res) => res.json({ status: 'ok' }));
    app.get('/test-error', (req, res) => res.status(500).json({ error: 'failure' }));
    app.get('/api/v1/rwa/:contractId', (req, res) => res.json({ contractId: req.params.contractId }));
  });

  describe('Core Metrics & Route Tracking', () => {
    test('GET /metrics returns 200 with Prometheus formatted metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(typeof res.text).toBe('string');
    });

    test('tracks HTTP request durations and total counts per route', async () => {
      await request(app).get('/test-success');

      const metricsText = await register.metrics();
      expect(metricsText).toContain('http_request_duration_seconds');
      expect(metricsText).toContain('http_requests_total');
      expect(metricsText).toContain('route="/test-success"');
      expect(metricsText).toContain('status_code="200"');
    });

    test('tracks HTTP error rates per route when errors occur', async () => {
      await request(app).get('/test-error');

      const metricsText = await register.metrics();
      expect(metricsText).toContain('http_request_errors_total');
      expect(metricsText).toContain('route="/test-error"');
      expect(metricsText).toContain('status_code="500"');
    });

    test('tracks active WebSocket connections gauge', async () => {
      const fakeClient1 = { ws: {} };
      const fakeClient2 = { ws: {} };
      wsManager.clients.set('client-1', fakeClient1);
      wsManager.clients.set('client-2', fakeClient2);

      const metricsText = await register.metrics();
      expect(metricsText).toContain('websocket_active_connections');
      expect(metricsText).toMatch(/websocket_active_connections\s+2/);

      wsManager.clients.clear();
    });

    test('tracks database connection pool utilization gauge', async () => {
      const metricsText = await register.metrics();
      expect(metricsText).toContain('db_pool_utilization_ratio');
      expect(metricsText).toContain('db_pool_connections');
    });

    test('includes standard Node.js runtime process metrics', async () => {
      const metricsText = await register.metrics();
      expect(metricsText).toContain('process_resident_memory_bytes');
    });
  });

  describe('Route Normalization', () => {
    test('normalizes parameterised route paths to prevent label explosion', async () => {
      await request(app).get('/api/v1/rwa/CBROADWAY1234567890123456789012345678901234567890123456');

      const metricsText = await register.metrics();
      expect(metricsText).toContain('route="/api/v1/rwa/:contractId"');
    });

    test('strips query parameters in normalizeRoute helper', () => {
      const mockReq = {
        path: '/api/v1/assets',
        url: '/api/v1/assets?search=gold&page=2&limit=50',
      };
      expect(normalizeRoute(mockReq)).toBe('/api/v1/assets');
    });

    test('masks variable IDs when unrouted', () => {
      const mockReq = {
        path: '/api/v1/transactions/tx_99887766554433221100',
      };
      expect(normalizeRoute(mockReq)).toBe('/api/v1/transactions/:transactionId');
    });
  });

  describe('Business Metrics', () => {
    test('exposes rwa_total_assets and rwa_assets_by_type gauges', async () => {
      const metricsText = await register.metrics();
      expect(metricsText).toContain('rwa_total_assets');
      expect(metricsText).toContain('rwa_assets_by_type');
    });

    test('exposes transaction purchase metrics and respects configuredTransactionService', async () => {
      const mockTxService = {
        getAllTimeMetrics: async () => ({
          totalTransactions: 42,
          totalVolume: 125000.5,
          totalShares: 840,
          uniqueBuyers: 15,
          uniqueAssets: 8,
          averageTransactionSize: 2976.2,
        }),
      };

      setMetricsTransactionService(mockTxService);

      const metricsText = await register.metrics();
      expect(metricsText).toContain('rwa_purchases_total 42');
      expect(metricsText).toContain('rwa_purchase_volume_total 125000.5');
      expect(metricsText).toContain('rwa_unique_buyers_total 15');

      // Reset
      setMetricsTransactionService(null);
    });

    test('records real-time purchase metrics via recordPurchaseMetric', async () => {
      recordPurchaseMetric({ status: 'completed' });
      recordPurchaseMetric({ status: 'failed' });

      const metricsText = await register.metrics();
      expect(metricsText).toContain('rwa_purchases_processed_total{status="completed"}');
      expect(metricsText).toContain('rwa_purchases_processed_total{status="failed"}');
    });
  });

  describe('Production Authentication & Access Control', () => {
    let authApp;
    const testAdminKey = 'test-admin-api-key-1234567890';
    const testBearerToken = 'test-bearer-token-abc-xyz';
    const testMetricsUser = 'prom_user';
    const testMetricsPass = 'prom_secret_password';

    beforeEach(() => {
      authApp = express();

      const prodAuth = createMetricsAuthMiddleware({
        authRequired: true,
        env: {
          ADMIN_API_KEY: testAdminKey,
          METRICS_BEARER_TOKEN: testBearerToken,
          METRICS_USER: testMetricsUser,
          METRICS_PASSWORD: testMetricsPass,
        },
      });

      authApp.use(metricsMiddleware);
      authApp.get('/metrics', prodAuth, metricsHandler);
    });

    test('rejects unauthenticated requests in production with 401 and WWW-Authenticate', async () => {
      const res = await request(authApp).get('/metrics');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
      expect(res.headers['www-authenticate']).toContain('Bearer');
      expect(res.body).toEqual({
        status: 401,
        error: 'Unauthorized',
        message: 'Authentication required to access /metrics in production',
        code: 'METRICS_AUTHENTICATION_REQUIRED',
      });
    });

    test('rejects requests with invalid x-api-key with 401', async () => {
      const res = await request(authApp)
        .get('/metrics')
        .set('x-api-key', 'wrong-api-key');
      expect(res.status).toBe(401);
    });

    test('rejects requests with invalid Bearer token with 401', async () => {
      const res = await request(authApp)
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-token');
      expect(res.status).toBe(401);
    });

    test('rejects requests with invalid Basic auth credentials with 401', async () => {
      const wrongCredentials = Buffer.from('prom_user:wrong_password').toString('base64');
      const res = await request(authApp)
        .get('/metrics')
        .set('Authorization', `Basic ${wrongCredentials}`);
      expect(res.status).toBe(401);
    });

    test('accepts valid x-api-key in production', async () => {
      const res = await request(authApp)
        .get('/metrics')
        .set('x-api-key', testAdminKey);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    test('accepts valid Bearer token in production', async () => {
      const res = await request(authApp)
        .get('/metrics')
        .set('Authorization', `Bearer ${testBearerToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    test('accepts valid Basic auth in production', async () => {
      const credentials = Buffer.from(`${testMetricsUser}:${testMetricsPass}`).toString('base64');
      const res = await request(authApp)
        .get('/metrics')
        .set('Authorization', `Basic ${credentials}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    test('accepts dynamic database API key via apiKeyService', async () => {
      const mockApiKeyService = {
        validate: async (key) => ({
          valid: key === 'dynamic-db-key-999',
          id: 'key_123',
        }),
      };

      const customAuthApp = express();
      const dynamicAuth = createMetricsAuthMiddleware({
        authRequired: true,
        apiKeyService: mockApiKeyService,
        env: {
          ADMIN_API_KEY: 'some-other-key',
        },
      });
      customAuthApp.get('/metrics', dynamicAuth, metricsHandler);

      // Valid dynamic key
      const resValid = await request(customAuthApp)
        .get('/metrics')
        .set('x-api-key', 'dynamic-db-key-999');
      expect(resValid.status).toBe(200);

      // Invalid dynamic key
      const resInvalid = await request(customAuthApp)
        .get('/metrics')
        .set('x-api-key', 'non-existent-key');
      expect(resInvalid.status).toBe(401);
    });

    test('bypasses authentication when METRICS_AUTH_DISABLED is true', async () => {
      const bypassApp = express();
      const bypassAuth = createMetricsAuthMiddleware({
        authRequired: true,
        env: {
          METRICS_AUTH_DISABLED: 'true',
        },
      });
      bypassApp.get('/metrics', bypassAuth, metricsHandler);

      const res = await request(bypassApp).get('/metrics');
      expect(res.status).toBe(200);
    });

    test('allows unauthenticated access in non-production by default', async () => {
      const devApp = express();
      const devAuth = createMetricsAuthMiddleware({
        env: {
          NODE_ENV: 'development',
        },
      });
      devApp.get('/metrics', devAuth, metricsHandler);

      const res = await request(devApp).get('/metrics');
      expect(res.status).toBe(200);
    });
  });
});
