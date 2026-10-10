import { Networks } from '@stellar/stellar-sdk';

/**
 * Network-mismatch helpers (Issue #714).
 *
 * The app is configured through `VITE_NETWORK_PASSPHRASE`; Freighter exposes the
 * network it is actually pointed at. These helpers normalise both representations
 * (passphrase strings, "TESTNET"/"MAINNET" labels, or Freighter API objects) into
 * a canonical `testnet` | `mainnet` value so the two can be compared reliably.
 */

export const EXPECTED_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

/**
 * Strip surrounding quotes/whitespace and collapse a network representation to
 * a canonical value.
 * @param {unknown} value passphrase, network label, or Freighter network object
 * @returns {'mainnet'|'testnet'|''|string}
 */
export function normalizeNetwork(value) {
  let raw = value;
  if (raw && typeof raw === 'object') {
    raw = raw.networkPassphrase || raw.network || raw.passphrase || '';
  }
  if (raw === null || raw === undefined) return '';
  const v = String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!v) return '';
  if (v.includes('public') || v.includes('mainnet')) return 'mainnet';
  if (v.includes('test') || v.includes('testnet') || v.includes('sdf')) return 'testnet';
  return v;
}

/**
 * True when the wallet network matches the configured app network.
 * An unknown wallet network is treated as a match so we never block blindly.
 * @param {unknown} walletNetwork value returned by Freighter's `getNetwork()`
 * @param {string} expectedPassphrase configured passphrase (defaults to env)
 * @returns {boolean}
 */
export function networksMatch(walletNetwork, expectedPassphrase = EXPECTED_PASSPHRASE) {
  const wallet = normalizeNetwork(walletNetwork);
  if (!wallet) return true;
  const expected = normalizeNetwork(expectedPassphrase);
  if (!expected) return true;
  return wallet === expected;
}

/**
 * Human-readable label for the configured network, used in the banner copy.
 * @param {string} passphrase configured passphrase (defaults to env)
 * @returns {'Mainnet'|'Testnet'}
 */
export function networkLabel(passphrase = EXPECTED_PASSPHRASE) {
  return normalizeNetwork(passphrase) === 'mainnet' ? 'Mainnet' : 'Testnet';
}

/**
 * Label for whatever Freighter reported, for display in the banner.
 * @param {unknown} value Freighter network value
 * @returns {string}
 */
export function walletNetworkLabel(value) {
  const n = normalizeNetwork(value);
  if (n === 'mainnet') return 'Mainnet';
  if (n === 'testnet') return 'Testnet';
  if (!n) return 'an unknown network';
  return String(value);
}
