import React from 'react';
import NetworkBadge from '../NetworkBadge/NetworkBadge';
import ConnectionStatusIndicator from '../ConnectionStatusIndicator/ConnectionStatusIndicator';
import LanguageSwitcher from '../LanguageSwitcher/LanguageSwitcher';
import WalletSelector from '../WalletSelector/WalletSelector';
import WalletAddressBadge from '../WalletAddressBadge/WalletAddressBadge';
import styles from '../../App.module.css';

/**
 * Marketplace header: identity, connection status, theme, language, and wallet.
 */
export default function AppHeader({
  publicKey,
  isConnecting,
  wsConnected,
  theme,
  onToggleTheme,
  onManageWallet,
  onDisconnect,
  onSelectProvider,
  disconnectLabel,
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleArea}>
        <div className={styles.titleRow}>
          <a
            href="https://github.com/Trust-Analysis/Tokenized-Fractional-"
            target="_blank"
            rel="noreferrer noopener"
            className={styles.repoAvatarLink}
            title="View repository on GitHub"
          >
            <img
              src="https://github.com/Trust-Analysis.png"
              alt="Repo avatar"
              className={styles.repoAvatar}
            />
          </a>
          <h1 className={styles.title}>RWA Marketplace</h1>
          <NetworkBadge />
        </div>
      </div>

      <div className={`${styles.walletArea} tour-wallet-connect`}>
        <ConnectionStatusIndicator
          status={wsConnected ? 'connected' : 'disconnected'}
          showLabel={false}
        />
        <LanguageSwitcher />
        <button
          type="button"
          onClick={onToggleTheme}
          className={styles.themeToggle}
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        {!publicKey ? (
          <WalletSelector onConnect={onSelectProvider} connecting={isConnecting} />
        ) : (
          <WalletAddressBadge
            publicKey={publicKey}
            onManage={onManageWallet}
            onDisconnect={onDisconnect}
            disconnectLabel={disconnectLabel}
          />
        )}
      </div>
    </header>
  );
}
