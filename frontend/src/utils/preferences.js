/**
 * Lightweight user preferences (Issue #793).
 *
 * Pure data + helpers with no React or storage side effects, so the defaults,
 * validation and formatting can be unit tested directly. Persistence lives in
 * `store/usePreferencesStore.js`.
 */

/** `localStorage` key used by the persisted preferences store. */
export const PREFERENCES_STORAGE_KEY = 'rwa.preferences';

/** Currency options offered in the preferences panel. */
export const SUPPORTED_CURRENCIES = Object.freeze([
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'NGN', label: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', label: 'Kenyan Shilling', symbol: 'KSh' },
]);

export const DEFAULT_PREFERENCES = Object.freeze({
  /** Fiat currency used to display share prices. */
  displayCurrency: 'USD',
  /** Opt in to price-change notifications. */
  priceChangeNotifications: true,
  /** Opt in to sold-out notifications. */
  soldOutNotifications: false,
  /** Abbreviate large numbers (e.g. 1.2M instead of 1,200,000). */
  compactNumbers: false,
});

const CURRENCY_CODES = SUPPORTED_CURRENCIES.map((entry) => entry.code);

/** Coerce an arbitrary value to a supported currency code, else the default. */
export function normalizeCurrency(value, fallback = DEFAULT_PREFERENCES.displayCurrency) {
  if (typeof value !== 'string') return fallback;
  const upper = value.trim().toUpperCase();
  return CURRENCY_CODES.includes(upper) ? upper : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Merge an arbitrary (e.g. rehydrated or user-supplied) object with the
 * defaults, discarding unknown keys and wrong types. Guarantees a valid,
 * complete preferences object.
 */
export function mergePreferences(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    displayCurrency: normalizeCurrency(source.displayCurrency),
    priceChangeNotifications: normalizeBoolean(
      source.priceChangeNotifications,
      DEFAULT_PREFERENCES.priceChangeNotifications,
    ),
    soldOutNotifications: normalizeBoolean(
      source.soldOutNotifications,
      DEFAULT_PREFERENCES.soldOutNotifications,
    ),
    compactNumbers: normalizeBoolean(source.compactNumbers, DEFAULT_PREFERENCES.compactNumbers),
  };
}

/** True when the given preferences differ from the shipped defaults. */
export function isDefaultPreferences(input) {
  const merged = mergePreferences(input);
  return Object.keys(DEFAULT_PREFERENCES).every((key) => merged[key] === DEFAULT_PREFERENCES[key]);
}

/** Format an amount in the preferred fiat currency. */
export function formatCurrencyAmount(
  amount,
  currency = DEFAULT_PREFERENCES.displayCurrency,
  locale = 'en-US',
) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizeCurrency(currency),
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${normalizeCurrency(currency)} ${numeric.toFixed(2)}`;
  }
}
