import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import { isRTLLanguage, getLanguageDirection } from './utils/i18nFormatters';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES } from './i18n/languages';

// The language registry lives in ./i18n/languages.js so the locale checker and
// the parity tests can read it without booting i18next (this module touches
// `document` on import). Re-exported here because components import
// `SUPPORTED_LANGUAGES` from this file. When adding a language: add it to the
// registry, add `src/locales/<code>.json`, and register the resource below —
// `npm run i18n:check` fails if any of the three is missing.
export { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES };

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Update document attributes when language changes
i18n.on('languageChanged', (lng) => {
  // Set lang attribute for accessibility
  document.documentElement.lang = lng;

  // Set dir attribute for RTL support
  const direction = getLanguageDirection(lng);
  document.documentElement.dir = direction;
  document.body.dir = direction;

  // Add RTL class for CSS styling
  if (isRTLLanguage(lng)) {
    document.documentElement.classList.add('rtl');
    document.body.classList.add('rtl');
  } else {
    document.documentElement.classList.remove('rtl');
    document.body.classList.remove('rtl');
  }
});

// Set initial language attributes
const initialLng = i18n.language || DEFAULT_LANGUAGE;
document.documentElement.lang = initialLng;
const initialDir = getLanguageDirection(initialLng);
document.documentElement.dir = initialDir;
document.body.dir = initialDir;

export default i18n;
