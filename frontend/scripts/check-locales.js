#!/usr/bin/env node
// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Locale checker — `npm run i18n:check`.
 *
 * Fails when a translation is missing, empty, orphaned, or has lost a
 * `{{placeholder}}`; when a language is registered but has no locale file (or
 * vice versa); when `src/i18n.js` does not register a resource; and when the
 * source tree asks for a key that English does not define (which renders the raw
 * key in the UI instead of falling back).
 *
 * Needs no dependencies and does not boot i18next, so CI can run it straight
 * after checkout: `node scripts/check-locales.js`.
 *
 * Usage:
 *   node scripts/check-locales.js             # human-readable report
 *   node scripts/check-locales.js --json      # machine-readable report
 *   node scripts/check-locales.js --strict    # treat warnings as failures
 */

import process from 'node:process';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from '../src/i18n/languages.js';
import {
  auditTranslationUsage,
  flattenLocale,
  validateLocales,
} from '../src/i18n/localeParity.js';
import {
  findI18nRegistrationIssues,
  listSourceFiles,
  readI18nConfig,
  readLocaleFiles,
  readSources,
} from '../src/i18n/localeFiles.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const strict = args.has('--strict');

const locales = readLocaleFiles();
const reference = flattenLocale(locales[DEFAULT_LANGUAGE] ?? {});
const codesOnDisk = Object.keys(locales).sort();

const parity = validateLocales(locales, {
  referenceCode: DEFAULT_LANGUAGE,
  codes: SUPPORTED_LANGUAGE_CODES,
});

const registration = findI18nRegistrationIssues(
  readI18nConfig(),
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
);

const { missingKeys, unusedKeys } = auditTranslationUsage(
  readSources(listSourceFiles()),
  reference,
);

const registrationErrors = [];
if (registration.unimported.length > 0) {
  registrationErrors.push(
    `src/i18n.js does not import: ${registration.unimported
      .map((code) => `./locales/${code}.json`)
      .join(', ')}`,
  );
}
if (registration.unregistered.length > 0) {
  registrationErrors.push(
    `src/i18n.js is missing a \`resources\` entry for: ${registration.unregistered.join(', ')}`,
  );
}
if (registration.badFallback) {
  registrationErrors.push(
    `fallbackLng is "${registration.badFallback}" but the reference locale is "${DEFAULT_LANGUAGE}"`,
  );
}

const unregisteredFiles = codesOnDisk.filter((code) => !SUPPORTED_LANGUAGE_CODES.includes(code));
if (unregisteredFiles.length > 0) {
  registrationErrors.push(
    `locale file(s) present but not registered in src/i18n/languages.js: ${unregisteredFiles.join(', ')}`,
  );
}

const missingLocaleErrors = parity.missingLocales.map(
  (code) => `no src/locales/${code}.json for registered language "${code}"`,
);
if (missingKeys.length > 0) {
  missingLocaleErrors.push(
    `${missingKeys.length} translation key(s) used in src/ but missing from ${DEFAULT_LANGUAGE}.json: ` +
      missingKeys.map((entry) => `${entry.key} (${entry.files.join(', ')})`).join('; '),
  );
}

const failed = !parity.ok || registrationErrors.length > 0 || missingLocaleErrors.length > 0;
const warningsPresent = parity.results.some((result) => result.warnings.length > 0);

const report = {
  ok: failed ? false : strict ? !warningsPresent : true,
  referenceLocale: DEFAULT_LANGUAGE,
  registeredLanguages: [...SUPPORTED_LANGUAGE_CODES],
  localeFiles: codesOnDisk,
  totals: {
    keys: Object.keys(reference).length,
    locales: parity.results.length + 1,
    usedKeys: Object.keys(reference).length - unusedKeys.length || 0,
  },
  locales: parity.results.map((result) => ({
    code: result.code,
    ok: result.ok,
    keys: result.stats.keys,
    errors: result.errors.map((error) => error.message),
    warnings: result.warnings.map((warning) => warning.message),
  })),
  registrationErrors,
  missingLocaleErrors,
  missingKeysInSource: missingKeys,
  unusedKeysInReference: unusedKeys,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const lines = [];
  lines.push('');
  lines.push('i18n locale check');
  lines.push('─────────────────');
  lines.push(
    `reference locale : ${DEFAULT_LANGUAGE} (${Object.keys(reference).length} keys)`,
  );
  lines.push(`languages        : ${SUPPORTED_LANGUAGE_CODES.join(', ')}`);
  lines.push(`locale files     : ${codesOnDisk.join(', ')}`);
  lines.push('');

  for (const result of parity.results) {
    const icon = result.ok ? '✅' : '❌';
    lines.push(`${icon} ${result.code} — ${result.stats.keys} keys`);
    for (const error of result.errors) {
      lines.push(`     error: ${error.message}`);
      if (error.type === 'missing-keys') {
        for (const key of error.keys.slice(0, 10)) lines.push(`       · ${key}`);
        if (error.keys.length > 10) lines.push(`       · …and ${error.keys.length - 10} more`);
      }
      if (error.type === 'placeholder-mismatch') {
        for (const detail of error.details) {
          lines.push(
            `       · ${detail.key}: expected {{${detail.expected.join('}}, {{')}}} got {{${detail.actual.join('}}, {{')}}}`,
          );
        }
      }
    }
    for (const warning of result.warnings) {
      lines.push(`     warning: ${warning.message}`);
      for (const detail of warning.details ?? []) {
        lines.push(`       · ${detail.key}: "${detail.value}"`);
      }
    }
  }

  if (registrationErrors.length > 0 || missingLocaleErrors.length > 0) {
    lines.push('');
    for (const error of [...registrationErrors, ...missingLocaleErrors]) {
      lines.push(`❌ ${error}`);
    }
  }

  lines.push('');
  if (unusedKeys.length > 0) {
    lines.push(
      `ℹ️  ${unusedKeys.length} key(s) in ${DEFAULT_LANGUAGE}.json are not referenced by a literal t() call (they may be used through a template key).`,
    );
  }
  lines.push(
    report.ok ? '✅ i18n check passed.' : '❌ i18n check failed — see the errors above.',
  );
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (!report.ok) process.exitCode = 1;
