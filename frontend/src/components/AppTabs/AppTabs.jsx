import React from 'react';
import styles from '../../App.module.css';

const tabs = [
  { id: 'marketplace', labelKey: 'nav.marketplace', activeViews: ['marketplace', 'asset-detail'] },
  { id: 'portfolio', labelKey: 'nav.portfolio', className: 'tour-portfolio' },
  { id: 'transactions', label: 'Transactions', requiresWallet: true },
  { id: 'admin', labelKey: 'nav.admin' },
  { id: 'history', label: 'History' },
  { id: 'profile', label: 'Profile' },
];

/**
 * Primary view switcher. Preferences is a panel, not a view, so it is rendered
 * separately.
 */
export default function AppTabs({
  view,
  publicKey,
  preferencesOpen,
  onChangeView,
  onOpenPreferences,
  t,
}) {
  return (
    <nav className={styles.tabs}>
      {tabs
        .filter((tab) => !tab.requiresWallet || publicKey)
        .map((tab) => {
          const isActive = tab.activeViews ? tab.activeViews.includes(view) : view === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${tab.className || ''}`}
              onClick={() => onChangeView(tab.id)}
            >
              {tab.labelKey ? t(tab.labelKey) : tab.label}
            </button>
          );
        })}
      <button
        type="button"
        className={`${styles.tab} ${preferencesOpen ? styles.tabActive : ''}`}
        onClick={onOpenPreferences}
      >
        Preferences
      </button>
    </nav>
  );
}
