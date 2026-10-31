// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * WalletConnectService — Extended wallet support via WalletConnect (Issue #568).
 *
 * Initialises the WalletConnect Web3Wallet client once, exposes the home page
 * used to display a QR code for mobile / hardware wallets, and resolves the
 * connected Stellar public key from the approved session.
 *
 * Configuration (env):
 *   VITE_WALLETCONNECT_PROJECT_ID   — WalletConnect Cloud project id (required)
 *   VITE_WALLETCONNECT_RELAY_URL    — optional custom relay (defaults to public)
 */

import { Web3Wallet } from '@walletconnect/web3wallet';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';

const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
const RELAY_URL =
  import.meta.env.VITE_WALLETCONNECT_RELAY_URL || 'wss://relay.walletconnect.com';

const STELLAR_METHODS = ['stellar_signXDR', 'stellar_signTransaction'];

let client = null;
let initPromise = null;
let currentPairingUri = null;
let sessionProposalListener = null;
let sessionDeleteListener = null;

/**
 * Build the dApp metadata advertised to WalletConnect.
 */
function buildMetadata() {
  return {
    name: 'Tokenized Fractional RWA Marketplace',
    description:
      'A full-stack decentralized marketplace for real-world assets on Stellar.',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://rwa-marketplace.com',
    icons: ['https://rwa-marketplace.com/icon.png'],
  };
}

/**
 * Lazily initialise (and memoise) the WalletConnect client.
 * Resolves to `null` when no project id is configured so the UI can degrade
 * gracefully instead of throwing.
 */
export async function initWalletConnect() {
  if (typeof window === 'undefined') return null;
  if (!PROJECT_ID) {
    console.warn('[WalletConnect] VITE_WALLETCONNECT_PROJECT_ID is not set. Disabled.');
    return null;
  }
  if (client) return client;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const created = await Web3Wallet.init({
      projectId: PROJECT_ID,
      relayUrl: RELAY_URL,
      metadata: buildMetadata(),
    });
    attachDefaultListeners(created);
    client = created;
    return created;
  })();

  return initPromise;
}

/**
 * Install session lifecycle listeners used by the UI.
 * May be called multiple times safely.
 */
function attachDefaultListeners(wallet) {
  if (sessionProposalListener) {
    wallet.off('session_proposal', sessionProposalListener);
  }
  if (sessionDeleteListener) {
    wallet.off('session_delete', sessionDeleteListener);
  }

  sessionProposalListener = async (proposal) => {
    try {
      const namespaces = buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces: {
          stellar: {
            chains: ['stellar:soroban:testnet', 'stellar:soroban:mainnet'],
            methods: STELLAR_METHODS,
            events: ['accountsChanged'],
          },
        },
      });
      await wallet.approveSession({
        id: proposal.id,
        namespaces,
      });
    } catch (err) {
      try {
        await wallet.rejectSession({
          id: proposal.id,
          reason: getSdkError('USER_REJECTED_METHODS'),
        });
      } catch {
        /* ignore */
      }
      console.error('[WalletConnect] Failed to approve session:', err);
    }
  };

  sessionDeleteListener = () => {
    // Sessions are validated on read; nothing persistent to do here.
  };

  wallet.on('session_proposal', sessionProposalListener);
  wallet.on('session_delete', sessionDeleteListener);
}

/**
 * Begin a WalletConnect pairing and return the URI the wallet can scan.
 * Returns `null` when the client is not available.
 */
export async function beginWalletConnectPairing() {
  const wallet = await initWalletConnect();
  if (!wallet) return null;

  const { uri } = await wallet.core.pairing.create({});
  currentPairingUri = uri;
  return uri;
}

/**
 * Retrieve the Stellar public key from any currently active WalletConnect
 * session. Resolves to `null` when none is connected.
 */
export async function getWalletConnectPublicKey() {
  const wallet = await initWalletConnect();
  if (!wallet) return null;

  const sessions = typeof wallet.getActiveSessions === 'function'
    ? Object.values(wallet.getActiveSessions())
    : [];

  for (const session of sessions || []) {
    const accounts = session?.namespaces?.stellar?.accounts || [];
    for (const account of accounts) {
      // Stellar WalletConnect accounts are namespaced like "stellar:soroban:testnet:GABCD...".
      const parts = String(account).split(':');
      const address = parts[parts.length - 1];
      if (address && /^[G][A-Z2-7]{55}$/.test(address)) return address;
    }
  }
  return null;
}

/**
 * Get the last pairing URI (e.g. for re-rendering the QR code).
 */
export function getCurrentPairingUri() {
  return currentPairingUri;
}

/**
 * Reset the in-memory pairing URI cache.
 */
export function clearPairingUri() {
  currentPairingUri = null;
}

/**
 * Disconnect all WalletConnect sessions for the given public key (if any).
 */
export async function disconnectWalletConnect() {
  const wallet = await initWalletConnect();
  if (!wallet) return;
  const sessions = typeof wallet.getActiveSessions === 'function'
    ? Object.values(wallet.getActiveSessions())
    : [];
  await Promise.allSettled(
    (sessions || []).map(async (session) => {
      if (session?.topic) {
        await wallet.disconnectSession({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') });
      }
    }),
  );
  clearPairingUri();
}

/**
 * Generate a WalletConnect QR-code-compatible image URL for a modal.
 * Used as a lightweight fallback so the modal can render the URI without a
 * heavy QR library.
 */
export function toQRImageUrl(uri) {
  const encoded = encodeURIComponent(uri || '');
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}`;
}

export const WalletConnectDefaultConfig = {
  projectId: PROJECT_ID,
  support: Boolean(PROJECT_ID),
};