import React, { memo } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import styles from './NetworkBadge.module.css';

/**
 * Canonical Stellar network passphrases.
 *
 * Kept as literals (in addition to the values exported by
 * `@stellar/stellar-sdk`) so the badge keeps working even if the SDK ever
 * renames or stops re-exporting the `Networks` entries.
 */
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const NETWORK_CONFIG = {
  mainnet: {
    id: 'mainnet',
    label: 'MAINNET',
    description: 'Connected to Stellar Mainnet — real funds at risk',
  },
  testnet: {
    id: 'testnet',
    label: 'TESTNET',
    description: 'Connected to Stellar Testnet — safe for testing only',
  },
  unknown: {
    id: 'unknown',
    label: 'UNKNOWN NETWORK',
    description:
      'Stellar network could not be determined from VITE_NETWORK_PASSPHRASE — verify your environment configuration',
  },
};

const MAINNET_VALUES = [MAINNET_PASSPHRASE, Networks?.PUBLIC].filter(Boolean);
const TESTNET_VALUES = [TESTNET_PASSPHRASE, Networks?.TESTNET].filter(Boolean);

/**
 * Derive the active Stellar network from a network passphrase.
 *
 * Unknown or missing values resolve to an explicit `unknown` state rather
 * than silently defaulting to testnet/mainnet, so a misconfigured deploy can
 * never masquerade as the wrong network.
 *
 * @param   {string|undefined} passphrase - Value of `VITE_NETWORK_PASSPHRASE`
 * @returns {{ id: 'mainnet'|'testnet'|'unknown', label: string, description: string }}
 */
export function resolveNetwork(passphrase) {
  const value = typeof passphrase === 'string' ? passphrase.trim() : '';

  if (MAINNET_VALUES.includes(value)) return NETWORK_CONFIG.mainnet;
  if (TESTNET_VALUES.includes(value)) return NETWORK_CONFIG.testnet;
  return NETWORK_CONFIG.unknown;
}

function TestnetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3 2.5 20h19L12 3z" />
      <line x1="12" y1="9.5" x2="12" y2="14.5" />
      <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MainnetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5 4.5 5.5v6c0 4.4 3.1 8.5 7.5 9.9 4.4-1.4 7.5-5.5 7.5-9.9v-6L12 2.5z" />
      <path d="m8.6 11.8 2.3 2.3 4.5-4.5" />
    </svg>
  );
}

function UnknownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.4 2.4 0 1 1 3.3 2.2c-.7.3-.9.8-.9 1.6" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

const NETWORK_ICONS = {
  mainnet: MainnetIcon,
  testnet: TestnetIcon,
  unknown: UnknownIcon,
};

const ENV_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE;

/**
 * NetworkBadge — persistent indicator of the Stellar network the app is
 * configured for, derived from `VITE_NETWORK_PASSPHRASE`.
 *
 * Testnet renders as a loud amber warning; mainnet renders as a neutral cyan
 * "production" badge; an
 * unrecognised/missing passphrase renders as a neutral dashed "unknown"
 * badge. Intended to live in the app header so it is visible on every route.
 *
 * @param {string} [passphrase] - Override for `VITE_NETWORK_PASSPHRASE`
 *                                (primarily useful for tests/stories).
 * @param {string} [className]  - Additional CSS classes.
 */
function NetworkBadge({ passphrase = ENV_PASSPHRASE, className = '' }) {
  const network = resolveNetwork(passphrase);
  const Icon = NETWORK_ICONS[network.id];

  return (
    <span
      className={`${styles.badge} ${styles[network.id]}${className ? ` ${className}` : ''}`}
      data-network={network.id}
      role="status"
      aria-live="polite"
      aria-label={network.description}
      title={network.description}
    >
      <Icon />
      <span className={styles.label}>{network.label}</span>
    </span>
  );
}

export default memo(NetworkBadge);
