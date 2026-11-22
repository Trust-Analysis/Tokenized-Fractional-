import React from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import styles from './LanguageSwitcher.module.css';

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage || i18n.language;

  const handleLanguageChange = (langCode) => {
    i18n.changeLanguage(langCode);
  };

  return (
    <div
      className={styles.switcher}
      role="group"
      aria-label={t('a11y.languageSelector', { defaultValue: 'Language selector' })}
    >
      {SUPPORTED_LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          className={`${styles.btn} ${current.startsWith(code) ? styles.active : ''}`}
          onClick={() => handleLanguageChange(code)}
          aria-pressed={current.startsWith(code)}
          aria-label={t('a11y.switchLanguage', {
            language: t(`languages.${code}`, { defaultValue: label }),
            defaultValue: `Switch language to ${label}`,
          })}
          // The visible label is the endonym ("Français"); `lang` makes screen
          // readers pronounce it in that language rather than the UI language.
          lang={code}
          title={label}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
