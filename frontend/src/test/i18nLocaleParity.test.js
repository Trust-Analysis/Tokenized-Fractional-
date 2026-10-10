// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Locale guards for issue #715 — the i18n setup must stay complete.
 *
 * These tests fail whenever a language drifts from English, and whenever the
 * source tree asks for a translation key that English does not define (which
 * renders the raw key in the UI). The same rules run in CI via
 * `npm run i18n:check`.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '../i18n/languages';
import {
  IDENTICAL_VALUE_ALLOWLIST,
  auditTranslationUsage,
  collectPlaceholders,
  diffLocaleKeys,
  findEmptyValues,
  flattenLocale,
  stripComments,
  validateLocales,
} from '../i18n/localeParity';
import {
  findI18nRegistrationIssues,
  listSourceFiles,
  readI18nConfig,
  readLocaleFiles,
  readSources,
} from '../i18n/localeFiles';

const locales = readLocaleFiles();
const reference = flattenLocale(locales[DEFAULT_LANGUAGE] ?? {});
const referenceKeys = Object.keys(reference);
const parity = validateLocales(locales, {
  referenceCode: DEFAULT_LANGUAGE,
  codes: SUPPORTED_LANGUAGE_CODES,
});

const errorsOfType = (result, type) => result.errors.filter((error) => error.type === type);

describe('locale registry', () => {
  it('ships a locale file for every registered language', () => {
    expect(parity.missingLocales).toEqual([]);
  });

  it('registers every locale file that is on disk', () => {
    const orphans = Object.keys(locales).filter((code) => !SUPPORTED_LANGUAGE_CODES.includes(code));
    expect(orphans).toEqual([]);
  });

  it('registers a unique code and label per language, including the fallback', () => {
    const codes = SUPPORTED_LANGUAGES.map(({ code }) => code);
    const labels = SUPPORTED_LANGUAGES.map(({ label }) => label);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(codes).toContain(DEFAULT_LANGUAGE);
  });
});

describe('locale parity with English', () => {
  it('passes the parity check for every language', () => {
    expect(parity.ok).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE))(
    '%s.json defines exactly the same keys as English',
    (code) => {
      const result = parity.results.find((entry) => entry.code === code);
      expect(errorsOfType(result, 'missing-keys')).toEqual([]);
      expect(errorsOfType(result, 'extra-keys')).toEqual([]);
    },
  );

  it.each(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE))(
    '%s.json has no empty translation',
    (code) => {
      const result = parity.results.find((entry) => entry.code === code);
      expect(errorsOfType(result, 'empty-values')).toEqual([]);
    },
  );

  it.each(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE))(
    '%s.json keeps every {{placeholder}} English uses',
    (code) => {
      const result = parity.results.find((entry) => entry.code === code);
      expect(errorsOfType(result, 'placeholder-mismatch')).toEqual([]);
    },
  );

  it.each(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE))(
    '%s.json has no value left identical to English outside the allowlist',
    (code) => {
      const result = parity.results.find((entry) => entry.code === code);
      const identical = result.warnings.flatMap((warning) => warning.details ?? []);
      // Legitimate cognates belong in IDENTICAL_VALUE_ALLOWLIST; anything else
      // here means a string was copied from English and never translated.
      expect(identical.map(({ key }) => key)).toEqual([]);
      expect(IDENTICAL_VALUE_ALLOWLIST.length).toBeGreaterThan(0);
    },
  );

  it('defines a key for every namespace English defines', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const locale = flattenLocale(locales[code]);
      const namespaces = (value) =>
        new Set(Object.keys(value).map((key) => key.split('.')[0]));
      expect([...namespaces(locale)].sort()).toEqual([...namespaces(reference)].sort());
    }
  });
});

describe('i18next bootstrap registration', () => {
  const registration = findI18nRegistrationIssues(
    readI18nConfig(),
    SUPPORTED_LANGUAGE_CODES,
    DEFAULT_LANGUAGE,
  );

  it('imports a locale file for every supported language', () => {
    expect(registration.unimported).toEqual([]);
  });

  it('registers a translation resource for every supported language', () => {
    expect(registration.unregistered).toEqual([]);
  });

  it('falls back to the default language', () => {
    expect(registration.badFallback).toBeNull();
  });
});

describe('source usage audit', () => {
  const audit = auditTranslationUsage(readSources(listSourceFiles()), reference);

  it('finds at least one translation key in the source tree', () => {
    expect(referenceKeys.length).toBeGreaterThan(0);
    expect(audit.unusedKeys.length).toBeLessThan(referenceKeys.length);
  });

  it('defines every literal t() key used in src/ in the reference locale', () => {
    // A key that is requested but undefined is rendered verbatim — i18next
    // returns the key itself, which is truthy, so a `|| 'Default'` guard on the
    // call site never fires.
    expect(audit.missingKeys).toEqual([]);
  });

  it('reports a key that English does not define', () => {
    const files = [
      {
        path: 'components/Example/Example.jsx',
        source: "import { useTranslation } from 'react-i18next';\nexport const a = (t) => t('does.notExist');",
      },
    ];
    expect(auditTranslationUsage(files, reference).missingKeys).toEqual([
      { key: 'does.notExist', files: ['components/Example/Example.jsx'] },
    ]);
  });

  it('ignores keys that only appear in comments or template literals', () => {
    const files = [
      {
        path: 'components/Example/Example.jsx',
        source: [
          "import { useTranslation } from 'react-i18next';",
          "// documents t('commented.out') and /* t(\"also.out\") */",
          'export const a = (t, status) => t(`search.${status}`);',
        ].join('\n'),
      },
    ];
    expect(auditTranslationUsage(files, reference).missingKeys).toEqual([]);
  });

  it('only scans files that use the translation primitives', () => {
    const files = [{ path: 'lib/util.js', source: "export const t = (k) => k('not.i18n');" }];
    expect(auditTranslationUsage(files, reference).missingKeys).toEqual([]);
  });
});

describe('locale parity internals', () => {
  it('flattens nested locales into dotted keys', () => {
    expect(flattenLocale({ nav: { profile: 'Profile' }, theme: { toDark: 'Dark' } })).toEqual({
      'nav.profile': 'Profile',
      'theme.toDark': 'Dark',
    });
    expect(flattenLocale({})).toEqual({});
  });

  it('extracts and sorts placeholder names', () => {
    expect(collectPlaceholders('Switch language to {{language}}')).toEqual(['language']);
    expect(collectPlaceholders('{{b}} and {{a}} and {{a}}')).toEqual(['a', 'b']);
    expect(collectPlaceholders('no placeholders')).toEqual([]);
    expect(collectPlaceholders(undefined)).toEqual([]);
  });

  it('ignores plural suffixes when comparing keys', () => {
    expect(diffLocaleKeys({ 'item_one': 'a', 'item_other': 'b' }, { item: 'c' })).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('detects missing, extra and empty entries', () => {
    expect(diffLocaleKeys({ 'a.b': 'x', 'a.c': 'y' }, { 'a.b': 'x' })).toEqual({
      missing: ['a.c'],
      extra: [],
    });
    expect(findEmptyValues({ a: 'x', b: '', c: '   ', d: 42 })).toEqual(['b', 'c', 'd']);
  });

  it('strips comments while preserving strings', () => {
    const source = "const a = t('nav.profile'); // t('gone')\n/* t('also.gone') */ const u = 'https://x';";
    const stripped = stripComments(source);
    expect(stripped).toContain("t('nav.profile')");
    expect(stripped).toContain("'https://x'");
    expect(stripped).not.toContain('gone');
  });
});
