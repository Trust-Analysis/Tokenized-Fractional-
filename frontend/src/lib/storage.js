/**
 * Central `localStorage` access layer (Issue #1047).
 *
 * Why this module exists
 * ----------------------
 * `localStorage` is readable by any script running on the origin, so every key
 * the app persists must be deliberate, documented and validated. This module is
 * the only place that talks to `localStorage` directly (see
 * `src/test/storage.test.js`, which fails if another source file bypasses it).
 *
 * Guarantees
 * ----------
 * - **Registry**: only keys declared in `STORAGE_KEY_REGISTRY` (or a registered
 *   dynamic prefix such as `userProfile_`) can be read or written. Typos and
 *   ad-hoc keys throw instead of silently creating new storage entries.
 * - **No credentials**: keys or values that look like credentials, keys, seeds,
 *   signatures or signed transactions are rejected. The access token lives in
 *   memory only (`src/lib/authToken.js`).
 * - **Versioning + migration**: JSON values are stored in an envelope carrying
 *   a schema version. Values written by older app versions are plain JSON; they
 *   are still readable and are upgraded on their next write, so no persisted
 *   data is lost by this change.
 * - **Failure isolation**: access is wrapped in `try/catch`. When storage is
 *   unavailable (Safari private mode, disabled cookies) or full, reads fall
 *   back to an in-memory map and writes never throw, so the UI keeps working.
 *
 * The full key inventory and lifetime table lives in
 * `docs/LOCALSTORAGE_KEY_REGISTRY.md`.
 */

/** Envelope marker used for versioned JSON values. @type {string} */
export const STORAGE_ENVELOPE_VERSION = '__rwa_storage_version';

/** Current schema version for every versioned JSON key. @type {number} */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} StorageKeyDefinition
 * @property {string} description Human-readable content description.
 * @property {string} lifetime How long the value lives.
 * @property {'none' | 'personal'} sensitivity Whether the value is personal data.
 * @property {'string' | 'json' | 'zustand'} format Serialization format.
 * @property {'all' | 'development'} environment Where the key is used.
 * @property {number} [version] Schema version for versioned JSON values.
 */

/** Fixed keys used across the frontend. */
export const STORAGE_KEYS = Object.freeze({
  THEME: 'theme',
  PREVIOUSLY_CONNECTED: 'wallet_previously_connected',
  ONBOARDING_COMPLETED: 'hasCompletedTour',
  PRICE_ALERTS: 'rwa_price_alerts',
  PREFERENCES: 'rwa.preferences',
  WALLET_STORE: 'rwa-wallet-store',
  LANGUAGE: 'i18nextLng',
  ANALYTICS_ID: 'analytics_anon_id',
  PROFILE_EMAIL_NOTIFICATIONS: 'emailNotifications',
  PROFILE_PRICE_ALERTS: 'priceAlerts',
  PROFILE_TRANSACTION_NOTIFICATIONS: 'transactionNotifications',
  PROFILE_MARKETING_EMAILS: 'marketingEmails',
  PROFILE_LANGUAGE: 'language',
  PROFILE_TWO_FACTOR: 'twoFactorEnabled',
  PROFILE_AUTO_LOGOUT: 'autoLogout',
  MOCK_WALLET_PUBKEY: 'mock_wallet_pubkey',
  MOCK_SHARES_BALANCE: 'mock_shares_balance',
  MOCK_TX_FAILURE: 'mock_tx_failure',
});

/**
 * @type {Readonly<Record<string, StorageKeyDefinition>>}
 */
export const STORAGE_KEY_REGISTRY = Object.freeze({
  [STORAGE_KEYS.THEME]: {
    description: 'Selected colour theme ("dark" or "light")',
    lifetime: 'Until the user changes it or clears site data',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PREVIOUSLY_CONNECTED]: {
    description: 'Flag that a wallet was connected in a previous session',
    lifetime: 'Until disconnect or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.ONBOARDING_COMPLETED]: {
    description: 'Flag that the onboarding tour was finished or skipped',
    lifetime: 'Permanent (until site data is cleared)',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PRICE_ALERTS]: {
    description: 'Locally created price alerts (asset id, target price, state)',
    lifetime: 'Until the user deletes the alert or site data',
    sensitivity: 'none',
    format: 'json',
    environment: 'all',
  },
  [STORAGE_KEYS.PREFERENCES]: {
    description: 'Display and notification preferences (zustand persist)',
    lifetime: 'Until reset or site-data clear',
    sensitivity: 'none',
    format: 'zustand',
    environment: 'all',
  },
  [STORAGE_KEYS.WALLET_STORE]: {
    description: 'Last active wallet provider only (no public key, no shares)',
    lifetime: 'Until site-data clear',
    sensitivity: 'none',
    format: 'zustand',
    environment: 'all',
  },
  [STORAGE_KEYS.LANGUAGE]: {
    description: 'i18next language detector cache',
    lifetime: 'Until the user changes language or site data',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.ANALYTICS_ID]: {
    description: 'Random anonymous analytics id, no PII',
    lifetime: 'Permanent (until site data is cleared)',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_EMAIL_NOTIFICATIONS]: {
    description: 'Profile switch: email notifications',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_PRICE_ALERTS]: {
    description: 'Profile switch: price-alert notifications',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_TRANSACTION_NOTIFICATIONS]: {
    description: 'Profile switch: transaction notifications',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_MARKETING_EMAILS]: {
    description: 'Profile switch: marketing emails (opt-in)',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_LANGUAGE]: {
    description: 'Profile language selection',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_TWO_FACTOR]: {
    description: 'Profile switch: 2FA preference flag',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.PROFILE_AUTO_LOGOUT]: {
    description: 'Profile switch: auto-logout preference flag',
    lifetime: 'Until changed or site-data clear',
    sensitivity: 'none',
    format: 'string',
    environment: 'all',
  },
  [STORAGE_KEYS.MOCK_WALLET_PUBKEY]: {
    description: 'Mock wallet public key used by the development wallet flow',
    lifetime: 'Development mode only',
    sensitivity: 'none',
    format: 'string',
    environment: 'development',
  },
  [STORAGE_KEYS.MOCK_SHARES_BALANCE]: {
    description: 'Mock share balance used by the development transaction flow',
    lifetime: 'Development mode only',
    sensitivity: 'none',
    format: 'string',
    environment: 'development',
  },
  [STORAGE_KEYS.MOCK_TX_FAILURE]: {
    description: 'Test-only switch that forces the mock transaction to fail',
    lifetime: 'Development mode only',
    sensitivity: 'none',
    format: 'string',
    environment: 'development',
  },
});

/**
 * Dynamic key families. Prefixes are registered once so per-wallet and
 * per-profile keys do not need an entry each.
 *
 * @type {ReadonlyArray<{ prefix: string, definition: StorageKeyDefinition }>}
 */
export const STORAGE_KEY_PREFIXES = Object.freeze([
  {
    prefix: 'userProfile_',
    definition: {
      description: 'Locally saved profile fields for one wallet address',
      lifetime: 'Until the profile is deleted or site data is cleared',
      sensitivity: 'personal',
      format: 'json',
      environment: 'all',
    },
  },
  {
    prefix: 'rwa-watchlist_',
    definition: {
      description: 'Favorites, categories and alerts for one wallet (guest or address)',
      lifetime: 'Until site data is cleared',
      sensitivity: 'personal',
      format: 'json',
      environment: 'all',
    },
  },
]);

/**
 * Thrown when a key is unregistered/used with the wrong format
 * (`code: 'UNREGISTERED_KEY'`) or when a caller tries to persist credentials
 * or signed transactions (`code: 'CREDENTIAL_POLICY'`).
 */
export class StorageError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/**
 * Key/value shapes that must never be persisted. This is a defensive guard for
 * future code, not a scanner: the audit that removed the existing credential
 * read lives in `src/lib/authToken.js`.
 */
const CREDENTIAL_KEY_PATTERN =
  /(^|[_-])(auth|authorization|jwt|token|access[_-]?token|refresh[_-]?token|secret|seed|mnemonic|private[_-]?key|signature|signed[_-]?xdr|xdr)([_-]|$)/i;

const CREDENTIAL_VALUE_PATTERN =
  /(^|[\s"':=])(bearer\s+[a-z0-9._~+/-]+=*|s[a-z2-7]{55}|mnemonic|private\s*key|signed\s*xdr)/i;

/** In-memory fallback used when `localStorage` is unavailable or full. */
const memoryFallback = new Map();

function getStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Access itself can throw (blocked cookies); fall through to memory.
  }
  return null;
}

/**
 * Resolve a fixed key or a registered dynamic prefix.
 *
 * @param {string} key
 * @returns {StorageKeyDefinition}
 */
export function getStorageKeyDefinition(key) {
  if (Object.prototype.hasOwnProperty.call(STORAGE_KEY_REGISTRY, key)) {
    return STORAGE_KEY_REGISTRY[key];
  }

  const family = STORAGE_KEY_PREFIXES.find(
    ({ prefix }) => key.startsWith(prefix) && key.length > prefix.length,
  );
  if (family) return family.definition;

  throw new StorageError(
    `Unregistered localStorage key "${key}". Add it to STORAGE_KEY_REGISTRY and docs/LOCALSTORAGE_KEY_REGISTRY.md.`,
    'UNREGISTERED_KEY',
  );
}

/** @param {string} key */
export function isRegisteredStorageKey(key) {
  try {
    getStorageKeyDefinition(key);
    return true;
  } catch {
    return false;
  }
}

function assertWritableKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageError('Storage keys must be non-empty strings', 'UNREGISTERED_KEY');
  }
  if (CREDENTIAL_KEY_PATTERN.test(key)) {
    throw new StorageError(
      `Refusing to persist "${key}": credentials, keys and signed transactions must stay in memory.`,
      'CREDENTIAL_POLICY',
    );
  }
  return getStorageKeyDefinition(key);
}

function assertFormat(key, definition, expected) {
  if (definition.format !== expected) {
    throw new StorageError(
      `Storage key "${key}" is registered as "${definition.format}", not "${expected}".`,
      'UNREGISTERED_KEY',
    );
  }
}

function assertValueAllowed(value) {
  if (typeof value === 'string' && CREDENTIAL_VALUE_PATTERN.test(value)) {
    throw new StorageError(
      'Refusing to persist a value that looks like a credential or signed transaction.',
      'CREDENTIAL_POLICY',
    );
  }
}

function readRaw(key) {
  const storage = getStorage();
  if (storage) {
    try {
      const stored = storage.getItem(key);
      if (stored !== null) return stored;
    } catch {
      // Fall back to memory below.
    }
  }
  return memoryFallback.has(key) ? memoryFallback.get(key) : null;
}

function writeRaw(key, value) {
  assertValueAllowed(value);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
      memoryFallback.delete(key);
      return true;
    } catch {
      // Quota exceeded or storage disabled: keep the value in memory so the
      // current session still behaves as if it had been persisted.
    }
  }
  memoryFallback.set(key, value);
  return false;
}

function removeRaw(key) {
  memoryFallback.delete(key);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is inaccessible.
  }
}

/**
 * Read a plain string value.
 *
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
export function readString(key, fallback = '') {
  const definition = getStorageKeyDefinition(key);
  assertFormat(key, definition, 'string');
  const raw = readRaw(key);
  return typeof raw === 'string' ? raw : fallback;
}

/**
 * Persist a plain string value.
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean} `true` when the value reached `localStorage`, `false`
 *   when it was kept in the in-memory fallback.
 */
export function writeString(key, value) {
  const definition = assertWritableKey(key);
  assertFormat(key, definition, 'string');
  return writeRaw(key, String(value));
}

/**
 * Read a JSON value, transparently handling both the current versioned
 * envelope and legacy plain-JSON values written by older versions.
 *
 * @template T
 * @param {string} key
 * @param {{ fallback?: T, validate?: (value: unknown) => boolean }} [options]
 * @returns {T}
 */
export function readJson(key, options = {}) {
  const { fallback = null, validate } = options;
  const definition = getStorageKeyDefinition(key);
  assertFormat(key, definition, 'json');

  const raw = readRaw(key);
  if (raw === null) return fallback;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  let data = parsed;
  const version =
    parsed && typeof parsed === 'object' ? parsed[STORAGE_ENVELOPE_VERSION] : undefined;

  if (version !== undefined) {
    if (version !== (definition.version ?? STORAGE_SCHEMA_VERSION)) {
      return fallback;
    }
    data = parsed.data;
  }

  if (typeof validate === 'function' && !validate(data)) return fallback;
  return data;
}

/**
 * Persist a JSON value inside a versioned envelope. Legacy plain-JSON values
 * are read by `readJson` and replaced by the envelope on the next write.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} `true` when written to `localStorage`.
 */
export function writeJson(key, value) {
  const definition = assertWritableKey(key);
  assertFormat(key, definition, 'json');
  const serialized = JSON.stringify({
    [STORAGE_ENVELOPE_VERSION]: definition.version ?? STORAGE_SCHEMA_VERSION,
    data: value,
  });
  return writeRaw(key, serialized);
}

/**
 * Remove a registered key from both `localStorage` and the memory fallback.
 *
 * @param {string} key
 */
export function removeItem(key) {
  getStorageKeyDefinition(key);
  removeRaw(key);
}

/**
 * Storage adapter for zustand's `persist` middleware. Zustand already owns its
 * own `{ state, version }` envelope and migration, so this adapter writes the
 * serialized value unchanged while still enforcing the registry.
 *
 * @returns {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }}
 */
export function createZustandStorage() {
  return {
    getItem: (key) => {
      const definition = getStorageKeyDefinition(key);
      assertFormat(key, definition, 'zustand');
      return readRaw(key);
    },
    setItem: (key, value) => {
      const definition = assertWritableKey(key);
      assertFormat(key, definition, 'zustand');
      writeRaw(key, value);
    },
    removeItem: (key) => {
      const definition = getStorageKeyDefinition(key);
      assertFormat(key, definition, 'zustand');
      removeRaw(key);
    },
  };
}

/**
 * Test-only helper that clears values held only in the in-memory fallback.
 * It never touches `localStorage`.
 */
export function clearMemoryFallback() {
  memoryFallback.clear();
}
