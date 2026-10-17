import { describe, it, expect } from 'vitest';
import {
  GAS_TIERS,
  formatPrice,
  calculatePurchaseFees,
  validateSharePurchaseInput,
} from '../utils/feeCalculator.js';

/**
 * Issue #718 — share-amount input validation.
 *
 * `validateSharePurchaseInput` is the single source of truth used by the
 * BuyShares component, so these cases pin down the exact copy shown to users
 * as well as the precedence between the amount / availability / balance rules.
 */
describe('Share amount validation — validateSharePurchaseInput (#718)', () => {
  const INVALID_AMOUNT = 'Please enter a valid positive whole number of shares.';

  it('rejects zero, negative, fractional and non-numeric amounts', () => {
    const context = { availableShares: 10 };

    expect(validateSharePurchaseInput({ ...context, buyAmount: 0 })).toBe(INVALID_AMOUNT);
    expect(validateSharePurchaseInput({ ...context, buyAmount: -2 })).toBe(INVALID_AMOUNT);
    expect(validateSharePurchaseInput({ ...context, buyAmount: 1.5 })).toBe(INVALID_AMOUNT);
    expect(validateSharePurchaseInput({ ...context, buyAmount: 'abc' })).toBe(INVALID_AMOUNT);
    expect(validateSharePurchaseInput({ ...context, buyAmount: null })).toBe(INVALID_AMOUNT);
    expect(validateSharePurchaseInput({ ...context, buyAmount: undefined })).toBe(INVALID_AMOUNT);
  });

  it('accepts numeric strings that represent whole positive numbers', () => {
    expect(validateSharePurchaseInput({ buyAmount: '3', availableShares: 10 })).toBeNull();
  });

  it('rejects amounts above the available shares and formats the limit', () => {
    expect(validateSharePurchaseInput({ buyAmount: 15, availableShares: 10 })).toBe(
      'Quantity exceeds available shares (10).',
    );
    expect(validateSharePurchaseInput({ buyAmount: 1_000_001, availableShares: 1_000_000 })).toBe(
      'Quantity exceeds available shares (1,000,000).',
    );
  });

  it('skips the availability check when availableShares is null', () => {
    expect(validateSharePurchaseInput({ buyAmount: 999_999, availableShares: null })).toBeNull();
  });

  it('rejects purchases that exceed the wallet balance', () => {
    const error = validateSharePurchaseInput({
      buyAmount: 2,
      availableShares: 10,
      userWalletBalanceStroops: 10_000_000, // 1 XLM
      totalCostStroops: 50_000_000, // 5 XLM
    });

    expect(error).toContain('exceeds wallet balance');
    expect(error).toContain('5.00');
    expect(error).toContain('1.00');
  });

  it('accepts a purchase that exactly equals the wallet balance', () => {
    expect(
      validateSharePurchaseInput({
        buyAmount: 2,
        availableShares: 10,
        userWalletBalanceStroops: 50_000_000,
        totalCostStroops: 50_000_000,
      }),
    ).toBeNull();
  });

  it('skips the balance check when no wallet balance is supplied', () => {
    expect(
      validateSharePurchaseInput({ buyAmount: 2, availableShares: 10, totalCostStroops: 50_000_000 }),
    ).toBeNull();
  });

  it('prioritises the amount rule over the availability and balance rules', () => {
    expect(
      validateSharePurchaseInput({
        buyAmount: 0,
        availableShares: 0,
        userWalletBalanceStroops: 0,
        totalCostStroops: 10,
      }),
    ).toBe(INVALID_AMOUNT);
  });

  it('returns null for a valid purchase', () => {
    expect(
      validateSharePurchaseInput({
        buyAmount: 2,
        availableShares: 10,
        userWalletBalanceStroops: 100_000_000,
        totalCostStroops: 50_000_000,
      }),
    ).toBeNull();
  });
});

/**
 * Issue #278 — the fee maths the BuyShares component now delegates to.
 */
describe('Enhanced Share Purchase Modal & Real-time Calculations (#278)', () => {
  it('correctly calculates base price, platform fees (0.5%), network gas fees, and total cost', () => {
    const fees = calculatePurchaseFees({
      buyAmount: 5,
      pricePerShareStroops: 100_000_000,
      gasTier: 'standard',
    });

    expect(fees.baseCostStroops).toBe(500_000_000);
    expect(fees.platformFeeStroops).toBe(2_500_000);
    expect(fees.networkFeeStroops).toBe(1000);
    expect(fees.totalCostStroops).toBe(502_501_000);
    expect(fees.estimatedTime).toBe('~5 sec');
  });

  it('defaults to the standard gas tier and the 0.5% platform fee', () => {
    const fees = calculatePurchaseFees({ buyAmount: 1, pricePerShareStroops: 10_000_000 });

    expect(fees.networkFeeStroops).toBe(GAS_TIERS.standard.feeStroops);
    expect(fees.platformFeeStroops).toBe(50_000);
    expect(fees.totalCostStroops).toBe(10_051_000);
  });

  it('formats stroop prices correctly to XLM string representation', () => {
    expect(formatPrice(10_000_000)).toBe('1.00');
    expect(formatPrice(500_000_000)).toBe('50.00');
    expect(formatPrice(0)).toBe('0.00');
    expect(formatPrice(null)).toBe('0.00');
  });

  it('provides low, standard, and priority gas estimation tiers', () => {
    expect(GAS_TIERS.low.feeStroops).toBe(100);
    expect(GAS_TIERS.standard.feeStroops).toBe(1000);
    expect(GAS_TIERS.priority.feeStroops).toBe(5000);
  });
});
