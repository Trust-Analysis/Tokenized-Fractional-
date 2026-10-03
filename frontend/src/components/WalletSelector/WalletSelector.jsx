import React, { useState, useRef, useEffect } from 'react';
import { useWalletDiscovery } from '../../hooks/useWalletDiscovery';
import styles from './WalletSelector.module.css';

function WalletOption({ provider, onSelect, disabled }) {
  const handleClick = () => {
    if (!disabled) onSelect(provider);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled) onSelect(provider);
    }
  };

  return (
    <button
      type="button"
      className={styles.walletOption}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      role="option"
      aria-selected={false}
    >
      {provider.icon ? (
        <img src={provider.icon} alt="" className={styles.walletIcon} width="24" height="24" />
      ) : (
        <div className={styles.walletIconPlaceholder} aria-hidden="true" />
      )}
      <span className={styles.walletName}>{provider.name}</span>
    </button>
  );
}

export default function WalletSelector({ onConnect, connecting }) {
  const { providers, discovering, hasProviders } = useWalletDiscovery();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = async (provider) => {
    setOpen(false);
    if (onConnect) {
      onConnect(provider);
    }
  };

  if (discovering) {
    return (
      <button type="button" className={styles.triggerBtn} disabled>
        <span className={styles.loadingDots}>Discovering wallets...</span>
      </button>
    );
  }

  if (!hasProviders) {
    return (
      <div className={styles.noWallets}>
        <p className={styles.noWalletsText}>No wallet detected</p>
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.downloadLink}
        >
          Download Freighter Wallet
        </a>
      </div>
    );
  }

  if (providers.length === 1) {
    return (
      <button
        type="button"
        className={styles.triggerBtn}
        onClick={() => handleSelect(providers[0])}
        disabled={connecting}
      >
        {providers[0].icon && (
          <img src={providers[0].icon} alt="" className={styles.btnIcon} width="18" height="18" />
        )}
        {connecting ? 'Connecting...' : `Connect ${providers[0].name}`}
      </button>
    );
  }

  return (
    <div ref={ref} className={styles.wrapper}>
      <button
        type="button"
        className={styles.triggerBtn}
        onClick={() => setOpen(!open)}
        disabled={connecting}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {connecting ? 'Connecting...' : 'Connect Wallet'}
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className={styles.dropdown} role="listbox" aria-label="Select a wallet">
          {providers.map((provider) => (
            <WalletOption
              key={provider.uuid}
              provider={provider}
              onSelect={handleSelect}
              disabled={connecting}
            />
          ))}
        </div>
      )}
    </div>
  );
}
