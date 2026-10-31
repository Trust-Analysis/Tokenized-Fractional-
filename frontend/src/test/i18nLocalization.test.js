import { describe, it, expect } from 'vitest';
import {
  formatLocalCurrency,
  formatFiat,
  formatOrderTimestamp,
  formatLocalNumber,
  getSafeLocale,
} from '../utils/i18nFormatters';

describe('Issue #619: Localize Date and Currency Formatting in UI', () => {
  describe('Currency & Fiat Formatting with Intl.NumberFormat', () => {
    it('formats fiat currency using Intl.NumberFormat based on locale', () => {
      const amount = 1250.5;
      const formattedUS = formatLocalCurrency(amount, 'USD', 'en-US');
      expect(formattedUS).toContain('1,250.50');
      expect(formattedUS).toContain('$');

      // German locale puts symbol/currency at the end and uses comma for decimals
      const formattedDE = formatLocalCurrency(amount, 'EUR', 'de-DE');
      expect(formattedDE).toContain('1.250,50');

      // formatFiat alias works identically
      const fiatRes = formatFiat(amount, 'USD', 'en-US');
      expect(fiatRes).toBe(formattedUS);
    });

    it('falls back gracefully if the locale is unrecognized or invalid', () => {
      const amount = 500000;
      // Pass an invalid / unrecognized locale
      const resultInvalid = formatLocalCurrency(amount, 'USD', 'xyz-invalid-locale-tag-999');
      expect(resultInvalid).toBeDefined();
      expect(typeof resultInvalid).toBe('string');
      expect(resultInvalid).toContain('500,000.00');

      const safeLocale = getSafeLocale('completely_broken_locale!');
      expect(safeLocale).toBe('en-US');
    });

    it('handles null, undefined, or zero values without throwing', () => {
      expect(formatLocalCurrency(0, 'USD', 'en-US')).toContain('0.00');
      expect(formatLocalCurrency(null, 'USD', 'en-US')).toContain('0.00');
      expect(formatLocalCurrency(undefined, 'USD', 'en-US')).toContain('0.00');
    });
  });

  describe('Order Execution Timestamps with Intl.DateTimeFormat', () => {
    const testDate = '2026-03-15T14:30:45.000Z';

    it('formats order execution timestamps based on user locale', () => {
      const formattedUS = formatOrderTimestamp(testDate, 'en-US');
      expect(formattedUS).toBeDefined();
      expect(typeof formattedUS).toBe('string');
      expect(formattedUS.length).toBeGreaterThan(0);
      // Contains year or time
      expect(formattedUS).toMatch(/2026/);

      const formattedDE = formatOrderTimestamp(testDate, 'de-DE');
      expect(formattedDE).toBeDefined();
      expect(formattedDE).toMatch(/2026/);
    });

    it('handles unrecognized or invalid locale gracefully for timestamps', () => {
      const res = formatOrderTimestamp(testDate, 'invalid-lang-code-xyz');
      expect(res).toBeDefined();
      expect(typeof res).toBe('string');
      expect(res).toMatch(/2026/);
    });

    it('handles invalid date input gracefully without crashing', () => {
      expect(formatOrderTimestamp('invalid-date-string')).toBe('');
      expect(formatOrderTimestamp(null)).toBe('');
      expect(formatOrderTimestamp(undefined)).toBe('');
    });
  });
});
