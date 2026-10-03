import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import {
  formatLocalDate,
  formatLocalCurrency,
  formatLocalNumber,
  formatLocalDecimal,
} from '../../utils/i18nFormatters';
import styles from './i18nExample.module.css';

/**
 * Example component demonstrating i18n integration
 * Shows translation usage, date formatting, number formatting, and RTL support
 */
export default function I18nExample() {
  const { t } = useTranslation();
  const { currentLanguage, isRTL, direction, getSupportedLanguages, changeLanguage } = useLanguage();

  const exampleDate = new Date('2024-08-26T14:30:45');
  const exampleAmount = 1234.567;
  const examplePrice = 9876.54;

  return (
    <div className={styles.container} style={{ direction }}>
      <section className={styles.section}>
        <h2>{t('common.loading')}</h2>
        <p>Current Language: <strong>{currentLanguage}</strong></p>
        <p>Text Direction: <strong>{direction.toUpperCase()}</strong></p>
        <p>Is RTL: <strong>{isRTL ? 'Yes' : 'No'}</strong></p>
      </section>

      <section className={styles.section}>
        <h2>Language Selector</h2>
        <div className={styles.languageGrid}>
          {getSupportedLanguages().map((lang) => (
            <button
              key={lang.code}
              className={`${styles.langBtn} ${lang.isCurrent ? styles.active : ''}`}
              onClick={() => changeLanguage(lang.code)}
            >
              {lang.name}
              {lang.isCurrent && ' ✓'}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Translation Examples</h2>
        <div className={styles.exampleList}>
          <div className={styles.example}>
            <label>Marketplace Title:</label>
            <span>{t('marketplace.title')}</span>
          </div>
          <div className={styles.example}>
            <label>Portfolio:</label>
            <span>{t('portfolio.title')}</span>
          </div>
          <div className={styles.example}>
            <label>Connect Wallet:</label>
            <span>{t('wallet.connect')}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Date & Time Formatting</h2>
        <div className={styles.exampleList}>
          <div className={styles.example}>
            <label>Full Format:</label>
            <span>{formatLocalDate(exampleDate, currentLanguage)}</span>
          </div>
          <div className={styles.example}>
            <label>Short Date:</label>
            <span>{formatLocalDate(exampleDate, currentLanguage, 'MMM dd, yyyy')}</span>
          </div>
          <div className={styles.example}>
            <label>Time Only:</label>
            <span>{formatLocalDate(exampleDate, currentLanguage, 'p')}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Number & Currency Formatting</h2>
        <div className={styles.exampleList}>
          <div className={styles.example}>
            <label>Regular Number:</label>
            <span>{formatLocalNumber(exampleAmount, currentLanguage)}</span>
          </div>
          <div className={styles.example}>
            <label>Decimal (2 places):</label>
            <span>{formatLocalDecimal(exampleAmount, currentLanguage, 2)}</span>
          </div>
          <div className={styles.example}>
            <label>USD Currency:</label>
            <span>{formatLocalCurrency(examplePrice, 'USD', currentLanguage)}</span>
          </div>
          <div className={styles.example}>
            <label>EUR Currency:</label>
            <span>{formatLocalCurrency(examplePrice, 'EUR', currentLanguage)}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Code Examples</h2>
        <pre className={styles.codeBlock}>
{`// Using translations
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
<h1>{t('marketplace.title')}</h1>

// Using language context
import { useLanguage } from './context/LanguageContext';

const { currentLanguage, isRTL } = useLanguage();

// Formatting dates
import { formatLocalDate } from './utils/i18nFormatters';

const formatted = formatLocalDate(date, currentLanguage);

// Formatting currency
import { formatLocalCurrency } from './utils/i18nFormatters';

const price = formatLocalCurrency(1234.56, 'USD', currentLanguage);`}
        </pre>
      </section>
    </div>
  );
}
