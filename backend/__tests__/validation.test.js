// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/adminConfig.test.js — Tests for admin configuration routes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validateField, validateConfig, formatBasisPoints, formatDuration } from '../src/utils/validation.js';

describe('Validation Utilities', () => {
  describe('validateField', () => {
    it('should validate pricePerShare correctly', () => {
      expect(validateField('pricePerShare', 1000000).valid).toBe(true);
      expect(validateField('pricePerShare', 0).valid).toBe(false);
      expect(validateField('pricePerShare', -1).valid).toBe(false);
      expect(validateField('pricePerShare', 'abc').valid).toBe(false);
    });

    it('should validate totalShares correctly', () => {
      expect(validateField('totalShares', 100000).valid).toBe(true);
      expect(validateField('totalShares', 0).valid).toBe(false);
    });

    it('should validate maxSharesPerUser correctly', () => {
      expect(validateField('maxSharesPerUser', 0).valid).toBe(true);
      expect(validateField('maxSharesPerUser', 10000).valid).toBe(true);
      expect(validateField('maxSharesPerUser', -1).valid).toBe(false);
    });

    it('should validate dividendInterval correctly', () => {
      expect(validateField('dividendInterval', 60).valid).toBe(true);
      expect(validateField('dividendInterval', 31536000).valid).toBe(true);
      expect(validateField('dividendInterval', 30).valid).toBe(false);
    });

    it('should validate boolean fields correctly', () => {
      expect(validateField('buyPaused', true).valid).toBe(true);
      expect(validateField('buyPaused', false).valid).toBe(true);
      expect(validateField('buyPaused', 'yes').valid).toBe(false);
    });

    it('should return error messages', () => {
      const result = validateField('pricePerShare', -1);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.length).toBeGreaterThan(0);
    });
  });

  describe('validateConfig', () => {
    it('should validate a complete config', () => {
      const config = {
        pricePerShare: 1000000,
        totalShares: 100000,
        maxSharesPerUser: 10000,
        dividendInterval: 604800,
        dividendAmountPerShare: 100,
        minPurchaseAmount: 1,
        maxPurchaseAmount: 50000,
        platformFeePercent: 250,
        royaltyPercent: 100,
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors).length).toBe(0);
    });

    it('should catch invalid config', () => {
      const config = {
        pricePerShare: -1,
        totalShares: 0,
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.pricePerShare).toBeDefined();
      expect(result.errors.totalShares).toBeDefined();
    });

    it('should validate cross-field constraints', () => {
      const config = {
        minPurchaseAmount: 100,
        maxPurchaseAmount: 50,
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.maxPurchaseAmount).toBeDefined();
    });
  });

  describe('formatBasisPoints', () => {
    it('should format basis points to percentage', () => {
      expect(formatBasisPoints(250)).toBe('2.50%');
      expect(formatBasisPoints(100)).toBe('1.00%');
      expect(formatBasisPoints(0)).toBe('0.00%');
      expect(formatBasisPoints(10000)).toBe('100.00%');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30)).toBe('30 seconds');
      expect(formatDuration(60)).toBe('1 minutes');
      expect(formatDuration(3600)).toBe('1 hours');
      expect(formatDuration(86400)).toBe('1 days');
    });
  });
});
