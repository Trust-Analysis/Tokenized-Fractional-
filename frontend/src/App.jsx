import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Networks, nativeToScVal } from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';

import Header from './components/Header/Header';
import Navbar from './components/Navbar/Navbar';
import Card from './components/Card/Card';
import Alert from './components/Alert/Alert';
import Badge from './components/Badge/Badge';
import Button from './components/Button/Button';
import Skeleton from './components/Skeleton/Skeleton';
import AssetGrid from './components/AssetGrid/AssetGrid';
import BuyShares from './components/BuyShares/BuyShares';
import ToastContainer from './components/Toast/Toast';
import ConfirmPurchase from './components/ConfirmPurchase/ConfirmPurchase';
import LanguageSwitcher from './components/LanguageSwitcher/LanguageSwitcher';
import TransactionHistory from './components/TransactionHistory/TransactionHistory';
import ProfilePage from './components/ProfilePage/ProfilePage';
import styles from './App.module.css';
import Breadcrumbs from './components/Breadcrumbs/Breadcrumbs';
import PriceRangeFilter from './components/PriceRangeFilter/PriceRangeFilter';
import ConnectionStatusIndicator from './components/ConnectionStatusIndicator/ConnectionStatusIndicator';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { useTheme } from './context/ThemeContext';

import { useWalletStore } from './store/useWalletStore';
import useLiveUpdatesStore from './store/useLiveUpdatesStore';
import {
  TX_CONFIRMED,
  TX_FAILED,
  TX_SUBMITTED,
  TX_FAILED_CHECK_BALANCE,
  TX_FAILED_PAUSED,
  TX_FAILED_NO_SHARES,
  FAILED_FETCH_SHARE_BALANCE,
  MUST_BUY_AT_LEAST_ONE_SHARE,
  CONTRACT_NOT_CONFIGURED,
} from './constants/errors';
import { useAssetStore } from './store/useAssetStore';
import { useToastStore } from './store/useToastStore';
import { useSorobanRead, useSorobanWrite } from './hooks/useSoroban';
import useTransactionStatus from './hooks/useTransactionStatus';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { WS_EVENT_TYPES } from './hooks/useWebSocket';
import { useGraphQLSubscription } from './hooks/useGraphQLSubscription';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useWalletDiscovery } from './hooks/useWalletDiscovery';
import OfflineIndicator from './components/OfflineIndicator/OfflineIndicator';
import WalletSelector from './components/WalletSelector/WalletSelector';
import OnboardingTour from './components/OnboardingTour';
import { setQueryData, applySubscriptionDelta } from './services/queryCache';

// ── Route-based code splitting (Issue #304) ──────────────────────────────────
// Heavy view components are lazy-loaded to reduce initial bundle size.
// Each route gets its own chunk loaded on-demand with Suspense fallback.
const AdminPage = lazy(() => import('./components/AdminPage/AdminPage'));
const PortfolioPage = lazy(() => import('./components/PortfolioPage/PortfolioPage'));
const TransactionHistory = lazy(() => import('./components/TransactionHistory/TransactionHistory'));
const NewsSection = lazy(() => import('./components/NewsSection/NewsSection'));
const PriceAlert = lazy(() => import('./components/PriceAlert/PriceAlert'));
const AssetComparison = lazy(() => import('./components/AssetComparison/AssetComparison'));
const FavoritesPage = lazy(() => import('./components/FavoritesPage/FavoritesPage'));
const UserProfile = lazy(() => import('./components/UserProfile/UserProfile'));
const InvestmentCalculator = lazy(
  () => import('./components/InvestmentCalculator/InvestmentCalculator'),
);

// ── Suspense fallback for lazy-loaded chunks (Issue #304) ────────────────────
function LazyFallback() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        width: '100%',
      }}
    >
      <Skeleton
        variant="rect"
        height="200px"
        width="100%"
        style={{ borderRadius: 'var(--radius-sm)' }}
      />
    </div>
  );
}

// ── Lazy-loaded feature components ────────────────────────────────────────────
const AssetDetailPage = lazy(() =>
  import('./components/AssetDetailPage/AssetDetailPage')
);
const WalletManager = lazy(() =>
  import('./components/WalletManager/WalletManager')
);
const TransactionHistoryDashboard = lazy(() =>
  import('./components/TransactionHistoryDashboard/TransactionHistoryDashboard')
);

// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Route path → Navbar view id mapping
const PATH_TO_VIEW = { '/': 'marketplace', '/portfolio': 'portfolio', '/admin': 'admin', '/history': 'history', '/profile': 'profile' };
const VIEW_TO_PATH = { marketplace: '/', portfolio: '/portfolio', admin: '/admin', history: '/history', profile: '/profile' };

const MarketplacePage = React.memo(
  ({
    publicKey,
    walletError,
    assetMeta,
    assets,
    isFetchingAssets,
    assetsError,
    loadingMeta,
    shares,
    loadingShares,
    buyAmount,
    setBuyAmount,
    loadingBuy,
    handleBuyShares,
    pricePerShare,
  }) => {
    const isTestnet = NETWORK_PASSPHRASE === Networks.TESTNET;
    return (
      <>
        {walletError && <Alert variant="error">{walletError}</Alert>}
        {CONTRACT_ID === 'C...' && <Alert variant="warning">{CONTRACT_NOT_CONFIGURED}</Alert>}

        {loadingMeta ? (
          <Card>
            <div className={styles.assetImageWrapper}>
              <Skeleton variant="rect" height="100%" style={{ borderRadius: 'var(--radius-sm)' }} />
            </div>
            <Skeleton
              variant="text"
              height="1.4em"
              width="55%"
              style={{ marginBottom: 'var(--spacing-xs)' }}
            />
            <Skeleton
              variant="text"
              height="1em"
              width="35%"
              style={{ marginBottom: 'var(--spacing-sm)' }}
            />
            <Skeleton variant="text" lines={3} style={{ marginBottom: 'var(--spacing-md)' }} />
            <Skeleton variant="text" height="1.1em" width="40%" />
          </Card>
        ) : assetMeta ? (
          <Card hoverable>
            {assetMeta.imageUrl && (
              <div className={styles.assetImageWrapper}>
                <OptimizedImage
                  src={assetMeta.imageUrl}
                  alt={assetMeta.title}
                  eager
                  ratio="16/9"
                  className={styles.assetImage}
                  sizes="(max-width: 768px) 100vw, 600px"
                />
              </div>
            )}
            <h2 className={styles.assetTitle}>{assetMeta.title}</h2>
            <p className={styles.assetLocation}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.svgIcon}
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {assetMeta.location}
            </p>
            <p className={styles.assetDescription}>{assetMeta.description}</p>
            {assetMeta.totalValuation && (
              <div className={styles.assetValuation}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.svgIcon}
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <span>Valuation: {assetMeta.totalValuation}</span>
              </div>
            )}
          </Card>
        ) : null}

        <section className={`${styles.section} tour-asset-selection`}>
          <h2 className={styles.sectionTitle}>Available Assets</h2>
          <AssetGrid
            assets={assets}
            loading={isFetchingAssets}
            error={assetsError}
            isEmpty={!isFetchingAssets && !assetsError && assets.length === 0}
            hasNextPage={hasNextPage}
            onLoadMore={() => fetchNextPage(API_URL)}
            loadingMore={isFetchingAssets}
          />
        </section>

        {publicKey && (
          <Card>
            <div className={styles.holdingsRow}>
              <span className={styles.holdingsLabel}>Your Share Balance</span>
              {loadingShares ? (
                <span className={styles.holdingsValueLoading}>
                  <Spinner size="sm" label="Fetching share balance…" />
                  <Skeleton variant="text" width="3rem" height="1.6em" />
                </span>
              ) : (
                <span className={styles.holdingsValue}>{shares}</span>
              )}
            </div>
            <hr className={styles.divider} />
            <h3 className={styles.purchaseHeader}>Buy Fractional Shares</h3>
            <div className={styles.purchaseRow}>
              <Input
                id="buy-amount-input"
                type="number"
                value={buyAmount}
                onChange={(e) => setBuyAmount(Math.max(1, Number(e.target.value)))}
                min="1"
                disabled={loadingBuy}
                className={styles.buyInput}
              />
              <Button onClick={handleBuyShares} loading={loadingBuy} variant="primary">
                {loadingBuy ? 'Processing…' : 'Buy Shares'}
              </Button>
            </div>
            {loadingBuy && (
              <div className={styles.buyLoadingHint}>
                <Spinner size="sm" label="Processing transaction…" />
                <span>Submitting transaction to the network…</span>
              </div>
            )}
          </Card>
        )}
      </>
    );
  },
);

function App() {
  // ── Global store state ─────────────────────────────────────────────────────
  const { t } = useTranslation();
  const {
    publicKey,
    isConnecting,
    walletError,
    shares,
    activeProvider,
    connect,
    disconnect,
    checkConnection,
    setShares,
    clearWalletError,
  } = useWalletStore();

  const {
    assets,
    assetMeta,
    isFetchingAssets,
    assetsError,
    fetchAllAssets,
    fetchNextPage,
    fetchMetadata,
    hasNextPage,
    clearMeta,
    clearAssets,
  } = useAssetStore();

  const [buyAmount, setBuyAmount] = useState(1);
  const [confirmPending, setConfirmPending] = useState(false);
  const [loadingMeta] = useState(false);
  const [txError, setTxError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const txStatus = useTransactionStatus(lastTxHash);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const navigate = useNavigate();
  const location = useLocation();

  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState('marketplace');

  // ── WebSocket for real-time updates (Issues #425, #426) ─────────────────────
  const wsUrl = `ws://${new URL(API_URL).host}/ws`;
  const { connected: wsConnected } = useGraphQLSubscription(wsUrl, {
    enabled: process.env.NODE_ENV !== 'test',
    reconnectAttempts: 5,
    reconnectDelay: 3000,
    onEvent: handleSubscriptionEvent,
  });

  // ── Wallet Discovery (Issue #424) ────────────────────────────────────────────
  const { providers } = useWalletDiscovery();

  useEffect(() => {
    if (providers.length > 0) {
      useWalletStore.getState().setAvailableProviders(providers);
    }
  }, [providers]);

  // ── Offline Sync (Issue #425) ─────────────────────────────────────────────────
  const { isOnline, queueStats, processQueue, cacheAndQueue } = useOfflineSync();

  // ── GraphQL Subscriptions Cache Integration (Issue #426) ──────────────────────
  const markAssetLive = useLiveUpdatesStore((state) => state.markAssetLive);
  const updateAssetTimestamp = useLiveUpdatesStore((state) => state.updateAssetTimestamp);

  const handleSubscriptionEvent = useCallback(
    (message) => {
      if (!message.type || !message.data) return;

      const cacheKey = `graphql:${message.type}`;
      const contractId = message.data.contractId || message.data.vaultId || message.data.id;

      switch (message.type) {
        case WS_EVENT_TYPES.PRICE_UPDATED:
          setQueryData(`${cacheKey}:price:${contractId}`, {
            price: message.data.price,
            lastUpdated: Date.now(),
          });
          // Mark asset as receiving live updates
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.AVAILABILITY_CHANGED:
          applySubscriptionDelta(
            `${cacheKey}:availability:${contractId}`,
            {
              availableShares: message.data.availableShares,
              totalShares: message.data.totalShares,
            },
          );
          // Mark asset as receiving live updates
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.ASSET_UPDATED:
          setQueryData(
            `${cacheKey}:asset:${contractId}`,
            message.data,
          );
          // Mark asset as receiving live updates
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.SHARE_PURCHASED:
          if (publicKey && message.data.buyerAddress !== publicKey) {
            console.log('Share purchase detected:', message.data);
          }
          // Mark asset as receiving live updates
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.MARKETPLACE_PAUSED:
          addToast({ message: 'Marketplace has been paused', type: 'warning' });
          break;

        case WS_EVENT_TYPES.MARKETPLACE_UNPAUSED:
          addToast({ message: 'Marketplace is now available', type: 'success' });
          break;

        default:
          console.log('Unknown WebSocket event:', message.type);
      }
    },
    [publicKey, addToast, markAssetLive, updateAssetTimestamp],
  );

  // ── Keyboard shortcuts (Issue #194) ─────────────────────────────────────────
  const [view, setView] = useState('marketplace');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  useKeyboardShortcuts({
    search: () => {
      /* focus search input if present */
      const el = document.getElementById('search-input') || document.getElementById('asset-search');
      if (el) {
        el.focus();
        el.select();
      } else {
        setView('marketplace');
      }
    },
    portfolio: () => setView('portfolio'),
    home: () => setView('marketplace'),
    help: () => setShortcutHelpOpen((prev) => !prev),
    escape: () => {
      setShortcutHelpOpen(false);
      setConfirmPending(false);
    },
  });

  // Track purchase details for WebSocket broadcast
  const lastPurchaseRef = useRef({ amount: null, timestamp: null });

  useEffect(() => {
    if (!lastTxHash || notifiedRef.current[lastTxHash]) return;
    if (txStatus === 'confirmed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: TX_CONFIRMED, type: 'success', txHash: lastTxHash });
      setTxResult(null);

      // Broadcast share purchase event to WebSocket subscribers
      if (publicKey && lastPurchaseRef.current.amount && pricePerShare) {
        const totalCost = lastPurchaseRef.current.amount * pricePerShare;
        fetch(`${API_URL}/api/v1/notify/share-purchased`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contractId: CONTRACT_ID,
            buyerAddress: publicKey,
            sharesToBuy: lastPurchaseRef.current.amount,
            totalCost,
          }),
        }).catch((err) => console.error('Failed to broadcast share purchase:', err));
      }

      fetchShares();
    } else if (txStatus === 'failed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: TX_FAILED, type: 'error', txHash: lastTxHash });
      setTxError(null);
    }
  }, [lastTxHash, txStatus, publicKey, pricePerShare]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const fetchSharesArgs = useMemo(() => {
    if (!publicKey) return [];
    try {
      return [nativeToScVal(publicKey, { type: 'address' })];
    } catch {
      return [];
    }
  }, [publicKey]);

  const { loading: loadingShares, refetch: fetchShares } = useSorobanRead(
    'get_shares',
    fetchSharesArgs,
    {
      skip: !publicKey || CONTRACT_ID.length < 50,
      onSuccess: (result) => {
        if (result?.retval) setShares(Number(result.retval.u32()));
      },
      onError: () => console.error(FAILED_FETCH_SHARE_BALANCE),
    },
  );

  const buySharesTx = useSorobanWrite('buy_shares');
  const loadingBuy = buySharesTx.loading;

  const { data: priceData, loading: loadingPrice } = useSorobanRead('get_price', [], { skip: CONTRACT_ID.length < 50 });
  const pricePerShare = priceData?.retval ? Number(priceData.retval.u64()) : null;

  const { data: availableSharesData } = useSorobanRead('get_available_shares', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const availableShares =
    availableSharesData?.retval != null ? Number(availableSharesData.retval.u32()) : null;

  const { data: totalSharesData } = useSorobanRead('get_total_shares', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const totalShares = totalSharesData?.retval != null ? Number(totalSharesData.retval.u32()) : null;

  const [acceptedTokens, setAcceptedTokens] = useState([]);
  const [paymentToken, setPaymentToken] = useState('');

  // ── Issue #373: Price range filter state ──────────────────────────────────
  const [priceRangeFilter, setPriceRangeFilter] = useState(null); // null = not set

  useEffect(() => {
    if (!publicKey || CONTRACT_ID.length < 50) return;
    (async () => {
      try {
        const { rpc, Contract, TransactionBuilder, Address } = await import('@stellar/stellar-sdk');
        const server = new rpc.Server(
          import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443',
        );
        const contract = new Contract(CONTRACT_ID);
        const account = await server.getAccount(publicKey);
        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(contract.call('get_accepted_tokens'))
          .setTimeout(30)
          .build();
        const sim = await server.simulateTransaction(tx);
        if (sim.result?.retval) {
          const vec = sim.result.retval.vec();
          const list = vec ? vec.map((v) => Address.fromScVal(v).toString()) : [];
          setAcceptedTokens(list);
          if (list.length > 0) setPaymentToken(list[0]);
        }
      } catch {
        // silently fall back — buyer will use default
      }
    })();
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) fetchMetadata(CONTRACT_ID, API_URL);
  }, [publicKey]);

  useEffect(() => {
    fetchAllAssets(API_URL);
  }, []);

  const connectWallet = useCallback(async () => {
    clearWalletError();
    await connect();
  }, [clearWalletError, connect]);
  const disconnectWallet = useCallback(() => {
    disconnect();
    clearMeta();
    clearAssets();
    setTxResult(null);
    setTxError(null);
    ['auth_token', 'jwt', 'access_token', 'refresh_token'].forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    if (location.pathname !== '/') navigate('/', { replace: true });
  }, [disconnect, clearMeta, clearAssets, location.pathname, navigate]);

  useEffect(() => {
    if (!publicKey) return undefined;

    let disconnected = false;
    const handleDisconnect = () => {
      if (disconnected) return;
      disconnected = true;
      disconnectWallet();
    };
    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) handleDisconnect();
    };
    const provider = activeProvider?.provider;
    const providerEvents = [
      ['accountsChanged', handleAccountsChanged],
      ['accountChanged', handleAccountsChanged],
      ['disconnect', handleDisconnect],
    ];

    providerEvents.forEach(([event, handler]) => provider?.on?.(event, handler));
    ['wallet:disconnect', 'freighter:disconnect', 'albedo:disconnect'].forEach((event) => {
      window.addEventListener(event, handleDisconnect);
    });

    const checkWallet = async () => {
      if (!disconnected && !(await checkConnection())) handleDisconnect();
    };
    const intervalId = window.setInterval(checkWallet, 2000);

    return () => {
      providerEvents.forEach(([event, handler]) => provider?.removeListener?.(event, handler));
      ['wallet:disconnect', 'freighter:disconnect', 'albedo:disconnect'].forEach((event) => {
        window.removeEventListener(event, handleDisconnect);
      });
      window.clearInterval(intervalId);
    };
  }, [publicKey, activeProvider, checkConnection, disconnectWallet]);

  const handleBuyShares = useCallback(() => {
    if (!publicKey) return;
    if (buyAmount < 1) {
      addToast({ message: MUST_BUY_AT_LEAST_ONE_SHARE, type: 'error' });
      return;
    }
    setConfirmPending(true);
  }, [publicKey, buyAmount, addToast]);

  const handleConfirmBuy = async () => {
    setTxResult(null);
    setLastTxHash(null);
    try {
      const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
      const scValShares = nativeToScVal(buyAmount, { type: 'u32' });
      const scValToken = nativeToScVal(paymentToken, { type: 'address' });

      // Store purchase details for WebSocket broadcast on confirmation
      lastPurchaseRef.current = { amount: buyAmount, timestamp: Date.now() };

      const submitRes = await buySharesTx.execute([scValBuyer, scValShares, scValToken]);
      setConfirmPending(false);
      const { hash } = submitRes;
      setLastTxHash(hash);
      pendingToastRef.current = addToast({ message: TX_SUBMITTED, type: 'pending', txHash: hash });
    } catch (err) {
      setConfirmPending(false);
      let msg = TX_FAILED_CHECK_BALANCE;
      if (err.message?.includes('paused')) msg = TX_FAILED_PAUSED;
      else if (err.message?.includes('Not enough shares')) msg = TX_FAILED_NO_SHARES;
      addToast({ message: msg, type: 'error' });
    }
  };

  const isTestnet = useMemo(() => NETWORK_PASSPHRASE === Networks.TESTNET, []);

  return (
    <div className={styles.container}>
      <OnboardingTour />
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
            <Tooltip
              content={
                isTestnet
                  ? 'Connected to Stellar Testnet — safe for testing'
                  : 'Connected to Stellar Mainnet — real funds at risk'
              }
              position="bottom"
              trigger="hover"
            >
              <Badge variant={isTestnet ? 'success' : 'danger'}>
                {isTestnet ? 'TESTNET' : 'MAINNET'}
              </Badge>
            </Tooltip>
          </div>
        </div>

        <div className={`${styles.walletArea} tour-wallet-connect`}>
          <ConnectionStatusIndicator
            status={wsConnected ? 'connected' : 'disconnected'}
            showLabel={false}
          />
          <LanguageSwitcher />
          <button
            onClick={toggleTheme}
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
            <WalletSelector
              onConnect={(provider) => {
                useWalletStore.getState().connectWithProvider(provider);
              }}
              connecting={isConnecting}
            />
          ) : (
            <div className={styles.walletInfo}>
              {/* Clicking public key re-opens WalletManager */}
              <button
                className={styles.publicKey}
                title={`${publicKey} — click to manage wallet`}
                onClick={() => setWalletManagerOpen(true)}
                aria-label="Manage wallet connection"
              >
                {publicKey.slice(0, 8)}…{publicKey.slice(-6)}
              </button>
              <Button onClick={disconnectWallet} variant="danger">
                {t('wallet.disconnect')}
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* ── Tab Navigation ──────────────────────────────────────────────────── */}
      <nav className={styles.tabs}>
        <button
          className={`${styles.tab} ${view === 'marketplace' || view === 'asset-detail' ? styles.tabActive : ''}`}
          onClick={() => { setView('marketplace'); setSelectedAsset(null); }}
        >
          {t('nav.marketplace')}
        </button>
        <button
          className={`${styles.tab} ${view === 'portfolio' ? styles.tabActive : ''} tour-portfolio`}
          onClick={() => setView('portfolio')}
        >
          {t('nav.portfolio')}
        </button>
        {publicKey && (
          <button
            className={`${styles.tab} ${view === 'transactions' ? styles.tabActive : ''}`}
            onClick={() => setView('transactions')}
          >
            Transactions
          </button>
        )}
        <button
          className={`${styles.tab} ${view === 'admin' ? styles.tabActive : ''}`}
          onClick={() => setView('admin')}
        >
          {t('nav.admin')}
        </button>
        <button
          className={`${styles.tab} ${view === 'history' ? styles.tabActive : ''}`}
          onClick={() => setView('history')}
        >
          History
        </button>
        <button
          className={`${styles.tab} ${view === 'profile' ? styles.tabActive : ''}`}
          onClick={() => setView('profile')}
        >
          Profile
        </button>
      </nav>

      {/* Breadcrumb navigation (Issue #301) */}
      <Breadcrumbs
        labels={{
          marketplace: 'Marketplace',
          portfolio: 'Portfolio',
          admin: 'Admin',
          history: 'History',
          compare: 'Compare',
          favorites: 'Favorites',
          profile: 'Profile',
        }}
      />

      <OfflineIndicator />

      <ToastContainer />

      {view === 'portfolio' ? (
        <ErrorBoundary moduleName="Portfolio Dashboard">
          <PortfolioPage />
        </ErrorBoundary>
      ) : view === 'admin' ? (
        <ErrorBoundary moduleName="Admin Dashboard">
          <AdminPage
            publicKey={publicKey}
            onDisconnect={() => setView('marketplace')}
          />
        </ErrorBoundary>
      ) : view === 'history' ? (
        <ErrorBoundary moduleName="Transaction History">
          <TransactionHistory />
        </ErrorBoundary>
      ) : view === 'profile' ? (
        <ErrorBoundary moduleName="Profile Dashboard">
          <ProfilePage />
        </ErrorBoundary>
      ) : (
        <>
      {/* Wallet errors (connection issues) */}
      {walletError && (
        <Alert variant="error">
          {walletError}
        </Alert>
      )}

            {/* Contract not configured */}
            {CONTRACT_ID === 'C...' && <Alert variant="warning">{CONTRACT_NOT_CONFIGURED}</Alert>}

            {/* ── Asset Metadata Card ─────────────────────────────────────────── */}
            <ErrorBoundary moduleName="Featured Asset">
              {loadingMeta ? (
                <Card>
                  <div className={styles.assetImageWrapper}>
                    <Skeleton
                      variant="rect"
                      height="100%"
                      style={{ borderRadius: 'var(--radius-sm)' }}
                    />
                  </div>
                  <Skeleton
                    variant="text"
                    height="1.4em"
                    width="55%"
                    style={{ marginBottom: 'var(--spacing-xs)' }}
                  />
                  <Skeleton
                    variant="text"
                    height="1em"
                    width="35%"
                    style={{ marginBottom: 'var(--spacing-sm)' }}
                  />
                  <Skeleton variant="text" lines={3} style={{ marginBottom: 'var(--spacing-md)' }} />
                  <Skeleton variant="text" height="1.1em" width="40%" />
                </Card>
              ) : assetMeta ? (
                <Card hoverable>
                  {assetMeta.imageUrl && (
                    <div className={styles.assetImageWrapper}>
                      <OptimizedImage
                        src={assetMeta.imageUrl}
                        alt={assetMeta.title}
                        eager
                        ratio="16/9"
                        className={styles.assetImage}
                        sizes="(max-width: 768px) 100vw, 600px"
                      />
                    </div>
                  )}
                  {assetMeta.assetType === 'real_estate' && assetMeta.imageUrl && (
                    <VirtualTour imageUrl={assetMeta.imageUrl} title={assetMeta.title} />
                  )}
                  <h2 className={styles.assetTitle}>{assetMeta.title}</h2>
                  <p className={styles.assetLocation}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={styles.svgIcon}
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {assetMeta.location}
                  </p>
                  <p className={styles.assetDescription}>{assetMeta.description}</p>
                  {assetMeta.totalValuation && (
                    <div className={styles.assetValuation}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={styles.svgIcon}
                      >
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                      <span>Valuation: {assetMeta.totalValuation}</span>
                    </div>
                  )}
                </Card>
              ) : null}
            </ErrorBoundary>

            {/* ── Asset Listing Grid ─────────────────────────────────────────── */}
            <ErrorBoundary moduleName="Available Assets">
              <section className={`${styles.section} tour-asset-selection`}>
                <h2 className={styles.sectionTitle}>{t('marketplace.availableAssets')}</h2>

                {/* Issue #373 — Price range filter sidebar */}
                {(() => {
                  // Derive price bounds from loaded assets (assets may have a `price` field
                  // or fall back to 0 when the on-chain price is not embedded in metadata)
                  const prices = assets
                    .map((a) => Number(a.price ?? a.pricePerShare ?? 0))
                    .filter((p) => p > 0);
                  const absoluteMin = prices.length ? Math.min(...prices) : 0;
                  const absoluteMax = prices.length ? Math.max(...prices) : 10_000;

                  // Effective filter bounds (default to full range when not set)
                  const [filterMin, filterMax] = priceRangeFilter ?? [absoluteMin, absoluteMax];

                  // Client-side filtered assets (Issue #373)
                  const filteredAssets =
                    priceRangeFilter && prices.length > 0
                      ? assets.filter((a) => {
                          const p = Number(a.price ?? a.pricePerShare ?? 0);
                          // If an asset has no price data, include it so it stays visible
                          if (p === 0) return true;
                          return p >= filterMin && p <= filterMax;
                        })
                      : assets;

                  return (
                    <>
                      {/* Show price filter only once at least one asset has price data */}
                      {prices.length > 0 && (
                        <PriceRangeFilter
                          min={absoluteMin}
                          max={absoluteMax}
                          value={[filterMin, filterMax]}
                          onChange={(range) => setPriceRangeFilter(range)}
                          onClear={() => setPriceRangeFilter(null)}
                        />
                      )}

                      <AssetGrid
                        assets={filteredAssets}
                        loading={isFetchingAssets}
                        error={assetsError}
                        isEmpty={!isFetchingAssets && !assetsError && filteredAssets.length === 0}
                        hasNextPage={hasNextPage}
                        onLoadMore={() => fetchNextPage(API_URL)}
                        loadingMore={isFetchingAssets}
                      />
                    </>
                  );
                })()}
              </section>
            </ErrorBoundary>

            {/* ── News & Updates Section (Issue #191) ─────────────────────────── */}
            <ErrorBoundary moduleName="Marketplace News">
              <Suspense fallback={<LazyFallback />}>
                <NewsSection />
              </Suspense>
            </ErrorBoundary>

            <div className="tour-order-book">
            {/* ── Holdings + Buy Card ─────────────────────────────────────────── */}
            {publicKey && (
              <ErrorBoundary moduleName="Share Purchase">
                <BuyShares
                  shares={shares}
                  loadingShares={loadingShares}
                  loadingBuy={loadingBuy}
                  onBuy={handleBuyShares}
                  acceptedTokens={acceptedTokens}
                  paymentToken={paymentToken}
                  onTokenChange={setPaymentToken}
                  availableShares={availableShares}
                  totalShares={totalShares}
                  pricePerShare={pricePerShare}
                  buyAmount={buyAmount}
                  onBuyAmountChange={setBuyAmount}
                />
              </ErrorBoundary>
            )}

            </div>

            {/* ── Price Alerts (Issue #188) ─────────────────────────────────────── */}
            {CONTRACT_ID.length >= 50 && pricePerShare != null && (
              <ErrorBoundary moduleName="Price Alerts">
                <Suspense fallback={<LazyFallback />}>
                  <PriceAlert
                    contractId={CONTRACT_ID}
                    assetTitle={assetMeta?.title || 'Asset'}
                    currentPrice={pricePerShare}
                  />
                </Suspense>
              </ErrorBoundary>
            )}

            {/* ── Investment Calculator (Issue #189) ───────────────────────────── */}
            <ErrorBoundary moduleName="Investment Calculator">
              <Suspense fallback={<LazyFallback />}>
                <InvestmentCalculator
                  pricePerShare={pricePerShare}
                  assetTitle={assetMeta?.title || 'Asset'}
                  totalShares={totalShares}
                  availableShares={availableShares}
                />
              </Suspense>
            </ErrorBoundary>
          </>
        )}
      </Suspense>

      {confirmPending && (
        <ConfirmPurchase
          shares={buyAmount}
          pricePerShare={pricePerShare}
          onConfirm={handleConfirmBuy}
          onCancel={() => setConfirmPending(false)}
          loading={loadingBuy}
        />
      )}

      {/* Keyboard shortcut help modal (Issue #194: Ctrl+/) */}
      <ShortcutHelpModal open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      {/* Keyboard shortcuts hint shown in footer */}
      <div
        role="button"
        tabIndex={0}
        id="shortcut-help-trigger"
        aria-label="Show keyboard shortcuts"
        onClick={() => setShortcutHelpOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setShortcutHelpOpen(true);
        }}
        style={{
          textAlign: 'center',
          padding: '0.5rem',
          fontSize: '0.75rem',
          cursor: 'pointer',
          opacity: 0.5,
        }}
      >
        ⌨️ Keyboard shortcuts available &mdash; press{' '}
        <kbd
          style={{
            background: 'none',
            border: '1px solid currentColor',
            borderRadius: '3px',
            padding: '0 4px',
            fontFamily: 'monospace',
          }}
        >
          Ctrl+/
        </kbd>{' '}
        for help
      </div>
    </div>
  );
}

export default App;
