import React from 'react';
import Badge from '../Badge/Badge';
import Button from '../Button/Button';
import styles from './Header.module.css';

/**
 * Header — top bar with title, network badge, theme toggle, and wallet actions.
 *
 * @param {string|null} publicKey       - Connected wallet public key
 * @param {boolean}     isConnecting     - Wallet connection in progress
 * @param {boolean}     isTestnet        - Whether on testnet
 * @param {string}      theme            - Current theme ('dark' | 'light')
 * @param {function}    onConnect        - Connect wallet handler
 * @param {function}    onDisconnect     - Disconnect wallet handler
 * @param {function}    onToggleTheme    - Toggle theme handler
 */
export default function Header({
  publicKey,
  isConnecting,
  isTestnet,
  theme,
  onConnect,
  onDisconnect,
  onToggleTheme,
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleArea}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>RWA Marketplace</h1>
          <Badge variant={isTestnet ? 'success' : 'danger'}>
            {isTestnet ? 'TESTNET' : 'MAINNET'}
          </Badge>
        </div>
      </div>
      <div className={styles.walletArea}>
        <button
          onClick={onToggleTheme}
          className={styles.themeToggle}
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          )}
        </button>

        {!publicKey ? (
          <Button onClick={onConnect} variant="success" loading={isConnecting}>
            {isConnecting ? 'Connecting…' : 'Connect Freighter'}
          </Button>
        ) : (
          <div className={styles.walletInfo}>
            <span className={styles.publicKey} title={publicKey}>
              {publicKey}
            </span>
            <Button onClick={onDisconnect} variant="danger">
              Disconnect
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
