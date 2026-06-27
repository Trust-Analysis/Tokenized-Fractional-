import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Networks, nativeToScVal } from '@stellar/stellar-sdk';
import { useSorobanRead, useSorobanWrite } from './hooks/useSoroban';

import Button from './components/Button/Button';
import Card from './components/Card/Card';
import Input from './components/Input/Input';
import Badge from './components/Badge/Badge';
import Alert from './components/Alert/Alert';
import Skeleton from './components/Skeleton/Skeleton';
import Spinner from './components/Spinner/Spinner';
import AssetGrid from './components/AssetGrid/AssetGrid';
import AdminPage from './components/AdminPage/AdminPage';
import PortfolioPage from './components/PortfolioPage/PortfolioPage';
import ToastContainer from './components/Toast/Toast';
import ConfirmPurchase from './components/ConfirmPurchase/ConfirmPurchase';
import styles from './App.module.css';

import { useWalletStore } from './store/useWalletStore';
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
import useTransactionStatus from './hooks/useTransactionStatus';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  // ── Global store state ─────────────────────────────────────────────────────
  const {
    publicKey,
    isConnecting,
    walletError,
    shares,
    connect,
    disconnect,
    checkConnection,
    setShares,
    setWalletError,
    clearWalletError,
  } = useWalletStore();

  const {
    assets,
    assetMeta,
    isFetchingAssets,
    assetsError,
    fetchAllAssets,
    fetchMetadata,
    clearMeta,
    clearAssets,
  } = useAssetStore();

  // ── Local UI state (not global — scoped to this component) ────────────────
  const [buyAmount, setBuyAmount] = useState(1);
  const [confirmPending, setConfirmPending] = useState(false);

  // Granular loading states
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [error, setError] = useState(null);
  const [txError, setTxError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const txStatus = useTransactionStatus(lastTxHash);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  // View state: 'marketplace' | 'portfolio' | 'admin'
  const [view, setView] = useState('marketplace');

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // ── Poll transaction status and update toasts ──────────────────────────────
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
  }, [lastTxHash, txStatus]);

  // ── On mount: re-validate Freighter session ────────────────────────────────
  // The persisted publicKey lets the UI render instantly; checkConnection()
  // then confirms the Freighter session is still live in the background.
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Construct arguments dynamically
  const fetchSharesArgs = useMemo(() => {
    if (!publicKey) return [];
    try {
      return [nativeToScVal(publicKey, { type: 'address' })];
    } catch (e) {
      console.error('Failed to construct address ScVal:', e);
      return [];
    }
  }, [publicKey]);

  // Hook for get_shares
  const {
    loading: loadingShares,
    refetch: fetchShares,
  } = useSorobanRead('get_shares', fetchSharesArgs, {
    skip: !publicKey || CONTRACT_ID.length < 50,
    onSuccess: (result) => {
      if (result && result.retval) {
        setShares(Number(result.retval.u32()));
      }
    },
    onError: (err) => {
      console.error('Error fetching shares:', err);
      setError(FAILED_FETCH_SHARE_BALANCE);
    },
  });

  const buySharesTx = useSorobanWrite('buy_shares');
  const loadingBuy = buySharesTx.loading;

  // Hook for get_price (read-only, no args)
  const { data: priceData } = useSorobanRead('get_price', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const pricePerShare = priceData?.retval ? Number(priceData.retval.u64()) : null;

  // ── Fetch chain data whenever wallet connects ──────────────────────────────
  useEffect(() => {
    if (publicKey) {
      fetchMetadata(CONTRACT_ID, API_URL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // ── Fetch all assets on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchAllAssets(API_URL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wallet actions ─────────────────────────────────────────────────────────
  const connectWallet = async () => {
    clearWalletError();
    setTxError(null);
    await connect();
  };

  const disconnectWallet = () => {
    disconnect();
    clearMeta();
    clearAssets();
    setTxResult(null);
    setTxError(null);
  };

  // ── Transactions ───────────────────────────────────────────────────────────
  const handleBuyShares = () => {
    if (!publicKey) return;
    if (buyAmount < 1) {
      addToast({ message: MUST_BUY_AT_LEAST_ONE_SHARE, type: 'error' });
      return;
    }
    setConfirmPending(true);
  };

  const handleConfirmBuy = async () => {
    setError(null);
    setTxResult(null);
    setLastTxHash(null);

    try {
      const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
      const scValShares = nativeToScVal(buyAmount, { type: 'u32' });

      const submitRes = await buySharesTx.execute([scValBuyer, scValShares]);

      setConfirmPending(false);
      const hash = submitRes.hash;
      setLastTxHash(hash);
      pendingToastRef.current = addToast({
        message: TX_SUBMITTED,
        type: 'pending',
        txHash: hash,
      });
    } catch (err) {
      console.error('Error buying shares:', err);
      setConfirmPending(false);
      let msg = TX_FAILED_CHECK_BALANCE;
      if (err.message?.includes('paused')) {
        msg = TX_FAILED_PAUSED;
      } else if (err.message?.includes('Not enough shares')) {
        msg = TX_FAILED_NO_SHARES;
      }
      addToast({ message: msg, type: 'error' });
    }
  };

  const isTestnet = NETWORK_PASSPHRASE === Networks.TESTNET;

  return (
    <div className={styles.container}>
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
            onClick={toggleTheme}
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
            <Button onClick={connectWallet} variant="success" loading={isConnecting}>
              {isConnecting ? 'Connecting…' : 'Connect Freighter'}
            </Button>
          ) : (
            <div className={styles.walletInfo}>
              <span className={styles.publicKey} title={publicKey}>
                {publicKey}
              </span>
              <Button onClick={disconnectWallet} variant="danger">
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className={styles.tabs}>
        <button
          className={`${styles.tab} ${view === 'marketplace' ? styles.tabActive : ''}`}
          onClick={() => setView('marketplace')}
        >
          Marketplace
        </button>
        <button
          className={`${styles.tab} ${view === 'portfolio' ? styles.tabActive : ''}`}
          onClick={() => setView('portfolio')}
        >
          Portfolio
        </button>
        <button
          className={`${styles.tab} ${view === 'admin' ? styles.tabActive : ''}`}
          onClick={() => setView('admin')}
        >
          Admin
        </button>
      </nav>

      <ToastContainer />

      {view === 'portfolio' ? (
        <PortfolioPage />
      ) : view === 'admin' ? (
        <AdminPage
          publicKey={publicKey}
          onDisconnect={() => setView('marketplace')}
        />
      ) : (
        <>
      {/* Wallet errors (connection issues) */}
      {walletError && (
        <Alert variant="error">
          {walletError}
        </Alert>
      )}

      {/* Contract not configured */}
      {CONTRACT_ID === 'C...' && (
        <Alert variant="warning">
          {CONTRACT_NOT_CONFIGURED}
        </Alert>
      )}

      {/* ── Asset Metadata Card ─────────────────────────────────────────── */}
      {loadingMeta ? (
        <Card>
          <div className={styles.assetImageWrapper}>
            <Skeleton variant="rect" height="100%" style={{ borderRadius: 'var(--radius-sm)' }} />
          </div>
          <Skeleton variant="text" height="1.4em" width="55%" style={{ marginBottom: 'var(--spacing-xs)' }} />
          <Skeleton variant="text" height="1em" width="35%" style={{ marginBottom: 'var(--spacing-sm)' }} />
          <Skeleton variant="text" lines={3} style={{ marginBottom: 'var(--spacing-md)' }} />
          <Skeleton variant="text" height="1.1em" width="40%" />
        </Card>
      ) : assetMeta ? (
        <Card hoverable>
          {assetMeta.imageUrl && (
            <div className={styles.assetImageWrapper}>
              <img src={assetMeta.imageUrl} alt={assetMeta.title} className={styles.assetImage} />
            </div>
          )}
          <h2 className={styles.assetTitle}>{assetMeta.title}</h2>
          <p className={styles.assetLocation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.svgIcon}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            {assetMeta.location}
          </p>
          <p className={styles.assetDescription}>{assetMeta.description}</p>
          {assetMeta.totalValuation && (
            <div className={styles.assetValuation}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.svgIcon}><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              <span>Valuation: {assetMeta.totalValuation}</span>
            </div>
          )}
        </Card>
      ) : null}

      {/* ── Asset Listing Grid ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Available Assets</h2>
        <AssetGrid
          assets={assets}
          loading={isFetchingAssets}
          error={assetsError}
          isEmpty={!isFetchingAssets && !assetsError && assets.length === 0}
        />
      </section>

      {/* ── Holdings + Buy Card ─────────────────────────────────────────── */}
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
      )}

      {confirmPending && (
        <ConfirmPurchase
          shares={buyAmount}
          pricePerShare={pricePerShare}
          onConfirm={handleConfirmBuy}
          onCancel={() => setConfirmPending(false)}
          loading={loadingBuy}
        />
      )}
    </div>
  );
}

export default App;
