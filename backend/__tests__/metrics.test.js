// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import {
  metricsMiddleware,
  metricsHandler,
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestErrors,
  websocketActiveConnections,
  dbPoolUtilization,
  dbPoolConnections,
  register,
} from '../src/services/metricsService.js';
import { wsManager } from '../websocket.js';

describe('Prometheus Metrics Observability (Issue #518)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(metricsMiddleware);
    app.get('/metrics', metricsHandler);
    app.get('/test-success', (req, res) => res.json({ status: 'ok' }));
    app.get('/test-error', (req, res) => res.status(500).json({ error: 'failure' }));
  });

  test('GET /metrics returns 200 with Prometheus formatted metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(typeof res.text).toBe('string');
  });

  test('tracks HTTP request durations and total counts', async () => {
    // Send a request to observe
    await request(app).get('/test-success');

    const metricsText = await register.metrics();
    expect(metricsText).toContain('http_request_duration_seconds');
    expect(metricsText).toContain('http_requests_total');
    expect(metricsText).toContain('status_code="200"');
  });

  test('tracks HTTP error rates when errors occur', async () => {
    // Send an error request
    await request(app).get('/test-error');

    const metricsText = await register.metrics();
    expect(metricsText).toContain('http_request_errors_total');
    expect(metricsText).toContain('status_code="500"');
  });

  test('tracks active WebSocket connections gauge', async () => {
    // Simulate 3 active client connections
    const fakeClient1 = { ws: {} };
    const fakeClient2 = { ws: {} };
    wsManager.clients.set('client-1', fakeClient1);
    wsManager.clients.set('client-2', fakeClient2);

    const metricsText = await register.metrics();
    expect(metricsText).toContain('websocket_active_connections');
    expect(metricsText).toMatch(/websocket_active_connections\s+2/);

    // Clean up
    wsManager.clients.clear();
  });

  test('tracks database connection pool utilization gauge', async () => {
    const metricsText = await register.metrics();
    expect(metricsText).toContain('db_pool_utilization_ratio');
    expect(metricsText).toContain('db_pool_connections');
  });
});
