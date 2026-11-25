import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  STORAGE_ENVELOPE_VERSION,
  STORAGE_KEYS,
  STORAGE_KEY_PREFIXES,
  STORAGE_KEY_REGISTRY,
  StorageError,
  clearMemoryFallback,
  createZustandStorage,
  getStorageKeyDefinition,
  isRegisteredStorageKey,
  readJson,
  readString,
  removeItem,
  writeJson,
  writeString,
} from '../lib/storage';
import {
  clearAuthToken,
  getAuthToken,
  purgeLegacyCredentialStorage,
  setAuthToken,
} from '../lib/authToken';

const SRC_ROOT = join(process.cwd(), 'src');
const DOCS_PATH = join(process.cwd(), '..', 'docs', 'LOCALSTORAGE_KEY_REGISTRY.md');

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearMemoryFallback();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('storage registry (#1047)', () => {
  it('registers every fixed key with documentation and a lifetime', () => {
    Object.entries(STORAGE_KEY_REGISTRY).forEach(([key, definition]) => {
      expect(definition.description, `${key} description`).toBeTruthy();
      expect(definition.lifetime, `${key} lifetime`).toBeTruthy();
      expect(['string', 'json', 'zustand']).toContain(definition.format);
      expect(['none', 'personal']).toContain(definition.sensitivity);
    });
  });

  it('documents every fixed key in docs/LOCALSTORAGE_KEY_REGISTRY.md', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    Object.keys(STORAGE_KEY_REGISTRY).forEach((key) => {
      expect(docs, `docs entry for ${key}`).toContain(`\`${key}\``);
    });
    STORAGE_KEY_PREFIXES.forEach(({ prefix }) => {
      expect(docs, `docs entry for ${prefix}*`).toContain(`${prefix}<`);
    });
  });

  it('resolves registered dynamic prefixes and rejects unknown keys', () => {
    expect(getStorageKeyDefinition('userProfile_GABC').format).toBe('json');
    expect(getStorageKeyDefinition('rwa-watchlist_guest').format).toBe('json');
    expect(isRegisteredStorageKey('not_a_real_key')).toBe(false);
    expect(() => readString('not_a_real_key')).toThrow(StorageError);
  });

  it('refuses credential-shaped keys and signed-transaction values', () => {
    expect(() => writeString('auth_token', 'abc')).toThrow(StorageError);
    expect(() => writeString('signed_xdr', 'AAAA')).toThrow(StorageError);
    expect(() => writeJson('userProfile_GABC', { signed_xdr: 'AAAA' })).not.toThrow();
    // Values are checked when serialized as strings.
    expect(() =>
      writeJson('userProfile_GABC', 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature'),
    ).toThrow(StorageError);
  });
});

describe('string helpers', () => {
  it('round-trips a registered string key', () => {
    expect(writeString(STORAGE_KEYS.THEME, 'light')).toBe(true);
    expect(readString(STORAGE_KEYS.THEME)).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('returns the fallback for missing or wrong-format values', () => {
    expect(readString(STORAGE_KEYS.THEME, 'fallback')).toBe('fallback');
    window.localStorage.setItem('theme', '123');
    expect(readString(STORAGE_KEYS.THEME, 'fallback')).toBe('123');
    expect(() => readJson(STORAGE_KEYS.THEME)).toThrow(StorageError);
  });

  it('removes a registered key', () => {
    writeString(STORAGE_KEYS.ONBOARDING_COMPLETED, 'true');
    removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
    expect(readString(STORAGE_KEYS.ONBOARDING_COMPLETED)).toBe('');
    expect(window.localStorage.getItem('hasCompletedTour')).toBeNull();
  });
});

describe('versioned JSON helpers', () => {
  const key = STORAGE_KEYS.PRICE_ALERTS;

  it('writes a versioned envelope and reads it back', () => {
    const alerts = [{ id: 'a1', targetPrice: 10 }];
    expect(writeJson(key, alerts)).toBe(true);

    const raw = JSON.parse(window.localStorage.getItem(key));
    expect(raw[STORAGE_ENVELOPE_VERSION]).toBe(1);
    expect(raw.data).toEqual(alerts);
    expect(readJson(key, { fallback: [] })).toEqual(alerts);
  });

  it('reads legacy plain-JSON values written before versioning', () => {
    const legacy = [{ id: 'legacy', targetPrice: 5 }];
    window.localStorage.setItem(key, JSON.stringify(legacy));
    expect(readJson(key, { fallback: [] })).toEqual(legacy);
  });

  it('returns the fallback for corrupt JSON and schema mismatches', () => {
    window.localStorage.setItem(key, '{not json');
    expect(readJson(key, { fallback: ['fallback'] })).toEqual(['fallback']);

    window.localStorage.setItem(key, JSON.stringify({ [STORAGE_ENVELOPE_VERSION]: 99, data: [1] }));
    expect(readJson(key, { fallback: ['fallback'] })).toEqual(['fallback']);
  });

  it('applies the caller validator', () => {
    window.localStorage.setItem(key, JSON.stringify({ not: 'an array' }));
    expect(readJson(key, { fallback: [], validate: (value) => Array.isArray(value) })).toEqual([]);
  });

  it('supports per-wallet profile keys', () => {
    const profileKey = 'userProfile_GABC';
    writeJson(profileKey, { displayName: 'Ada' });
    expect(readJson(profileKey)).toEqual({ displayName: 'Ada' });
    removeItem(profileKey);
    expect(readJson(profileKey)).toBeNull();
  });
});

describe('failure isolation', () => {
  it('falls back to memory when writes fail (quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(writeString(STORAGE_KEYS.ONBOARDING_COMPLETED, 'true')).toBe(false);
    expect(readString(STORAGE_KEYS.ONBOARDING_COMPLETED)).toBe('true');
  });

  it('falls back to memory when reads throw (storage disabled)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    writeJson(STORAGE_KEYS.PRICE_ALERTS, [{ id: 'in-memory' }]);
    expect(readJson(STORAGE_KEYS.PRICE_ALERTS)).toEqual([{ id: 'in-memory' }]);
  });

  it('never throws when removing from unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(() => removeItem(STORAGE_KEYS.THEME)).not.toThrow();
  });
});

describe('zustand adapter', () => {
  it('passes zustand envelopes through without double wrapping', () => {
    const storage = createZustandStorage();
    const persisted = JSON.stringify({ state: { displayCurrency: 'EUR' }, version: 1 });

    storage.setItem(STORAGE_KEYS.PREFERENCES, persisted);
    expect(storage.getItem(STORAGE_KEYS.PREFERENCES)).toBe(persisted);
  });

  it('rejects non-zustand keys', () => {
    const storage = createZustandStorage();
    expect(() => storage.getItem(STORAGE_KEYS.THEME)).toThrow(StorageError);
  });
});

describe('auth token stays in memory', () => {
  it('holds the token without writing it to web storage', () => {
    setAuthToken('token-123');
    expect(getAuthToken()).toBe('token-123');
    expect(window.localStorage.getItem('auth_token')).toBeNull();
    expect(window.sessionStorage.getItem('auth_token')).toBeNull();
  });

  it('clears the token and purges legacy persisted credentials', () => {
    ['auth_token', 'jwt', 'access_token', 'refresh_token'].forEach((key) => {
      window.localStorage.setItem(key, 'legacy');
      window.sessionStorage.setItem(key, 'legacy');
    });
    window.localStorage.setItem('theme', 'dark');

    setAuthToken('token-123');
    clearAuthToken();
    purgeLegacyCredentialStorage();

    expect(getAuthToken()).toBeNull();
    ['auth_token', 'jwt', 'access_token', 'refresh_token'].forEach((key) => {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('ignores empty tokens', () => {
    setAuthToken('token-123');
    setAuthToken('');
    expect(getAuthToken()).toBeNull();
  });
});

describe('architectural boundary', () => {
  const ALLOWED = new Set([
    'lib/storage.js',
    'lib/authToken.js',
    // Classic <head> script that must run before the module graph.
    'theme-init.js',
    // i18next detector configuration (library-managed key).
    'i18n.js',
    // sessionStorage-only crash-recovery marker; documented in the registry.
    'hooks/usePendingTransaction.js',
  ]);

  function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        return entry === 'test' ? [] : walk(full);
      }
      return /\.(js|jsx)$/.test(entry) ? [full] : [];
    });
  }

  it('only the storage layer touches web storage directly', () => {
    const directAccess =
      /(?:window\.)?(?:local|session)Storage\.(?:getItem|setItem|removeItem|clear)\(/;
    const offenders = walk(SRC_ROOT)
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ file, source }) => {
        const rel = relative(SRC_ROOT, file).split('\\').join('/');
        return !ALLOWED.has(rel) && directAccess.test(source);
      })
      .map(({ file }) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
