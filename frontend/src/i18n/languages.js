// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Language registry — the single source of truth for the locales the app ships.
 *
 * This lives in its own module rather than inline in `src/i18n.js` so that
 * tooling which must not boot i18next (the locale checker in
 * `scripts/check-locales.js` and the parity tests) can import the exact list the
 * UI uses.  Importing `src/i18n.js` from Node would touch `document`.
 *
 * To add a language you must do all three of:
 *   1. add an entry here,
 *   2. add `src/locales/<code>.json`,
 *   3. register the resource in `src/i18n.js`.
 * `npm run i18n:check` fails if any of the three is missing.  See the
 * Internationalization section of CONTRIBUTING.md.
 */

/** Locale used when a translation is missing or the browser language is unsupported. */
export const DEFAULT_LANGUAGE = 'en';

/**
 * @typedef {object} SupportedLanguage
 * @property {string} code   BCP-47 base code, also the locale file name (`<code>.json`).
 * @property {string} label  Endonym shown in the language switcher.
 * @property {string} name   English name, kept for non-UI tooling and logs.
 */

/** @type {ReadonlyArray<SupportedLanguage>} */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', name: 'English' },
  { code: 'es', label: 'Español', name: 'Spanish' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'de', label: 'Deutsch', name: 'German' },
];

/** Locale codes in registry order. */
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(({ code }) => code);

/**
 * @param {string} code
 * @returns {boolean} true when `code` is one of the shipped locales.
 */
export function isSupportedLanguage(code) {
  return SUPPORTED_LANGUAGE_CODES.includes(code);
}

/**
 * @param {string} code
 * @returns {SupportedLanguage | undefined}
 */
export function getLanguage(code) {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code);
}
