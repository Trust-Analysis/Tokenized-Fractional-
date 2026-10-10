// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Filesystem helpers for the locale checks.
 *
 * Kept separate from `localeParity.js` so the parity rules stay pure and
 * unit-testable, while `scripts/check-locales.js` and the tests share one
 * implementation of "which files are locales" and "which files contain copy".
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `frontend/src` */
export const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));
/** `frontend/src/locales` */
export const LOCALES_DIR = join(SRC_DIR, 'locales');
/** `frontend/src/i18n.js` — the i18next bootstrap that registers every resource. */
export const I18N_CONFIG_PATH = join(SRC_DIR, 'i18n.js');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'locales', 'dist', 'coverage']);
const SKIPPED_FILE_PATTERN = /\.(test|spec)\.|\.stories\./;
const SOURCE_FILE_PATTERN = /\.(js|jsx)$/;

/**
 * @param {string} file
 * @returns {Record<string, unknown>} parsed JSON
 */
export function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Reads every `src/locales/<code>.json`.
 * @param {string} [localesDir]
 * @returns {Record<string, Record<string, unknown>>} keyed by locale code.
 */
export function readLocaleFiles(localesDir = LOCALES_DIR) {
  const locales = {};
  for (const entry of readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    locales[entry.name.replace(/\.json$/, '')] = readJsonFile(join(localesDir, entry.name));
  }
  return locales;
}

/**
 * Recursively lists application source files that may contain user-facing copy.
 * Tests, stories, generated bundles and the locale files themselves are skipped.
 * @param {string} [directory]
 * @returns {string[]} absolute paths, sorted.
 */
export function listSourceFiles(directory = SRC_DIR) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!SOURCE_FILE_PATTERN.test(entry.name)) continue;
      if (SKIPPED_FILE_PATTERN.test(entry.name)) continue;
      files.push(join(dir, entry.name));
    }
  };
  walk(directory);
  return files;
}

/**
 * @param {string[]} files absolute paths
 * @param {string} [base]
 * @returns {Array<{ path: string, source: string }>} with POSIX-style relative paths.
 */
export function readSources(files, base = SRC_DIR) {
  return files.map((file) => ({
    path: relative(base, file).split(sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

/**
 * Reads the i18next bootstrap so we can verify that every registered language is
 * actually wired into `resources` — the one step `src/locales` cannot prove.
 * @returns {string}
 */
export function readI18nConfig() {
  return readFileSync(I18N_CONFIG_PATH, 'utf8');
}

/**
 * @param {string} i18nSource contents of `src/i18n.js`
 * @param {string[]} codes locale codes that should be registered
 * @param {string} defaultCode fallback language
 * @returns {{ unimported: string[], unregistered: string[], badFallback: string | null }}
 */
export function findI18nRegistrationIssues(i18nSource, codes, defaultCode = 'en') {
  const unimported = codes.filter(
    (code) => !new RegExp(`from\\s+['"]\\./locales/${code}\\.json['"]`).test(i18nSource),
  );
  const unregistered = codes.filter(
    (code) => !new RegExp(`\\b${code}\\s*:\\s*\\{\\s*translation\\s*:`).test(i18nSource),
  );
  const fallbackMatch = i18nSource.match(/fallbackLng\s*:\s*(['"`])([\w-]+)\1/);
  // `fallbackLng: DEFAULT_LANGUAGE` is the preferred form; it cannot be compared
  // textually, so accept the constant reference and only flag literal mismatches.
  const usesDefaultConstant = /fallbackLng\s*:\s*DEFAULT_LANGUAGE\b/.test(i18nSource);
  const badFallback =
    !usesDefaultConstant && fallbackMatch && fallbackMatch[2] !== defaultCode
      ? fallbackMatch[2]
      : null;

  return { unimported, unregistered, badFallback };
}
