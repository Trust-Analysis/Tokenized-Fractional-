// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * backend/__tests__/analytics.test.js — Analytics endpoints integration tests
 *
 * Tests for:
 * - Purchase recording (POST /api/purchases)
 * - Analytics queries (GET /api/analytics/*)
 * - Admin endpoints with authentication
 */

import request from 'supertest';
import { app, initializeApp } from '../src/app.js';
import { closeDatabase, getDatabase } from '../src/services/database.js';

describe('Analytics API', () => {
  let db;
  let apiKey;

  beforeAll(async () => {
    const services = await initializeApp();
    db = services.db;
    // Use default test API key for admin endpoints
    apiKey = process.env.ADMIN_API_KEY || 'dev-key-change-in-production';
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('POST /api/purchases', () => {
    it('should record a purchase successfully', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .send({
          contractId: 'CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0',
          buyerAddress: 'GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5',
          sharesPurchased: 500,
          pricePerShare: 1000,
          totalAmount: 500000,
          paymentToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('transactionId');
      expect(response.body.data.status).toBe('completed');
      expect(response.body.message).toBe('Purchase recorded successfully');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .send({
          contractId: 'CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0',
          // Missing buyerAddress
          sharesPurchased: 500,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should reject invalid contractId', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .send({
          contractId: 'invalid', // Must start with C
          buyerAddress: 'GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5',
          sharesPurchased: 500,
          pricePerShare: 1000,
          totalAmount: 500000,
          paymentToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid contractId');
    });
  });

  describe('GET /api/purchases/:transactionId', () => {
    let transactionId;

    beforeAll(async () => {
      // Create a purchase first
      const response = await request(app)
        .post('/api/purchases')
        .send({
          contractId: 'CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0',
          buyerAddress: 'GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5',
          sharesPurchased: 500,
          pricePerShare: 1000,
          totalAmount: 500000,
          paymentToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        });
      transactionId = response.body.data.transactionId;
    });

    it('should retrieve purchase details', async () => {
      const response = await request(app)
        .get(`/api/purchases/${transactionId}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('transactionId', transactionId);
      expect(response.body.data).toHaveProperty('contractId');
      expect(response.body.data).toHaveProperty('buyerAddress');
      expect(response.body.data).toHaveProperty('sharesPurchased', 500);
    });

    it('should return 404 for non-existent transaction', async () => {
      const response = await request(app)
        .get('/api/purchases/tx_nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Transaction not found');
    });
  });

  describe('GET /api/analytics/overview', () => {
    beforeAll(async () => {
      // Ensure we have at least one purchase
      await request(app)
        .post('/api/purchases')
        .send({
          contractId: 'CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0',
          buyerAddress: 'GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5',
          sharesPurchased: 500,
          pricePerShare: 1000,
          totalAmount: 500000,
          paymentToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        });
    });

    it('should return overview metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/overview');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('totalTransactions');
      expect(response.body.data).toHaveProperty('totalVolume');
      expect(response.body.data).toHaveProperty('uniqueBuyers');
      expect(response.body.data).toHaveProperty('activeUsers');
      expect(response.body.data.totalVolume).toBeGreaterThan(0);
    });
  });

  describe('GET /api/analytics/popular', () => {
    it('should return popular assets', async () => {
      const response = await request(app)
        .get('/api/analytics/popular?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('assets');
      expect(response.body.data).toHaveProperty('period');
      expect(Array.isArray(response.body.data.assets)).toBe(true);
    });
  });

  describe('GET /api/analytics/user/:address', () => {
    it('should return user portfolio', async () => {
      const response = await request(app)
        .get('/api/analytics/user/GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('walletAddress');
      expect(response.body.data).toHaveProperty('activity');
      expect(response.body.data).toHaveProperty('purchases');
      if (response.body.data.activity) {
        expect(response.body.data.activity).toHaveProperty('totalPurchases');
        expect(response.body.data.activity).toHaveProperty('totalSpent');
      }
    });
  });

  describe('GET /api/analytics/asset-performance/:contractId', () => {
    it('should return asset performance metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/asset-performance/CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('contractId');
      expect(response.body.data).toHaveProperty('transactionCount');
      expect(response.body.data).toHaveProperty('volume');
    });
  });

  describe('GET /api/analytics/purchase-trends', () => {
    it('should return purchase trends', async () => {
      const response = await request(app)
        .get('/api/analytics/purchase-trends?days=30');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('trends');
      expect(response.body.data).toHaveProperty('period');
      expect(response.body.data).toHaveProperty('interval');
      expect(Array.isArray(response.body.data.trends)).toBe(true);
    });
  });

  describe('Admin Endpoints', () => {
    describe('GET /api/analytics/dashboard', () => {
      it('should require API key', async () => {
        const response = await request(app)
          .get('/api/analytics/dashboard');

        expect(response.status).toBe(401);
      });

      it('should return dashboard with valid API key', async () => {
        const response = await request(app)
          .get('/api/analytics/dashboard')
          .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty('overview');
        expect(response.body.data).toHaveProperty('activeUsers');
        expect(response.body.data).toHaveProperty('topBuyers');
      });
    });

    describe('POST /api/analytics/compute-daily', () => {
      it('should require API key', async () => {
        const response = await request(app)
          .post('/api/analytics/compute-daily')
          .send({ date: '2026-06-30' });

        expect(response.status).toBe(401);
      });

      it('should compute daily analytics with valid API key', async () => {
        const response = await request(app)
          .post('/api/analytics/compute-daily')
          .set('x-api-key', apiKey)
          .send({ date: '2026-06-30' });

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('Daily analytics computed');
      });

      it('should reject invalid date', async () => {
        const response = await request(app)
          .post('/api/analytics/compute-daily')
          .set('x-api-key', apiKey)
          .send({ date: 'invalid-date' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid date format');
      });
    });

    describe('GET /api/analytics/daily', () => {
      it('should require API key', async () => {
        const response = await request(app)
          .get('/api/analytics/daily?from=2026-06-01&to=2026-06-30');

        expect(response.status).toBe(401);
      });

      it('should return daily analytics with valid API key', async () => {
        const response = await request(app)
          .get('/api/analytics/daily?from=2026-06-01&to=2026-06-30')
          .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
      });
    });
  });
});
