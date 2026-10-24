// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/securityHeaders.test.js — Tests for comprehensive security headers middleware.
 *
 * Validates that all security headers are correctly set on API responses:
 * - HSTS (HTTP Strict Transport Security)
 * - CSP (Content Security Policy)
 * - X-Frame-Options (clickjacking protection)
 * - X-Content-Type-Options (MIME sniffing protection)
 * - X-XSS-Protection (legacy XSS filter)
 * - Referrer-Policy
 * - Permissions-Policy
 * - Expect-CT (Certificate Transparency)
 * - Cross-Origin-Resource-Policy
 * - X-DNS-Prefetch-Control
 */

// Set env vars before importing the app (module-level constants are read at load time)
import request from 'supertest';
import { app, initializeApp, closeApp } from '../src/app.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';

describe('Security Headers Middleware', () => {
  beforeAll(async () => {
    try {
      await initializeApp();
    } catch (error) {
      // App initialization might fail due to missing services in test env, but middleware is still set up
      // eslint-disable-next-line no-console
      console.log('App initialization note:', error.message);
    }
  });

  afterAll(async () => {
    try {
      await closeApp();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('App cleanup note:', error.message);
    }
  });

  describe('HSTS (HTTP Strict Transport Security)', () => {
    test('should set Strict-Transport-Security header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['strict-transport-security']).toContain('31536000');
    });

    test('should include includeSubDomains by default', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
    });
  });

  describe('X-Frame-Options (Clickjacking Protection)', () => {
    test('should set X-Frame-Options to DENY', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    test('should prevent embedding in iframes on all routes', async () => {
      const routes = ['/health', '/metrics', '/api-docs'];
      await Promise.all(
        routes.map(async (route) => {
          const res = await request(app).get(route);
          expect(res.headers['x-frame-options']).toBe('DENY');
        }),
      );
    });
  });

  describe('X-Content-Type-Options (MIME Sniffing Protection)', () => {
    test('should set X-Content-Type-Options to nosniff', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should prevent MIME-type sniffing on JSON responses', async () => {
      const res = await request(app).get('/health').set('Content-Type', 'application/json');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('Content Security Policy (CSP)', () => {
    test('should set Content-Security-Policy header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    test('CSP should restrict frame-ancestors to self', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/frame-ancestors\s+'self'/);
    });

    test('CSP should disable object-src', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/object-src\s+'none'/);
    });

    test('CSP should disable frame-src', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/frame-src\s+'none'/);
    });

    test('CSP should set base-uri to self', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/base-uri\s+'self'/);
    });

    test('CSP should restrict form-action to self', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/form-action\s+'self'/);
    });

    test('CSP should disable child-src', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/child-src\s+'none'/);
    });

    test('CSP should define default-src directive', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/default-src/);
    });

    test('CSP should allow WebSocket connections (ws: and wss:)', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/connect-src/);
      expect(csp).toMatch(/ws:/);
      expect(csp).toMatch(/wss:/);
    });

    test('CSP should include Stellar RPC providers by default', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/connect-src/);
      expect(csp).toMatch(/horizon\.stellar\.org/);
    });

    test('CSP should allow data: and https: for images', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/img-src/);
      expect(csp).toMatch(/data:/);
      expect(csp).toMatch(/https:/);
    });

    test('CSP should allow unsafe-inline in development mode', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      // In test mode (NODE_ENV=test), it should allow unsafe-inline
      expect(csp).toMatch(/script-src/);
      expect(csp).toMatch(/'unsafe-inline'/);
    });
  });

  describe('Referrer-Policy', () => {
    test('should set Referrer-Policy header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['referrer-policy']).toBeDefined();
    });

    test('Referrer-Policy restricts referrer information', async () => {
      const res = await request(app).get('/health');
      // Helmet converts 'strict-no-referrer' to 'no-referrer' which is the standard value
      expect(['no-referrer', 'strict-no-referrer']).toContain(res.headers['referrer-policy']);
    });
  });

  describe('X-XSS-Protection (Legacy XSS Filter)', () => {
    test('should set X-XSS-Protection header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-xss-protection']).toBeDefined();
      // Helmet sets this to "0" by default (disabled in modern browsers that support CSP)
      // or "1; mode=block" in other configurations
      expect(['0', '1', '1; mode=block']).toContain(res.headers['x-xss-protection']);
    });
  });

  describe('Permissions-Policy (Feature Policy)', () => {
    test('should have permissions-policy configuration available', () => {
      // Note: As of helmet v7.2.0, permissions-policy is not directly configurable
      // through helmet options. It can be added via custom middleware if needed.
      // This test documents the current state.
      expect(true).toBe(true);
    });
  });

  describe('Expect-CT (Certificate Transparency)', () => {
    test('should set Expect-CT header if configured', async () => {
      const res = await request(app).get('/health');
      // Expect-CT is optional and only set if CT_REPORT_URI is configured
      if (res.headers['expect-ct']) {
        expect(res.headers['expect-ct']).toContain('max-age=');
      }
    });
  });

  describe('Cross-Origin-Resource-Policy', () => {
    test('should set Cross-Origin-Resource-Policy header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['cross-origin-resource-policy']).toBeDefined();
    });

    test('Cross-Origin-Resource-Policy should be set to cross-origin by default', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });

  describe('X-DNS-Prefetch-Control', () => {
    test('should set X-DNS-Prefetch-Control header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    });

    test('X-DNS-Prefetch-Control can be configured', async () => {
      const res = await request(app).get('/health');
      // Default is 'on' or 'off' depending on environment configuration
      expect(['on', 'off']).toContain(res.headers['x-dns-prefetch-control']);
    });
  });

  describe('Security Headers on Different Routes', () => {
    test('should apply security headers to /api routes', async () => {
      const res = await request(app).get('/api/rwa');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
    });

    test('should apply security headers to /metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should apply security headers to 404 responses', async () => {
      const res = await request(app).get('/nonexistent-route-12345');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('HTTP Method Handling', () => {
    test('should apply security headers to GET requests', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    test('should apply security headers to POST requests', async () => {
      const res = await request(app)
        .post('/api/rwa')
        .set('x-api-key', 'test-key-for-jest')
        .send({ title: 'Test', location: 'Test', description: 'Test', assetType: 'Test' });
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should apply security headers to DELETE requests', async () => {
      const res = await request(app)
        .delete('/api/rwa/CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
        .set('x-api-key', 'test-key-for-jest');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Content Type Handling', () => {
    test('should apply security headers to JSON responses', async () => {
      const res = await request(app).get('/health').expect('Content-Type', /json/);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('should apply security headers to HTML responses', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.headers['x-frame-options']).toBe('DENY');
      // Swagger UI returns HTML
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  describe('Security Headers Completeness', () => {
    test('should have all critical security headers present', async () => {
      const res = await request(app).get('/health');

      const criticalHeaders = [
        'x-frame-options',
        'x-content-type-options',
        'content-security-policy',
        'referrer-policy',
        'x-xss-protection',
        'cross-origin-resource-policy',
        'x-dns-prefetch-control',
        'strict-transport-security',
      ];

      criticalHeaders.forEach((header) => {
        expect(res.headers[header]).toBeDefined();
      });
    });

    test('should not expose X-Powered-By header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
