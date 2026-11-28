// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/apiMonitor.test.js — Tests for API monitoring service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  logApiRequest,
  logApiError,
  logRateLimit,
  logPerformance,
  getMetricsSummary,
  getRecentErrors,
  getOperationPerformance,
  getApiHealth,
  cleanupMetrics,
} from '../src/services/apiMonitor.js';

describe('API Monitor', () => {
  const mockReq = {
    method: 'GET',
    path: '/api/test',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
    requestId: 'req_test_123',
  };

  const mockRes = {
    statusCode: 200,
    getHeader: () => '100',
  };

  beforeEach(() => {
    cleanupMetrics(0);
  });

  describe('logApiRequest', () => {
    it('should log a successful request', () => {
      const entry = logApiRequest(mockReq, mockRes, 150);

      expect(entry).toBeDefined();
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/api/test');
      expect(entry.statusCode).toBe(200);
      expect(entry.duration).toBe(150);
      expect(entry.id).toMatch(/^req_/);
    });

    it('should log error responses', () => {
      const errorRes = { ...mockRes, statusCode: 500 };
      const entry = logApiRequest(mockReq, errorRes, 500);

      expect(entry.statusCode).toBe(500);
    });
  });

  describe('logApiError', () => {
    it('should log an error with message', () => {
      const error = new Error('Test error');
      const entry = logApiError(error, mockReq);

      expect(entry).toBeDefined();
      expect(entry.message).toBe('Test error');
      expect(entry.stack).toBeDefined();
    });

    it('should log error without request', () => {
      const error = new Error('No request error');
      const entry = logApiError(error);

      expect(entry.message).toBe('No request error');
      expect(entry.path).toBeUndefined();
    });
  });

  describe('logRateLimit', () => {
    it('should log a rate limit event', () => {
      const limitInfo = { limit: 100, remaining: 0, reset: Date.now() };
      const entry = logRateLimit(mockReq, 'read', limitInfo);

      expect(entry).toBeDefined();
      expect(entry.tier).toBe('read');
      expect(entry.limit).toBe(100);
      expect(entry.remaining).toBe(0);
    });
  });

  describe('logPerformance', () => {
    it('should log performance metrics', () => {
      const entry = logPerformance('database.query', 250, { query: 'SELECT *' });

      expect(entry).toBeDefined();
      expect(entry.operation).toBe('database.query');
      expect(entry.duration).toBe(250);
    });
  });

  describe('getMetricsSummary', () => {
    it('should return empty summary when no data', () => {
      const summary = getMetricsSummary();

      expect(summary).toBeDefined();
      expect(summary.requests.total).toBe(0);
      expect(summary.errors.total).toBe(0);
    });

    it('should aggregate request metrics', () => {
      logApiRequest(mockReq, mockRes, 100);
      logApiRequest(mockReq, mockRes, 200);

      const summary = getMetricsSummary();

      expect(summary.requests.total).toBe(2);
      expect(summary.requests.avgDuration).toBe('150.00');
    });
  });

  describe('getRecentErrors', () => {
    it('should return recent errors', () => {
      const error = new Error('Test error');
      logApiError(error, mockReq);

      const errors = getRecentErrors();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toBe('Test error');
    });
  });

  describe('getOperationPerformance', () => {
    it('should return performance for specific operation', () => {
      logPerformance('test.op', 100);
      logPerformance('other.op', 200);

      const perf = getOperationPerformance('test.op');

      expect(perf.length).toBe(1);
      expect(perf[0].operation).toBe('test.op');
    });
  });

  describe('getApiHealth', () => {
    it('should return healthy status when no issues', () => {
      const health = getApiHealth();

      expect(health.status).toBe('healthy');
      expect(health.errorRate).toBe('0');
    });

    it('should detect unhealthy status', () => {
      // Log many errors to trigger warning
      for (let i = 0; i < 20; i++) {
        const errorRes = { ...mockRes, statusCode: 500 };
        logApiRequest(mockReq, errorRes, 100);
        logApiError(new Error('Error'), mockReq);
      }

      const health = getApiHealth();
      expect(['warning', 'critical']).toContain(health.status);
    });
  });

  describe('cleanupMetrics', () => {
    it('should clean up old metrics', () => {
      logApiRequest(mockReq, mockRes, 100);

      const cleaned = cleanupMetrics(0);

      expect(cleaned).toBeDefined();
      expect(typeof cleaned.requests).toBe('number');
    });
  });
});
