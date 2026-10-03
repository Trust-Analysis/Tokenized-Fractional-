// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/apiMonitoring.js — Issues #330-333: API Monitoring Routes
 *
 * Provides endpoints for viewing API metrics, errors, performance,
 * and health status.
 */

import { Router } from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getMetricsSummary,
  getRecentErrors,
  getOperationPerformance,
  getApiHealth,
  cleanupMetrics,
} from '../services/apiMonitor.js';

export function createApiMonitoringRoutes() {
  const router = Router();

  // GET /api-monitor/health - Public health check
  router.get('/health', (req, res) => {
    const health = getApiHealth();
    const statusCode = health.status === 'critical' ? 503 : 200;
    res.status(statusCode).json(health);
  });

  // GET /api-monitor/metrics - Get metrics summary (admin only)
  router.get('/metrics', adminAuth, (req, res) => {
    const timeWindow = parseInt(req.query.window, 10) || 3600000;
    const metrics = getMetricsSummary(timeWindow);
    res.json(metrics);
  });

  // GET /api-monitor/errors - Get recent errors (admin only)
  router.get('/errors', adminAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const errors = getRecentErrors(limit);
    res.json({ errors, total: errors.length });
  });

  // GET /api-monitor/performance/:operation - Get performance for specific operation
  router.get('/performance/:operation', adminAuth, (req, res) => {
    const { operation } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const performance = getOperationPerformance(operation, limit);

    const avgDuration = performance.length > 0
      ? performance.reduce((sum, p) => sum + p.duration, 0) / performance.length
      : 0;

    res.json({
      operation,
      count: performance.length,
      avgDuration: avgDuration.toFixed(2),
      entries: performance,
    });
  });

  // POST /api-monitor/cleanup - Clean up old metrics (admin only)
  router.post('/cleanup', adminAuth, (req, res) => {
    const retentionMs = parseInt(req.body.retentionMs, 10) || 3600000 * 24;
    const cleaned = cleanupMetrics(retentionMs);
    res.json({ cleaned });
  });

  // GET /api-monitor/dashboard - Full monitoring dashboard (admin only)
  router.get('/dashboard', adminAuth, (req, res) => {
    const health = getApiHealth();
    const summary = getMetricsSummary(3600000);
    const recentErrors = getRecentErrors(10);

    res.json({
      health,
      summary,
      recentErrors,
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}
