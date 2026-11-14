/**
 * i18n Utilities Module
 * Handles date, time, number, and currency formatting with locale support
 */

import { format, formatDistance, parseISO, isValid } from 'date-fns';
import { enUS, es, fr, de } from 'date-fns/locale';

// Language to date-fns locale mapping
const LOCALE_MAP = {
  en: enUS,
  es: es,
  fr: fr,
  de: de,
};

// RTL language configuration
export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * Get date-fns locale object for given language code
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {object} date-fns locale object
 */
export const getDateLocale = (languageCode) => {
  const baseLang = languageCode.split('-')[0];
  return LOCALE_MAP[baseLang] || enUS;
};

/**
 * Format a date according to locale
 * @param {Date|string|number} date - Date to format
 * @param {string} languageCode - ISO 639-1 language code
 * @param {string} formatStr - date-fns format string (default: 'PPpp')
 * @returns {string} Formatted date string
 */
export const formatLocalDate = (date, languageCode = 'en', formatStr = 'PPpp') => {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    if (!isValid(dateObj)) return '';
    return format(dateObj, formatStr, { locale: getDateLocale(languageCode) });
  } catch (error) {
    console.error('Error formatting date:', error);
    return '';
  }
};

/**
 * Format a date as short format (e.g., "Jan 01, 2024")
 * @param {Date|string|number} date - Date to format
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} Formatted date string
 */
export const formatLocalDateShort = (date, languageCode = 'en') => {
  return formatLocalDate(date, languageCode, 'MMM dd, yyyy');
};

/**
 * Format a date as long format (e.g., "January 01, 2024 at 14:30:45")
 * @param {Date|string|number} date - Date to format
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} Formatted date string
 */
export const formatLocalDateLong = (date, languageCode = 'en') => {
  return formatLocalDate(date, languageCode, 'PPPP p');
};

/**
 * Format a date as time only (e.g., "2:30 PM")
 * @param {Date|string|number} date - Date to format
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} Formatted time string
 */
export const formatLocalTime = (date, languageCode = 'en') => {
  return formatLocalDate(date, languageCode, 'p');
};

/**
 * Format distance between two dates (e.g., "2 hours ago")
 * @param {Date|string|number} date1 - First date
 * @param {Date|string|number} date2 - Second date (defaults to now)
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} Formatted distance string
 */
export const formatLocalDistance = (date1, date2 = new Date(), languageCode = 'en') => {
  try {
    const dateObj1 = typeof date1 === 'string' ? parseISO(date1) : new Date(date1);
    const dateObj2 = typeof date2 === 'string' ? parseISO(date2) : new Date(date2);
    if (!isValid(dateObj1) || !isValid(dateObj2)) return '';
    return formatDistance(dateObj1, dateObj2, { locale: getDateLocale(languageCode) });
  } catch (error) {
    console.error('Error formatting distance:', error);
    return '';
  }
};

/**
 * Get current browser locale or fallback to 'en-US'
 * @returns {string} Browser locale string
 */
export const getBrowserLocale = () => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
};

/**
 * Validate and resolve a locale string with graceful fallback
 * @param {string} [locale] - Candidate locale
 * @returns {string} Validated locale string or 'en-US'
 */
export const getSafeLocale = (locale) => {
  const candidate = locale || getBrowserLocale();
  try {
    if (Intl.NumberFormat.supportedLocalesOf([candidate]).length > 0) {
      return candidate;
    }
  } catch {
    // Malformed locale tag fallback
  }
  return 'en-US';
};

/**
 * Format a number according to locale
 * @param {number} num - Number to format
 * @param {string} [languageCode] - ISO language/locale code
 * @param {object} [options] - Intl.NumberFormat options
 * @returns {string} Formatted number string
 */
export const formatLocalNumber = (num, languageCode, options = {}) => {
  if (num === null || num === undefined || isNaN(Number(num))) {
    return '0';
  }
  const numericValue = Number(num);
  const locale = getSafeLocale(languageCode);
  try {
    return new Intl.NumberFormat(locale, options).format(numericValue);
  } catch (error) {
    console.error('Error formatting number:', error);
    try {
      return new Intl.NumberFormat('en-US', options).format(numericValue);
    } catch {
      return String(numericValue);
    }
  }
};

/**
 * Format a number as currency using Intl.NumberFormat
 * @param {number} amount - Amount to format
 * @param {string} [currency='USD'] - ISO 4217 currency code (e.g., 'USD', 'EUR')
 * @param {string} [languageCode] - ISO language/locale code
 * @returns {string} Formatted currency string
 */
export const formatLocalCurrency = (amount, currency = 'USD', languageCode) => {
  const safeCurrency = currency || 'USD';
  return formatLocalNumber(amount, languageCode, {
    style: 'currency',
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * Format fiat equivalency respecting browser locale and currency
 * @param {number} amount - Amount to format
 * @param {string} [currency='USD'] - ISO 4217 currency code
 * @param {string} [languageCode] - ISO language/locale code
 * @returns {string} Formatted fiat string
 */
export const formatFiat = (amount, currency = 'USD', languageCode) => {
  return formatLocalCurrency(amount, currency, languageCode);
};

/**
 * Format order execution timestamp based on the user's locale using Intl.DateTimeFormat
 * @param {Date|string|number} date - Date/timestamp to format
 * @param {string} [languageCode] - ISO language/locale code (defaults to browser locale)
 * @param {object} [options] - Intl.DateTimeFormat options
 * @returns {string} Formatted timestamp string with graceful fallback
 */
export const formatOrderTimestamp = (date, languageCode, options = {}) => {
  if (!date) return '';
  const locale = getSafeLocale(languageCode);
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options,
  };

  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    const validDate = isValid(dateObj) ? dateObj : new Date(date);
    if (isNaN(validDate.getTime())) return '';
    return new Intl.DateTimeFormat(locale, defaultOptions).format(validDate);
  } catch (error) {
    console.error('Error formatting order timestamp:', error);
    try {
      return new Intl.DateTimeFormat('en-US', defaultOptions).format(new Date(date));
    } catch {
      return String(date);
    }
  }
};

/**
 * Format a number with percentage
 * @param {number} value - Value to format as percentage
 * @param {string} [languageCode] - ISO language/locale code
 * @param {number} [fractionDigits=2] - Number of fraction digits
 * @returns {string} Formatted percentage string
 */
export const formatLocalPercentage = (value, languageCode, fractionDigits = 2) => {
  return formatLocalNumber(value / 100, languageCode, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

/**
 * Format a number as decimal (with thousands separator)
 * @param {number} num - Number to format
 * @param {string} languageCode - ISO 639-1 language code
 * @param {number} fractionDigits - Number of fraction digits
 * @returns {string} Formatted number string
 */
export const formatLocalDecimal = (num, languageCode = 'en', fractionDigits = 2) => {
  return formatLocalNumber(num, languageCode, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

/**
 * Get country code for language code
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} ISO 3166-1 alpha-2 country code
 */
const getCountryCode = (languageCode) => {
  const countryMap = {
    en: 'US',
    es: 'ES',
    fr: 'FR',
    de: 'DE',
    ar: 'SA',
    he: 'IL',
    fa: 'IR',
    ur: 'PK',
  };
  return countryMap[languageCode.split('-')[0]] || 'US';
};

/**
 * Check if language is RTL (right-to-left)
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {boolean} True if language is RTL
 */
export const isRTLLanguage = (languageCode) => {
  const baseLang = languageCode.split('-')[0];
  return RTL_LANGUAGES.has(baseLang);
};

/**
 * Get document direction for language
 * @param {string} languageCode - ISO 639-1 language code
 * @returns {string} 'rtl' or 'ltr'
 */
export const getLanguageDirection = (languageCode) => {
  return isRTLLanguage(languageCode) ? 'rtl' : 'ltr';
};

export default {
  getBrowserLocale,
  getSafeLocale,
  getDateLocale,
  formatLocalDate,
  formatLocalDateShort,
  formatLocalDateLong,
  formatLocalTime,
  formatLocalDistance,
  formatLocalNumber,
  formatLocalCurrency,
  formatFiat,
  formatOrderTimestamp,
  formatLocalPercentage,
  formatLocalDecimal,
  isRTLLanguage,
  getLanguageDirection,
};
