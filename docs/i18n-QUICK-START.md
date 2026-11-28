# i18n Quick Start Guide

## 📦 What's Ready

- ✅ 4 languages: English, Spanish, French, German
- ✅ Automatic language detection and persistence
- ✅ Date, time, number, and currency formatting
- ✅ RTL (right-to-left) support for future languages
- ✅ Example component showing all features

## 🚀 5-Minute Setup

### 1. Import i18n (already done in main.jsx)
```javascript
import './i18n';
import { LanguageProvider } from './context/LanguageContext';
```

### 2. Use Translations in Components
```javascript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <h1>{t('marketplace.title')}</h1>;
}
```

### 3. Use Language Context
```javascript
import { useLanguage } from './context/LanguageContext';

function MyComponent() {
  const { currentLanguage, isRTL, changeLanguage } = useLanguage();
  return <div style={{ direction: isRTL ? 'rtl' : 'ltr' }}>...</div>;
}
```

### 4. Format Dates & Currency
```javascript
import { formatLocalDate, formatLocalCurrency } from './utils/i18nFormatters';
import { useLanguage } from './context/LanguageContext';

function MyComponent() {
  const { currentLanguage } = useLanguage();
  
  return (
    <>
      <span>{formatLocalDate(new Date(), currentLanguage)}</span>
      <span>{formatLocalCurrency(99.99, 'USD', currentLanguage)}</span>
    </>
  );
}
```

## 📍 Key Files

| File | Purpose |
|------|---------|
| `frontend/src/i18n.js` | i18next configuration |
| `frontend/src/context/LanguageContext.jsx` | Language state & utilities |
| `frontend/src/utils/i18nFormatters.js` | Date/number formatters |
| `frontend/src/locales/*.json` | Translation files (en, es, fr, de) |
| `frontend/src/styles/theme.css` | RTL styling |
| `frontend/src/components/LanguageSwitcher/` | Language switcher component |
| `frontend/src/components/I18nExample/` | Example component |

## 🔑 Translation Keys

```json
{
  "nav": {},           // Navigation labels
  "wallet": {},        // Wallet actions
  "marketplace": {},   // Marketplace text
  "portfolio": {},     // Portfolio page
  "history": {},       // Transaction history
  "theme": {},         // Theme switcher
  "common": {}         // Common UI text
}
```

## 📝 Common Tasks

### Add a translation key
1. Add to all locale files: `en.json`, `es.json`, `fr.json`, `de.json`
2. Use in component: `const { t } = useTranslation(); t('key')`

### Format a date
```javascript
import { formatLocalDate } from './utils/i18nFormatters';

formatLocalDate('2024-08-26', currentLanguage);
// en: "Monday, August 26, 2024"
// es: "lunes, 26 de agosto de 2024"
```

### Format currency
```javascript
import { formatLocalCurrency } from './utils/i18nFormatters';

formatLocalCurrency(1234.56, 'USD', currentLanguage);
// en: "$1,234.56"
// es: "1.234,56 USD"
// fr: "1 234,56 USD"
// de: "1.234,56 USD"
```

### Check RTL status
```javascript
import { useLanguage } from './context/LanguageContext';

const { isRTL } = useLanguage();
// isRTL = true if Arabic/Hebrew/Persian/Urdu
```

### Format a number
```javascript
import { formatLocalNumber } from './utils/i18nFormatters';

formatLocalNumber(1234567.89, currentLanguage);
// en: "1,234,567.89"
// es: "1.234.567,89"
// fr: "1 234 567,89"
// de: "1.234.567,89"
```

## 🌍 Adding a New Language (e.g., Arabic)

### 1. Create `frontend/src/locales/ar.json`
Copy structure from `en.json` and translate all values.

### 2. Update `frontend/src/i18n.js`
```javascript
import ar from './locales/ar.json';

export const SUPPORTED_LANGUAGES = [
  // ... existing
  { code: 'ar', label: 'العربية', name: 'Arabic' },
];

i18n.init({
  resources: {
    // ... existing
    ar: { translation: ar },
  },
});
```

That's it! RTL support is already built in.

## 🎨 Formatting Options

### Dates
- `formatLocalDate(date, lang)` - Full date-time
- `formatLocalDateShort(date, lang)` - Short date
- `formatLocalDateLong(date, lang)` - Long date
- `formatLocalTime(date, lang)` - Time only
- `formatLocalDistance(date, lang)` - "2 hours ago"

### Numbers
- `formatLocalNumber(num, lang)` - Locale numbers
- `formatLocalDecimal(num, lang, digits)` - Decimal format
- `formatLocalCurrency(amount, currency, lang)` - Currency
- `formatLocalPercentage(value, lang, digits)` - Percentage

## 📊 Current Languages

| Code | Name | Direction | Status |
|------|------|-----------|--------|
| en | English | LTR | ✅ |
| es | Spanish | LTR | ✅ |
| fr | French | LTR | ✅ |
| de | German | LTR | ✅ |
| ar | Arabic | RTL | 🚀 Ready |
| he | Hebrew | RTL | 🚀 Ready |
| fa | Persian | RTL | 🚀 Ready |
| ur | Urdu | RTL | 🚀 Ready |

## 🧪 Testing

```javascript
// Test component - shows all features
import I18nExample from './components/I18nExample/I18nExample';

function App() {
  return <I18nExample />;
}
```

## 📚 Full Documentation

- **`docs/i18n.md`** - Complete architecture & guide (431 lines)
- **`docs/i18n-IMPLEMENTATION.md`** - Implementation summary
- **`docs/i18n-QUICK-START.md`** - This file

## ❓ FAQ

**Q: How does the app detect my language?**
A: Uses browser language preference, falls back to English, saves to localStorage.

**Q: Can I force a language?**
A: Yes, call `changeLanguage('es')` from the LanguageContext.

**Q: Does RTL work automatically?**
A: Yes! Add an Arabic locale, and RTL styling applies automatically.

**Q: How do I translate dynamic values?**
A: Use i18next interpolation: `t('key', { name: 'John' })`

**Q: Can I use HTML in translations?**
A: Use `t` with `dangerouslySetInnerHTML` or use trans component from react-i18next.

**Q: Does it work with the backend?**
A: Yes! Send `Accept-Language` header with user's current language preference.

## 🚀 Next Steps

1. ✅ **Install dependencies**: `npm install` (already done)
2. ✅ **Build**: `npm run build` (successfully builds)
3. 📝 **Update components** to use `t()` for translations
4. 📝 **Add formatters** to date/number displays
5. 🧪 **Test all languages** and formatting
6. 🌍 **Add new languages** as needed
7. 📚 **Update docs** as you expand

---

**Ready to go global! 🌍**

For detailed information, see `docs/i18n.md`.
