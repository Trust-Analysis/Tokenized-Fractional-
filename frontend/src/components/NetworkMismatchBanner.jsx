import React from 'react';
import Button from '../Button/Button';
import { walletNetworkLabel } from '../utils/networkMismatch';

/**
 * NetworkMismatchBanner (Issue #714)
 *
 * Shown when Freighter is connected to a different network than the one this
 * app is configured for. Gives the user a clear, actionable instruction instead
 * of letting them submit a transaction that is doomed to fail.
 *
 * @param {object}   props
 * @param {boolean}  props.mismatch      whether a mismatch was detected
 * @param {string}   props.expected      label of the expected network, e.g. 'Testnet'
 * @param {unknown}  props.walletNetwork raw value reported by Freighter
 * @param {function} props.onRetry       re-check the wallet network
 */
export default function NetworkMismatchBanner({ mismatch, expected, walletNetwork, onRetry }) {
  if (!mismatch) return null;

  const actual = walletNetworkLabel(walletNetwork);

  return (
    <div
      role="alert"
      data-testid="network-mismatch-banner"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem',
        margin: '0.75rem 0',
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
        border: '1px solid var(--color-danger, #e5484d)',
        background: 'rgba(229, 72, 77, 0.12)',
        color: 'var(--color-text, #f5f5f5)',
        fontSize: '0.9rem',
      }}
    >
      <strong>Wrong network.</strong>
      <span>
        {`Freighter is connected to ${actual}, but this marketplace expects ${expected}. Open Freighter, switch it to ${expected}, then retry.`}
      </span>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
