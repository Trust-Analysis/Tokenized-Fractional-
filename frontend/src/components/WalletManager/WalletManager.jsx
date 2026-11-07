/**
 * WalletManager.jsx
 *
 * Unified multi-wallet connection panel for the Stellar RWA Marketplace.
 *
 * Exported components:
 *   - WalletManager          – main modal/panel  (props: isOpen, onClose)
 *   - TransactionConfirmModal – tx confirmation overlay (props: tx, onConfirm, onCancel)
 */

import React, { useEffect, useCallback, useRef, useState } from "react";
import { useWalletStore, WALLET_PROVIDERS } from "../../store/useWalletStore";
import { toQRImageUrl } from "../../services/walletConnectService";
import styles from "./WalletManager.module.css";

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const ShieldIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z"
      fill="currentColor"
      opacity="0.9"
    />
    <path
      d="M10 13.17l-2.59-2.58L6 12l4 4 8-8-1.41-1.42L10 13.17z"
      fill="white"
    />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M18 6L6 18M6 6l12 12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/** Freighter official brand colours */
const FreighterLogo = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="Freighter logo"
    role="img"
  >
    <rect width="64" height="64" rx="12" fill="#4f46e5" />
    <path
      d="M12 44 L32 12 L52 44 L42 44 L32 28 L22 44 Z"
      fill="white"
      opacity="0.95"
    />
    <path d="M20 44 L32 24 L44 44 H36 L32 36 L28 44 Z" fill="#a5b4fc" />
  </svg>
);

/** Lobstr placeholder logo */
const LobstrLogo = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="Lobstr logo"
    role="img"
  >
    <rect width="64" height="64" rx="12" fill="#1a3c6e" />
    <circle cx="32" cy="32" r="16" fill="none" stroke="#4fc3f7" strokeWidth="3" />
    <path
      d="M22 32 Q27 22 32 32 Q37 42 42 32"
      stroke="#4fc3f7"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />
    <circle cx="32" cy="32" r="4" fill="#4fc3f7" />
  </svg>
);

/** xBull placeholder logo */
const XBullLogo = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="xBull logo"
    role="img"
  >
    <rect width="64" height="64" rx="12" fill="#0d1f3c" />
    <path
      d="M16 16 L32 32 L16 48"
      stroke="#f59e0b"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M32 16 L48 32 L32 48"
      stroke="#f59e0b"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity="0.5"
    />
    <circle cx="32" cy="32" r="5" fill="#f59e0b" />
  </svg>
);

/** Albedo placeholder logo */
const AlbedoLogo = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="Albedo logo"
    role="img"
  >
    <rect width="64" height="64" rx="12" fill="#0f172a" />
    <circle cx="32" cy="32" r="18" fill="none" stroke="#38bdf8" strokeWidth="2" />
    <circle cx="32" cy="32" r="10" fill="none" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
    <circle cx="32" cy="32" r="4" fill="#38bdf8" />
    <line x1="32" y1="14" x2="32" y2="10" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
    <line x1="32" y1="54" x2="32" y2="50" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
    <line x1="14" y1="32" x2="10" y2="32" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
    <line x1="54" y1="32" x2="50" y2="32" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** WalletConnect placeholder logo */
const WalletConnectLogo = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 64 64"
    fill="none"
    aria-label="WalletConnect logo"
    role="img"
  >
    <rect width="64" height="64" rx="14" fill="#3396FF" />
    <circle cx="22" cy="28" r="6" fill="white" opacity="0.95" />
    <circle cx="42" cy="36" r="6" fill="white" opacity="0.55" />
    <circle cx="22" cy="44" r="6" fill="white" opacity="0.75" />
  </svg>
);

const WALLET_LOGOS = {
  freighter: FreighterLogo,
  lobstr: LobstrLogo,
  xbull: XBullLogo,
  albedo: AlbedoLogo,
  walletconnect: WalletConnectLogo,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Shorten a Stellar public key for display.
 * e.g. "GABCD...WXYZ"
 */
function truncateKey(key, head = 6, tail = 4) {
  if (!key || key.length <= head + tail + 3) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

/**
 * Map wallet + store state to a connection status string.
 * @returns {'connected'|'connecting'|'error'|'disconnected'}
 */
function resolveStatus(providerId, { activeWallet, isConnecting, walletError, publicKey }) {
  if (activeWallet === providerId && publicKey) return "connected";
  if (activeWallet === providerId && isConnecting) return "connecting";
  if (activeWallet === providerId && walletError) return "error";
  return "disconnected";
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  return (
    <span
      className={`${styles.statusDot} ${styles[`dot_${status}`]}`}
      aria-label={`Status: ${status}`}
      role="img"
    />
  );
}

// ─── ProviderCard ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, walletState, onConnect, onDisconnect, onRetry }) {
  const { id, name, description, status: providerStatus } = provider;
  const Logo = WALLET_LOGOS[id] ?? (() => null);
  const isComingSoon = providerStatus === "coming_soon";

  const connectionStatus = isComingSoon
    ? "disconnected"
    : resolveStatus(id, walletState);

  const { activeWallet, isConnecting, walletError, publicKey } = walletState;
  const isThisWalletConnecting = activeWallet === id && isConnecting;
  const isThisWalletError = activeWallet === id && walletError && !publicKey;
  const isThisWalletConnected = activeWallet === id && Boolean(publicKey);

  return (
    <div
      className={`${styles.providerCard} ${isThisWalletConnected ? styles.providerCardActive : ""} ${isComingSoon ? styles.providerCardDisabled : ""}`}
      aria-disabled={isComingSoon}
    >
      <div className={styles.providerCardLeft}>
        <div className={styles.providerLogo}>
          <Logo />
        </div>
        <div className={styles.providerInfo}>
          <div className={styles.providerNameRow}>
            <span className={styles.providerName}>{name}</span>
            {isComingSoon ? (
              <span className={styles.badgeComingSoon}>Coming Soon</span>
            ) : isThisWalletConnected ? (
              <span className={styles.badgeConnected}>Connected</span>
            ) : (
              <span className={styles.badgeAvailable}>Available</span>
            )}
          </div>
          <p className={styles.providerDesc}>{description}</p>
          {isThisWalletConnected && publicKey && (
            <p className={styles.publicKeyDisplay} title={publicKey}>
              {truncateKey(publicKey)}
            </p>
          )}
          {isThisWalletError && (
            <p className={styles.errorText}>{walletState.walletError}</p>
          )}
        </div>
      </div>

      <div className={styles.providerCardRight}>
        <StatusDot status={connectionStatus} />

        {!isComingSoon && (
          <div className={styles.actionButtons}>
            {isThisWalletConnected ? (
              <button
                className={styles.btnDisconnect}
                onClick={onDisconnect}
                type="button"
              >
                Disconnect
              </button>
            ) : isThisWalletConnecting ? (
              <button className={styles.btnConnecting} disabled type="button">
                <span className={styles.spinnerInline} aria-hidden="true" />
                Connecting…
              </button>
            ) : isThisWalletError ? (
              <button
                className={styles.btnRetry}
                onClick={onRetry}
                type="button"
              >
                Retry
              </button>
            ) : (
              <button
                className={styles.btnConnect}
                onClick={onConnect}
                type="button"
              >
                Connect
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TransactionConfirmModal ──────────────────────────────────────────────────

/**
 * Overlay that prompts the user to confirm or cancel a transaction.
 *
 * @param {{ tx: object|string, onConfirm: () => void, onCancel: () => void }} props
 *
 * `tx` can be:
 *   - a plain string (XDR envelope or memo)
 *   - an object with arbitrary key/value pairs to display in a table
 */
export function TransactionConfirmModal({ tx, onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  // Trap focus inside modal
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const txEntries = (() => {
    if (!tx) return [];
    if (typeof tx === "string") return [{ key: "Transaction XDR", value: tx }];
    return Object.entries(tx).map(([key, value]) => ({
      key,
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    }));
  })();

  return (
    <div
      className={styles.txOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className={styles.txCard} ref={confirmRef} tabIndex={-1}>
        <div className={styles.txHeader}>
          <h3 id="tx-confirm-title" className={styles.txTitle}>
            Confirm Transaction
          </h3>
          <button
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label="Cancel transaction"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <p className={styles.txSubtitle}>
          Review the details below before signing with your wallet.
        </p>

        {txEntries.length > 0 ? (
          <div className={styles.txTableWrapper}>
            <table className={styles.txTable}>
              <tbody>
                {txEntries.map(({ key, value }) => (
                  <tr key={key}>
                    <th scope="row" className={styles.txTh}>
                      {key}
                    </th>
                    <td className={styles.txTd}>
                      <span
                        className={styles.txValue}
                        title={value}
                      >
                        {value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.txEmpty}>No transaction details available.</p>
        )}

        <div className={styles.txActions}>
          <button
            className={styles.btnTxCancel}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.btnTxConfirm}
            onClick={onConfirm}
            type="button"
          >
            Sign &amp; Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WalletConnectModal (Issue #568) ─────────────────────────────────────────

/**
 * Modal rendered inside WalletManager that shows the WalletConnect QR code and
 * waits for the mobile / hardware wallet to approve the pairing session.
 *
 * @param {{ uri: string, error?: string|null, onClose: () => void }} props
 */
function WalletConnectModal({ uri, error, onClose }) {
  const escRef = useRef(null);

  useEffect(() => {
    escRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const imageUrl = uri ? toQRImageUrl(uri) : null;

  return (
    <div
      className={styles.wcOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="walletconnect-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.wcCard} ref={escRef} tabIndex={-1}>
        <div className={styles.wcCardHeader}>
          <h3 id="walletconnect-title" className={styles.wcCardTitle}>
            Connect with WalletConnect
          </h3>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close WalletConnect modal"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <p className={styles.wcSubtitle}>
          Scan this code with your mobile or hardware wallet (Lobstr, xBull, and
          more) to connect.
        </p>

        {error ? (
          <div className={styles.wcError} role="alert">
            {error}
          </div>
        ) : imageUrl ? (
          <div className={styles.wcCode}>
            <img src={imageUrl} alt="WalletConnect pairing QR code" width="220" height="220" />
          </div>
        ) : (
          <div className={styles.wcLoading}>
            <span className={styles.spinnerInline} aria-hidden="true" />
            Generating pairing code…
          </div>
        )}

        {uri && (
          <button
            className={styles.wcCopyUriBtn}
            type="button"
            onClick={() => navigator.clipboard?.writeText(uri)}
          >
            Copy connection link
          </button>
        )}

        <p className={styles.wcHint}>
          Waiting for approval… This window stays open until your wallet confirms
          the connection.
        </p>
      </div>
    </div>
  );
}

/**
 * Clear the in-memory pairing URI cache after a session is dismissed.
 */
function clearPairingUriLocal() {
  Promise.resolve()
    .then(() => import("../../services/walletConnectService.js"))
    .then(({ clearPairingUri }) => clearPairingUri())
    .catch(() => {});
}

// ─── WalletManager (main export) ──────────────────────────────────────────────

/**
 * Slide-in / modal wallet manager panel.
 *
 * @param {{ isOpen: boolean, onClose: () => void }} props
 */
export function WalletManager({ isOpen, onClose }) {
  const {
    publicKey,
    isConnecting,
    walletError,
    shares,
    activeWallet,
    availableWallets,
    connectionHistory,
    reconnectAttempts,
    connect,
    disconnect,
    clearWalletError,
    connectByWalletConnect,
    finishWalletConnectSession,
  } = useWalletStore();

  const panelRef = useRef(null);
  const [wcOpen, setWcOpen] = useState(false);
  const [wcUri, setWcUri] = useState(null);
  const [wcError, setWcError] = useState(null);

  // ── Keyboard handling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // ── Focus trap: move focus into panel when it opens ────────────────────────
  useEffect(() => {
    if (isOpen) {
      // Defer one frame so CSS transition doesn't fight with focus
      const id = requestAnimationFrame(() => panelRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // ── Scroll lock ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // ── WalletConnect session polling (Issue #568) ──────────────────────────────
  useEffect(() => {
    if (!wcOpen || !publicKey) return;
    // Once a wallet has approved and produced a public key, the modal is done.
    setWcOpen(false);
    setWcUri(null);
  }, [wcOpen, publicKey]);

  useEffect(() => {
    if (!wcOpen) return;
    const timer = setInterval(async () => {
      const pubKey = await finishWalletConnectSession();
      if (pubKey) {
        setWcOpen(false);
        setWcUri(null);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [wcOpen, finishWalletConnectSession]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleConnect = useCallback(
    async (providerId) => {
      if (providerId === "freighter") {
        await connect();
        return;
      }
      if (providerId === "walletconnect") {
        setWcError(null);
        setWcOpen(true);
        const uri = await connectByWalletConnect();
        if (uri) {
          setWcUri(uri);
        } else {
          setWcError(
            "Could not start WalletConnect. Make sure VITE_WALLETCONNECT_PROJECT_ID is configured.",
          );
          setWcOpen(false);
        }
      }
      // Future providers would be handled here
    },
    [connect, connectByWalletConnect],
  );

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const handleRetry = useCallback(
    async (providerId) => {
      clearWalletError();
      await handleConnect(providerId);
    },
    [clearWalletError, handleConnect],
  );

  const handleOverlayClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  const walletState = {
    publicKey,
    isConnecting,
    walletError,
    activeWallet,
  };

  const recentConnections = connectionHistory.slice(0, 3);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-manager-title"
      onClick={handleOverlayClick}
    >
      <div
        className={styles.panel}
        ref={panelRef}
        tabIndex={-1}
        role="document"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className={styles.panelHeader}>
          <h2 id="wallet-manager-title" className={styles.panelTitle}>
            Connect Wallet
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close wallet manager"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        {/* ── Phishing warning banner ───────────────────────────────────── */}
        <div className={styles.phishingBanner} role="alert">
          <span className={styles.phishingIcon}>
            <ShieldIcon />
          </span>
          <p className={styles.phishingText}>
            Always verify you are on the correct domain before connecting your
            wallet.
          </p>
        </div>

        {/* ── Reconnect attempt notice ──────────────────────────────────── */}
        {reconnectAttempts > 0 && !publicKey && (
          <div className={styles.reconnectNotice}>
            <span>
              Connection attempt {reconnectAttempts} failed. Check your wallet
              extension and try again.
            </span>
          </div>
        )}

        {/* ── Provider list ─────────────────────────────────────────────── */}
        <div className={styles.providerList}>
          {availableWallets.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              walletState={walletState}
              onConnect={() => handleConnect(provider.id)}
              onDisconnect={handleDisconnect}
              onRetry={() => handleRetry(provider.id)}
            />
          ))}
        </div>

        {/* ── Connection history ────────────────────────────────────────── */}
        {recentConnections.length > 0 && (
          <div className={styles.historySection}>
            <h3 className={styles.historyTitle}>Recent Connections</h3>
            <ul className={styles.historyList}>
              {recentConnections.map((entry, i) => (
                <li key={`${entry.timestamp}-${i}`} className={styles.historyItem}>
                  <span className={styles.historyWallet}>{entry.wallet}</span>
                  <span className={styles.historyKey} title={entry.publicKey}>
                    {truncateKey(entry.publicKey)}
                  </span>
                  <span className={styles.historyTime}>
                    {new Date(entry.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Active wallet summary footer ──────────────────────────────── */}
        {publicKey && (
          <div className={styles.connectedFooter}>
            <div className={styles.connectedInfo}>
              <StatusDot status="connected" />
              <span className={styles.connectedLabel}>Connected:</span>
              <code className={styles.connectedKey} title={publicKey}>
                {truncateKey(publicKey)}
              </code>
              {typeof shares === "number" && shares > 0 && (
                <span className={styles.sharesChip}>
                  {shares} share{shares !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <button
              className={styles.btnDisconnect}
              onClick={handleDisconnect}
              type="button"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* ── Help link ─────────────────────────────────────────────────── */}
        <p className={styles.helpText}>
          New to Stellar wallets?{" "}
          <a
            href="https://www.stellar.org/learn/wallets"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.helpLink}
          >
            Learn more
          </a>
        </p>
      </div>

      {/* ── WalletConnect QR modal overlay (Issue #568) ─────────────────── */}
      {wcOpen && (
        <WalletConnectModal
          uri={wcUri}
          error={wcError}
          onClose={() => {
            setWcOpen(false);
            setWcUri(null);
            clearPairingUriLocal();
          }}
        />
      )}
    </div>
  );
}

export default WalletManager;
