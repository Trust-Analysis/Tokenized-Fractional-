import React, { createContext, useContext, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { getLanguageDirection, isRTLLanguage } from '../utils/i18nFormatters';

/**
 * LanguageContext provides global language state and utilities
 * including language switching, direction detection, and preference storage
 */
const LanguageContext = createContext();

/**
 * LanguageProvider component - wraps the app to provide language context
 */
export const LanguageProvider = ({ children }) => {
  const { i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage || i18n.language || 'en';
  const isRTL = isRTLLanguage(currentLanguage);
  const direction = getLanguageDirection(currentLanguage);

  /**
   * Change language and update document
   */
  const changeLanguage = useCallback(async (langCode) => {
    try {
      await i18n.changeLanguage(langCode);
      // Language change handlers in i18n.js will update DOM
      // Dispatch custom event for any listeners
      window.dispatchEvent(
        new CustomEvent('languageChange', {
          detail: { language: langCode, isRTL: isRTLLanguage(langCode) },
        })
      );
    } catch (error) {
      console.error('Error changing language:', error);
    }
  }, [i18n]);

  /**
   * Get language metadata
   */
  const getLanguageInfo = useCallback((langCode = currentLanguage) => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
    return {
      ...lang,
      isRTL: isRTLLanguage(langCode),
      direction: getLanguageDirection(langCode),
    };
  }, [currentLanguage]);

  /**
   * Get all supported languages with current status
   */
  const getSupportedLanguages = useCallback(() => {
    return SUPPORTED_LANGUAGES.map((lang) => ({
      ...lang,
      isRTL: isRTLLanguage(lang.code),
      direction: getLanguageDirection(lang.code),
      isCurrent: lang.code === currentLanguage,
    }));
  }, [currentLanguage]);

  /**
   * Get stored language preference
   */
  const getStoredLanguage = useCallback(() => {
    return localStorage.getItem('i18nextLng') || 'en';
  }, []);

  /**
   * Save language preference
   */
  const saveLanguagePreference = useCallback((langCode) => {
    localStorage.setItem('i18nextLng', langCode);
  }, []);

  /**
   * Detect user's browser language
   */
  const detectBrowserLanguage = useCallback(() => {
    const browserLang = navigator.language || navigator.userLanguage;
    const baseLang = browserLang.split('-')[0];
    return SUPPORTED_LANGUAGES.some((l) => l.code === baseLang) ? baseLang : 'en';
  }, []);

  // Update localStorage when language changes
  useEffect(() => {
    saveLanguagePreference(currentLanguage);
  }, [currentLanguage, saveLanguagePreference]);

  const value = {
    currentLanguage,
    isRTL,
    direction,
    changeLanguage,
    getLanguageInfo,
    getSupportedLanguages,
    getStoredLanguage,
    saveLanguagePreference,
    detectBrowserLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

/**
 * Hook to use language context
 */
export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export default LanguageContext;
