import React, { useState, useEffect } from 'react';
import { signTransaction } from '@stellar/freighter-api';
import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal } from '@stellar/stellar-sdk';

import Button from './components/Button/Button';
import Card from './components/Card/Card';
import Input from './components/Input/Input';
import Badge from './components/Badge/Badge';
import Alert from './components/Alert/Alert';
import Skeleton from './components/Skeleton/Skeleton';
import Spinner from './components/Spinner/Spinner';
import styles from './App.module.css';

import { useWalletStore } from './store/useWalletStore';
import { useAssetStore } from './store/useAssetStore';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const server = new rpc.Server(RPC_URL);

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

  const { assetMeta, fetchMetadata, clearMeta } = useAssetStore();

  // ── Local UI state (not global — scoped to this component) ────────────────
  const [buyAmount, setBuyAmount] = useState(1);

  // Granular loading states
  const [loadingBuy, setLoadingBuy] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [error, setError] = useState(null);
  const [assetMeta, setAssetMeta] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // ── On mount: re-validate Freighter session ────────────────────────────────
  // The persisted publicKey lets the UI render instantly; checkConnection()
  // then confirms the Freighter session is still live in the background.
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // ── Fetch chain data whenever wallet connects ──────────────────────────────
  useEffect(() => {
    if (publicKey) {
      fetchShares();
      fetchMetadata(CONTRACT_ID, API_URL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // ── Wallet actions ─────────────────────────────────────────────────────────
  const connectWallet = async () => {
    clearWalletError();
    setTxError(null);
    await connect();
  };

  const disconnectWallet = () => {
    disconnect();
    clearMeta();
    setTxResult(null);
    setTxError(null);
  };

  const fetchMetadata = async () => {
    if (CONTRACT_ID.length < 50) return;
    setLoadingMeta(true);
    try {
      const res = await fetch(`${API_URL}/api/rwa/${CONTRACT_ID}`);
      if (res.ok) {
        const data = await res.json();
        setAssetMeta(data);
      }
    } catch {
      console.warn('Metadata server unreachable');
    } finally {
      setLoadingMeta(false);
    }
  };

  const fetchShares = async () => {
    if (!publicKey || CONTRACT_ID.length < 50) return;
    setLoadingShares(true);
    try {
      setWalletError(null);
      const contract = new Contract(CONTRACT_ID);
      const scValAddress = nativeToScVal(publicKey, { type: 'address' });

      const account = await server.getAccount(publicKey);
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('get_shares', scValAddress))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.result) {
        const parsedShares = Number(simulation.result.retval.u32());
        setShares(parsedShares);
      }
    } catch (err) {
      console.error('Error fetching shares:', err);
      setError('Failed to fetch share balance.');
    } finally {
      setLoadingShares(false);
    }
  };

  // ── Transactions ───────────────────────────────────────────────────────────
  const handleBuyShares = async () => {
    if (!publicKey) return;
    if (buyAmount < 1) {
      setTxError('Must buy at least 1 share');
      return;
    }

    setLoadingBuy(true);
    setError(null);
    setTxResult(null);

    try {
      const account = await server.getAccount(publicKey);
      const contract = new Contract(CONTRACT_ID);

      const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
      const scValShares = nativeToScVal(buyAmount, { type: 'u32' });

      let tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('buy_shares', scValBuyer, scValShares))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.error) {
        throw new Error(simulation.error);
      }

      tx = rpc.assembleTransaction(tx, simulation).build();
      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signError || !signedTxXdr) {
        throw new Error(signError?.message || 'Freighter transaction signing failed');
      }

      const submitRes = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      );

      setTxResult(`Transaction submitted! Hash: ${submitRes.hash}`);
      await fetchShares();
    } catch (err) {
      console.error('Error buying shares:', err);
      if (err.message?.includes('paused')) {
        setTxError('Marketplace is currently paused. Try again later.');
      } else if (err.message?.includes('Not enough shares')) {
        setTxError('Not enough shares available.');
      } else {
        setTxError('Transaction failed. Check your token balance and try again.');
      }
    } finally {
      setLoadingBuy(false);
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

      {/* Wallet errors (connection issues) */}
      {walletError && (
        <Alert variant="error">
          {walletError}
        </Alert>
      )}

      {/* Transaction errors */}
      {txError && (
        <Alert variant="error">
          {txError}
        </Alert>
      )}

      {/* Transaction success */}
      {txResult && (
        <Alert variant="success">
          {txResult}
        </Alert>
      )}

      {/* Contract not configured */}
      {CONTRACT_ID === 'C...' && (
        <Alert variant="warning">
          Set VITE_CONTRACT_ID in frontend/.env to connect to a deployed contract.
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
    </div>
  );
}

export default App;
