// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/assetMetadataValidation.test.js — Tests for JSON Schema validation.
 *
 * Validates asset metadata schema enforcement and error message formatting.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { validateAssetMetadata, reinitializeValidator } from '../src/middleware/assetMetadataValidation.js';

describe('Asset Metadata Validation', () => {
  beforeEach(() => {
    reinitializeValidator();
  });

  describe('Valid Metadata', () => {
    test('should accept complete valid metadata', () => {
      const validMetadata = {
        name: 'Test Real Estate Asset',
        description: 'A detailed description of the real estate asset that meets the minimum length requirement.',
        assetType: 'real_estate',
        jurisdiction: {
          country: 'US',
          region: 'California',
          legalFramework: 'SEC',
        },
        custodian: {
          name: 'Secure Custody Inc',
          licenseNumber: 'CUST-12345',
          contact: {
            email: 'custody@example.com',
          },
        },
        appraisal: {
          value: 100000000,
          currency: 'USD',
          date: '2024-01-15',
          method: 'market_comparison',
        },
        documents: [
          {
            type: 'title_deed',
            hash: 'a'.repeat(64),
            url: 'ipfs://QmTest',
          },
        ],
        fractionalization: {
          totalShares: 1000000,
          sharePrice: 100,
          currency: 'USD',
          minPurchase: 1,
        },
        version: '1.0',
      };

      const result = validateAssetMetadata(validMetadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });
  });

  describe('Required Fields', () => {
    test('should reject missing required field', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        // Missing description, assetType, jurisdiction, etc.
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);

      const missingFields = result.errors
        .filter(e => e.keyword === 'required')
        .map(e => e.message);
      expect(missingFields.length).toBeGreaterThan(0);
    });

    test('should reject empty name', () => {
      const invalidMetadata = {
        name: '',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field.includes('name'))).toBe(true);
    });
  });

  describe('Field Validation', () => {
    test('should reject invalid country code', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: {
          country: 'USA', // Should be 2-letter code
          legalFramework: 'SEC',
        },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('pattern'))).toBe(true);
    });

    test('should reject invalid email format', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'invalid-email' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('format'))).toBe(true);
    });

    test('should reject invalid document hash', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'not-64-chars', url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('pattern'))).toBe(true);
    });

    test('should reject invalid asset type enum', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'invalid_type',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('one of'))).toBe(true);
    });
  });

  describe('Error Message Formatting', () => {
    test('should provide detailed field-level error messages', () => {
      const invalidMetadata = {
        name: 'AB', // Too short
        description: 'Short', // Too short
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      
      result.errors.forEach(error => {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('value');
        expect(error).toHaveProperty('keyword');
      });
    });
  });

  describe('Edge Cases', () => {
    test('should reject negative appraisal value', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: -100, // Negative value
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('at least'))).toBe(true);
    });

    test('should reject zero total shares', () => {
      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents: [{ type: 'title_deed', hash: 'a'.repeat(64), url: 'ipfs://test' }],
        fractionalization: {
          totalShares: 0, // Invalid
          sharePrice: 100,
          minPurchase: 1,
        },
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
    });

    test('should reject too many documents', () => {
      const documents = Array(51).fill({
        type: 'title_deed',
        hash: 'a'.repeat(64),
        url: 'ipfs://test',
      });

      const invalidMetadata = {
        name: 'Test Asset',
        description: 'A'.repeat(50),
        assetType: 'real_estate',
        jurisdiction: { country: 'US', legalFramework: 'SEC' },
        custodian: {
          name: 'Test',
          licenseNumber: '12345',
          contact: { email: 'test@example.com' },
        },
        appraisal: {
          value: 100,
          currency: 'USD',
          date: '2024-01-01',
          method: 'market_comparison',
        },
        documents,
        version: '1.0',
      };

      const result = validateAssetMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Maximum'))).toBe(true);
    });
  });
});
