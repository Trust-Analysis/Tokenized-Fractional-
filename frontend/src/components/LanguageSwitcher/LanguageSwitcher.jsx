import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitcher.module.css';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage || i18n.language;

  return (
    <div className={styles.switcher} role="group" aria-label="Language selector">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          className={`${styles.btn} ${current.startsWith(code) ? styles.active : ''}`}
          onClick={() => i18n.changeLanguage(code)}
          aria-pressed={current.startsWith(code)}
          aria-label={`Switch language to ${label}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
