import React, { useEffect, useRef, useState } from 'react';
import Button from '../Button/Button';
import { copyTextToClipboard, truncateAddress } from '../../utils/walletAddress';
import styles from './WalletAddressBadge.module.css';

/**
 * WalletAddressBadge (Issue #791)
 *
 * A persistent header affordance that makes it obvious which Freighter address
 * is currently connected, with one-click copy of the full address and a
 * Disconnect action alongside it.
 *
 * @param {object}   props
 * @param {string}   props.publicKey        connected wallet address
 * @param {function} [props.onManage]       open the wallet manager (optional)
 * @param {function} props.onDisconnect     disconnect handler
 * @param {string}   [props.disconnectLabel] translated label for the button
 */
export default function WalletAddressBadge({
  publicKey,
  onManage,
  onDisconnect,
  disconnectLabel = 'Disconnect',
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  if (!publicKey) return null;

  const shortAddress = truncateAddress(publicKey);

  const handleCopy = async () => {
    const succeeded = await copyTextToClipboard(publicKey);
    if (!succeeded) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const addressTitle = `${publicKey} — click to manage wallet`;

  return (
    <div className={styles.badge} data-testid="wallet-address-badge">
      <button
        type="button"
        className={styles.address}
        title={addressTitle}
        onClick={onManage}
        aria-label={`Connected wallet ${publicKey}. Manage wallet connection`}
      >
        <span className={styles.dot} aria-hidden="true" />
        <code className={styles.addressText}>{shortAddress}</code>
      </button>

      <button
        type="button"
        className={`${styles.copyButton} ${copied ? styles.copied : ''}`}
        onClick={handleCopy}
        data-testid="wallet-address-copy"
        title="Copy the full address to your clipboard"
        aria-label={
          copied ? 'Wallet address copied to clipboard' : `Copy wallet address ${publicKey}`
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>

      <Button onClick={onDisconnect} variant="danger">
        {disconnectLabel}
      </Button>
    </div>
  );
}
