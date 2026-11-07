import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  SUPPORTED_CURRENCIES,
  PREFERENCES_STORAGE_KEY,
  formatCurrencyAmount,
  isDefaultPreferences,
  mergePreferences,
  normalizeCurrency,
} from '../utils/preferences';

describe('preferences defaults', () => {
  it('exposes a documented localStorage key', () => {
    expect(PREFERENCES_STORAGE_KEY).toBe('rwa.preferences');
  });

  it('offers the supported currencies including the default', () => {
    const codes = SUPPORTED_CURRENCIES.map((entry) => entry.code);
    expect(codes).toContain(DEFAULT_PREFERENCES.displayCurrency);
  });
});

describe('normalizeCurrency', () => {
  it('normalises case and whitespace', () => {
    expect(normalizeCurrency(' eur ')).toBe('EUR');
  });

  it('falls back to the default for unsupported values', () => {
    expect(normalizeCurrency('XYZ')).toBe(DEFAULT_PREFERENCES.displayCurrency);
    expect(normalizeCurrency(null)).toBe(DEFAULT_PREFERENCES.displayCurrency);
  });
});

describe('mergePreferences', () => {
  it('fills missing keys with defaults', () => {
    expect(mergePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it('drops unknown keys and wrong types', () => {
    const merged = mergePreferences({
      displayCurrency: 'gbp',
      priceChangeNotifications: 'yes',
      soldOutNotifications: true,
      compactNumbers: true,
      notARealKey: 7,
    });

    expect(merged).toEqual({
      displayCurrency: 'GBP',
      priceChangeNotifications: DEFAULT_PREFERENCES.priceChangeNotifications,
      soldOutNotifications: true,
      compactNumbers: true,
    });
    expect(merged).not.toHaveProperty('notARealKey');
  });

  it('tolerates non-object input', () => {
    expect(mergePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(mergePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('isDefaultPreferences', () => {
  it('detects the defaults', () => {
    expect(isDefaultPreferences(DEFAULT_PREFERENCES)).toBe(true);
    expect(isDefaultPreferences({ ...DEFAULT_PREFERENCES, displayCurrency: 'EUR' })).toBe(false);
  });
});

describe('formatCurrencyAmount', () => {
  it('formats an amount in the chosen currency', () => {
    expect(formatCurrencyAmount(1250, 'USD')).toMatch(/\$1,250/);
    expect(formatCurrencyAmount(1250, 'EUR')).toMatch(/1,250/);
  });

  it('returns a dash for non-numeric input', () => {
    expect(formatCurrencyAmount('not-a-number', 'USD')).toBe('—');
  });
});
