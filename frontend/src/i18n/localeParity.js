// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Locale parity rules — the framework-free core behind `npm run i18n:check`
 * and `src/test/i18nLocaleParity.test.js`.
 *
 * `en` is the source of truth.  Every other locale must:
 *   - define exactly the same keys (no missing, no orphaned),
 *   - never ship an empty translation,
 *   - keep every `{{placeholder}}` the English value uses.
 *
 * It also audits the source tree for `t('some.key')` calls whose key is not
 * defined in `en`, which is how a string can silently render as its own key
 * (`search.title`) instead of falling back to English.
 *
 * Pure by design: no `fs`, no `i18next`, no DOM — the CLI and the tests feed it
 * data.
 */

/** English locale that every other locale is compared against. */
export const REFERENCE_LOCALE = 'en';

/** i18next plural suffixes; `_other` is stripped so a language with fewer plural forms still matches. */
export const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

/**
 * Values that are legitimately identical to English (proper nouns, currencies,
 * tech terms).  Equal values outside this list are reported as warnings so a
 * human can confirm the string was actually translated.
 */
export const IDENTICAL_VALUE_ALLOWLIST = [
  'Hash',
  'Status',
  'Portfolio',
  'Admin',
  'Name',
  'Filter',
  'Documentation',
  'Date', // French "date"
  'Notifications', // French "notifications"
  'Support', // German "Support"
  'USD ($)',
  'EUR (€)',
  'GBP (£)',
];

/**
 * Flattens a nested locale object into dotted keys.
 * @param {unknown} locale
 * @param {string} [prefix]
 * @param {Record<string, unknown>} [out]
 * @returns {Record<string, unknown>} e.g. `{ 'nav.profile': 'Profile' }`
 */
export function flattenLocale(locale, prefix = '', out = {}) {
  if (locale === null || typeof locale !== 'object' || Array.isArray(locale)) {
    out[prefix] = locale;
    return out;
  }
  for (const [key, value] of Object.entries(locale)) {
    flattenLocale(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/**
 * Drops an i18next plural suffix so `key_one` and `key` compare as the same key.
 * @param {string} key
 * @returns {string}
 */
export function stripPluralSuffix(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

/**
 * @param {Iterable<string>} keys
 * @returns {Set<string>} keys without plural suffixes.
 */
export function toBaseKeySet(keys) {
  return new Set([...keys].map(stripPluralSuffix));
}

/**
 * Extracts the names inside `{{ }}` placeholders.
 * @param {unknown} value
 * @returns {string[]} sorted, unique placeholder names (`'{{language}}'` → `'language'`).
 */
export function collectPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const names = new Set();
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let match = pattern.exec(value);
  while (match !== null) {
    names.add(match[1]);
    match = pattern.exec(value);
  }
  return [...names].sort();
}

/**
 * @param {Record<string, unknown>} reference flat reference locale
 * @param {Record<string, unknown>} candidate flat candidate locale
 * @returns {{ missing: string[], extra: string[] }} sorted key lists.
 */
export function diffLocaleKeys(reference, candidate) {
  const referenceKeys = toBaseKeySet(Object.keys(reference));
  const candidateKeys = toBaseKeySet(Object.keys(candidate));
  return {
    missing: [...referenceKeys].filter((key) => !candidateKeys.has(key)).sort(),
    extra: [...candidateKeys].filter((key) => !referenceKeys.has(key)).sort(),
  };
}

/**
 * @param {Record<string, unknown>} locale flat locale
 * @returns {string[]} keys whose value is missing, or empty/whitespace-only.
 */
export function findEmptyValues(locale) {
  return Object.entries(locale)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([key]) => key)
    .sort();
}

/**
 * @param {Record<string, unknown>} reference flat reference locale
 * @param {Record<string, unknown>} candidate flat candidate locale
 * @returns {Array<{ key: string, expected: string[], actual: string[] }>} placeholders that differ.
 */
export function findPlaceholderMismatches(reference, candidate) {
  const mismatches = [];
  for (const [key, referenceValue] of Object.entries(reference)) {
    if (!(key in candidate)) continue;
    const expected = collectPlaceholders(referenceValue);
    const actual = collectPlaceholders(candidate[key]);
    if (expected.length !== actual.length || expected.some((name, i) => name !== actual[i])) {
      mismatches.push({ key, expected, actual });
    }
  }
  return mismatches.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Reports values identical to the reference so a reviewer can confirm they were
 * meant to stay untranslated.
 * @param {Record<string, unknown>} reference
 * @param {Record<string, unknown>} candidate
 * @param {string[]} [allowlist]
 * @returns {Array<{ key: string, value: string }>}
 */
export function findUntranslatedValues(reference, candidate, allowlist = IDENTICAL_VALUE_ALLOWLIST) {
  const allowed = new Set(allowlist);
  return Object.entries(reference)
    .filter(([key, value]) => {
      if (!(key in candidate)) return false;
      if (typeof value !== 'string' || value.trim() === '') return false;
      if (allowed.has(value)) return false;
      // Single tokens like "Admin" or "Status" are covered by the allowlist;
      // anything left that still matches byte-for-byte is worth a look.
      return candidate[key] === value;
    })
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Validates one locale against the reference.
 * @param {{ code: string, reference?: Record<string, unknown>, candidate: Record<string, unknown> }} input
 * @returns {{ code: string, ok: boolean, errors: Array, warnings: Array<{ key: string, message: string }>, stats: { keys: number, translated: number } }}
 */
export function validateLocale({ code, reference = {}, candidate = {} }) {
  const errors = [];
  const warnings = [];
  const { missing, extra } = diffLocaleKeys(reference, candidate);

  if (missing.length > 0) {
    errors.push({
      type: 'missing-keys',
      keys: missing,
      message: `${missing.length} key(s) missing from ${code}.json`,
    });
  }
  if (extra.length > 0) {
    errors.push({
      type: 'extra-keys',
      keys: extra,
      message: `${extra.length} key(s) in ${code}.json are not defined in the reference locale`,
    });
  }

  const empty = findEmptyValues(candidate);
  if (empty.length > 0) {
    errors.push({ type: 'empty-values', keys: empty, message: `${empty.length} empty translation(s)` });
  }

  const placeholderMismatches = findPlaceholderMismatches(reference, candidate);
  if (placeholderMismatches.length > 0) {
    errors.push({
      type: 'placeholder-mismatch',
      keys: placeholderMismatches.map((mismatch) => mismatch.key),
      details: placeholderMismatches,
      message: `${placeholderMismatches.length} translation(s) use different {{placeholders}} than English`,
    });
  }

  const untranslated = findUntranslatedValues(reference, candidate);
  if (untranslated.length > 0) {
    warnings.push({
      key: '*',
      message: `${untranslated.length} value(s) are identical to English — confirm they are intentionally untranslated`,
      details: untranslated,
    });
  }

  const keys = Object.keys(candidate).length;
  return {
    code,
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { keys, translated: keys - empty.length },
  };
}

/**
 * Validates many locales at once.
 * @param {Record<string, Record<string, unknown>>} locales keyed by locale code, nested or flat
 * @param {{ referenceCode?: string, codes?: string[] }} [options]
 * @returns {{ ok: boolean, referenceCode: string, results: Array, missingLocales: string[] }}
 */
export function validateLocales(locales, options = {}) {
  const referenceCode = options.referenceCode ?? REFERENCE_LOCALE;
  const flatLocales = Object.fromEntries(
    Object.entries(locales).map(([code, locale]) => [code, flattenLocale(locale)]),
  );

  const reference = flatLocales[referenceCode];
  if (!reference) {
    throw new Error(`reference locale "${referenceCode}" was not provided`);
  }

  const codes = options.codes ?? Object.keys(flatLocales);
  const missingLocales = codes.filter((code) => !(code in flatLocales));

  const results = codes
    .filter((code) => code in flatLocales && code !== referenceCode)
    .map((code) => validateLocale({ code, reference, candidate: flatLocales[code] }));

  return {
    ok: missingLocales.length === 0 && results.every((result) => result.ok),
    referenceCode,
    results,
    missingLocales,
  };
}

/**
 * Removes `//` and `/* *\/` comments, preserving string literals.
 *
 * Comments are documentation: they legitimately contain example calls such as
 * `t('search.title')`, and scanning them would report keys that do not exist.
 * String contents are preserved because that is where keys live. Line and byte
 * positions are not preserved (the output is only ever searched).
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      out += ' ';
      continue;
    }

    if (char === "'" || char === '"' || char === '`') quote = char;
    out += char;
    index += 1;
  }

  return out;
}

/**
 * Matches a literal-key `t(...)` call — single or double quoted with a dotted key,
 * e.g. `t('nav.profile')`. Template keys such as ``t(`search.${status}`)`` cannot
 * be verified statically and are ignored.
 */
const LITERAL_T_CALL = /\bt\(\s*(?:'([^'".\s]+(?:\.[^'".\s]+)+)'|"([^'".\s]+(?:\.[^'".\s]+)+)")/g;

/** A file is only scanned for keys when it actually wires up translations. */
const I18N_FILE = /\buseTranslation\b|\bi18next\b|\bwithTranslation\b|\bTrans\b/;

/**
 * Collects literal translation keys used in the given sources. Comments are
 * stripped first, so documented examples are never mistaken for real usage.
 * @param {Array<{ path: string, source: string }>} files
 * @returns {Map<string, string[]>} key → sorted file paths that use it.
 */
export function collectUsedKeys(files) {
  const used = new Map();
  for (const { path, source } of files) {
    if (!I18N_FILE.test(source)) continue;
    const code = stripComments(source);
    LITERAL_T_CALL.lastIndex = 0;
    let match = LITERAL_T_CALL.exec(code);
    while (match !== null) {
      const key = match[1] ?? match[2];
      const paths = used.get(key) ?? [];
      if (!paths.includes(path)) paths.push(path);
      used.set(key, paths);
      match = LITERAL_T_CALL.exec(code);
    }
  }
  for (const paths of used.values()) paths.sort();
  return used;
}

/**
 * Finds keys the UI asks for that the reference locale does not define.  Those
 * render as the raw key (`search.title`) — i18next returns the key, which is
 * truthy, so `t('x') || 'fallback'` never falls back.
 * @param {Array<{ path: string, source: string }>} files
 * @param {Record<string, unknown> | Set<string>} referenceKeys flat reference locale or key set
 * @returns {{ missingKeys: Array<{ key: string, files: string[] }>, unusedKeys: string[] }}
 */
export function auditTranslationUsage(files, referenceKeys) {
  const known =
    referenceKeys instanceof Set ? referenceKeys : toBaseKeySet(Object.keys(referenceKeys ?? {}));
  const used = collectUsedKeys(files);

  const missingKeys = [...used.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, paths]) => ({ key, files: paths }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const unusedKeys = [...known].filter((key) => !used.has(key)).sort();

  return { missingKeys, unusedKeys };
}
