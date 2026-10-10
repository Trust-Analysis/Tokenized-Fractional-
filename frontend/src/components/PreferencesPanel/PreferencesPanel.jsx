import React, { useEffect, useState } from 'react';
import Button from '../Button/Button';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import {
  DEFAULT_PREFERENCES,
  SUPPORTED_CURRENCIES,
  formatCurrencyAmount,
  mergePreferences,
} from '../../utils/preferences';
import styles from './PreferencesPanel.module.css';

/**
 * PreferencesPanel (Issue #793)
 *
 * A small settings dialog where the user can adjust their display/notification
 * preferences and save them. Values are edited as a local draft and only
 * committed to the persisted store on Save, so cancelling is side-effect free.
 *
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {function} props.onClose
 */
export default function PreferencesPanel({ open, onClose }) {
  const persisted = usePreferencesStore((state) => state);
  const savePreferences = usePreferencesStore((state) => state.savePreferences);
  const resetPreferences = usePreferencesStore((state) => state.resetPreferences);

  const [draft, setDraft] = useState(() => mergePreferences(persisted));
  const [saved, setSaved] = useState(false);

  // Re-seed the draft from the store each time the panel opens.
  useEffect(() => {
    if (open) {
      setDraft(mergePreferences(usePreferencesStore.getState()));
      setSaved(false);
    }
  }, [open]);

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const update = (key, value) =>
    setDraft((current) => mergePreferences({ ...current, [key]: value }));

  const handleSave = () => {
    savePreferences(draft);
    setSaved(true);
  };

  const handleReset = () => {
    resetPreferences();
    setDraft({ ...DEFAULT_PREFERENCES });
    setSaved(false);
  };

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-title"
      data-testid="preferences-panel"
      onClick={handleOverlayClick}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 id="preferences-title" className={styles.title}>
            Preferences
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close preferences"
          >
            ×
          </button>
        </div>

        <p className={styles.intro}>
          These settings are stored in your browser and applied on every visit.
        </p>

        <label className={styles.field} htmlFor="preferences-currency">
          <span className={styles.fieldLabel}>Display currency</span>
          <select
            id="preferences-currency"
            className={styles.select}
            value={draft.displayCurrency}
            onChange={(event) => update('displayCurrency', event.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Notifications</legend>
          <label className={styles.checkbox} htmlFor="preferences-price-change">
            <input
              id="preferences-price-change"
              type="checkbox"
              checked={draft.priceChangeNotifications}
              onChange={(event) => update('priceChangeNotifications', event.target.checked)}
            />
            <span>Notify me when the price of a held asset changes</span>
          </label>
          <label className={styles.checkbox} htmlFor="preferences-sold-out">
            <input
              id="preferences-sold-out"
              type="checkbox"
              checked={draft.soldOutNotifications}
              onChange={(event) => update('soldOutNotifications', event.target.checked)}
            />
            <span>Notify me when an asset sells out</span>
          </label>
        </fieldset>

        <label className={styles.checkbox} htmlFor="preferences-compact">
          <input
            id="preferences-compact"
            type="checkbox"
            checked={draft.compactNumbers}
            onChange={(event) => update('compactNumbers', event.target.checked)}
          />
          <span>Use compact number formatting for large amounts</span>
        </label>

        <p className={styles.preview} data-testid="preferences-preview">
          Example price: <strong>{formatCurrencyAmount(1250, draft.displayCurrency)}</strong>
        </p>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleReset} type="button">
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={handleSave} type="button">
            {saved ? 'Saved' : 'Save preferences'}
          </Button>
        </div>

        {saved && (
          <p className={styles.saved} role="status">
            Preferences saved.
          </p>
        )}
      </div>
    </div>
  );
}
