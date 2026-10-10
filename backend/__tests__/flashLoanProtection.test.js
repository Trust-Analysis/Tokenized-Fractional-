// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createFlashLoanProtectionService } from '../src/services/flashLoanProtectionService.js';
import { createFlashLoanProtectionRoutes } from '../src/routes/flashLoanProtection.js';
import express from 'express';
import request from 'supertest';

describe('Flash Loan Protection Mechanisms (#276)', () => {
  let flpService;
  let app;

  beforeEach(() => {
    flpService = createFlashLoanProtectionService();
    app = express();
    app.use(express.json());
    app.use('/api/v1/flash-loan-protection', createFlashLoanProtectionRoutes(flpService));
  });

  describe('Single-Block Volume & Origin Protection', () => {
    it('blocks transactions exceeding maximum single-block volume limit', () => {
      const result = flpService.validateTransaction({
        caller: 'GBUYER123',
        assetId: 'asset-1',
        shares: 300, // 30% of 1000 total shares
        price: 10,
        totalShares: 1000,
        currentBlock: 100,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds maximum single-block limit');
    });

    it('blocks rapid consecutive trades from same caller within block delay window', () => {
      // First trade passes
      const trade1 = flpService.validateTransaction({
        caller: 'GBUYER999',
        assetId: 'asset-1',
        shares: 50, // 5%
        price: 10,
        totalShares: 1000,
        currentBlock: 100,
      });
      expect(trade1.allowed).toBe(true);

      // Immediate trade on block 100 (same block) fails cooldown
      const trade2 = flpService.validateTransaction({
        caller: 'GBUYER999',
        assetId: 'asset-1',
        shares: 50,
        price: 10,
        totalShares: 1000,
        currentBlock: 100,
      });
      expect(trade2.allowed).toBe(false);
      expect(trade2.reason).toContain('High frequency trade detected');
    });

    it('blocks trades violating oracle price drift threshold', () => {
      const result = flpService.validateTransaction({
        caller: 'GBUYER000',
        assetId: 'asset-1',
        shares: 10,
        price: 150, // Huge price manipulation vs oracle 100
        oraclePrice: 100,
        totalShares: 1000,
        currentBlock: 105,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Price drift');
    });

    it('allows trade when dynamic override is active', () => {
      flpService.updateConfig({ overrideActive: true });

      const result = flpService.validateTransaction({
        caller: 'GBUYER000',
        assetId: 'asset-1',
        shares: 500, // Normally blocked
        price: 200, // Normally blocked
        oraclePrice: 100,
        totalShares: 1000,
        currentBlock: 105,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('REST Endpoints', () => {
    it('GET /api/v1/flash-loan-protection/config returns config', async () => {
      const res = await request(app).get('/api/v1/flash-loan-protection/config');
      expect(res.status).toBe(200);
      expect(res.body.config.enabled).toBe(true);
    });

    it('POST /api/v1/flash-loan-protection/validate validates transaction payload', async () => {
      const res = await request(app)
        .post('/api/v1/flash-loan-protection/validate')
        .send({
          caller: 'GBUYER123',
          assetId: 'asset-1',
          shares: 10,
          price: 100,
          oraclePrice: 100,
          totalShares: 1000,
          currentBlock: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
    });
  });
});
