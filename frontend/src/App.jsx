import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ToastContainer from './components/Toast/Toast';
import Breadcrumbs from './components/Breadcrumbs/Breadcrumbs';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import NetworkMismatchBanner from './components/NetworkMismatchBanner';
import ContractVerificationBanner from './components/ContractVerificationBanner/ContractVerificationBanner';
import OfflineIndicator from './components/OfflineIndicator/OfflineIndicator';
import OnboardingTour from './components/OnboardingTour';
import PreferencesPanel from './components/PreferencesPanel/PreferencesPanel';
import ShortcutHelpModal from './components/ShortcutHelp/ShortcutHelp';
import Footer from './components/Footer/Footer';
import AppHeader from './components/AppHeader/AppHeader';
import AppTabs from './components/AppTabs/AppTabs';
import MarketplaceView from './components/MarketplaceView/MarketplaceView';
import LazyFallback from './components/LazyFallback/LazyFallback';
import ProfilePage from './components/ProfilePage/ProfilePage';
import styles from './App.module.css';

import { useTheme } from './context/ThemeContext';
import { useWalletStore } from './store/useWalletStore';
import { useAssetStore } from './store/useAssetStore';
import { useToastStore } from './store/useToastStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useWalletLifecycle } from './hooks/useWalletLifecycle';
import useNetworkMismatch from './hooks/useNetworkMismatch';
import useContractManifest from './hooks/useContractManifest';
import { useFreighterWallet } from './hooks/useFreighterWallet';
import { useRealtimeUpdates } from './hooks/useRealtimeUpdates';
import { useSharePurchase } from './hooks/useSharePurchase';
import { API_URL, CONTRACT_ID, NETWORK_PASSPHRASE } from './constants/app';

// ── Route-based code splitting (Issue #304) ──────────────────────────────────
const AdminPage = lazy(() => import('./components/AdminPage/AdminPage'));
const PortfolioPage = lazy(() => import('./components/PortfolioPage/PortfolioPage'));
const TransactionHistory = lazy(() => import('./components/TransactionHistory/TransactionHistory'));
const WalletManager = lazy(() => import('./components/WalletManager/WalletManager'));

function App() {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [view, setView] = useState('marketplace');
  const [walletManagerOpen, setWalletManagerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // ── Global stores ──────────────────────────────────────────────────────────
  const { isConnecting, walletError } = useWalletStore();
  const { publicKey, handleDisconnectWallet } = useWalletLifecycle();
  const {
    assets,
    assetMeta,
    isFetchingAssets,
    assetsError,
    fetchAllAssets,
    fetchNextPage,
    fetchMetadata,
    hasNextPage,
  } = useAssetStore();
  const addToast = useToastStore((state) => state.addToast);
  const removeToast = useToastStore((state) => state.removeToast);

  // ── Network / contract checks ──────────────────────────────────────────────
  const {
    mismatch: networkMismatch,
    walletNetwork: freighterNetwork,
    expected: expectedNetworkLabel,
    checkNow: recheckNetwork,
  } = useNetworkMismatch({ enabled: Boolean(publicKey) });

  const contractVerification = useContractManifest({
    contractId: CONTRACT_ID,
    network: NETWORK_PASSPHRASE,
  });

  // ── Feature hooks ──────────────────────────────────────────────────────────
  const {
    walletAddress,
    isReconnecting,
    connectWallet: connectFreighter,
    disconnectWallet: disconnectFreighter,
  } = useFreighterWallet();

  const purchase = useSharePurchase({
    publicKey,
    addToast,
    removeToast,
    networkMismatch,
    expectedNetworkLabel,
    recheckNetwork,
  });

  const { wsConnected } = useRealtimeUpdates({ publicKey, addToast });

  // Connection health and offline queue run for the lifetime of the app.
  useOfflineSync();

  // ── Data loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (publicKey) fetchMetadata(CONTRACT_ID, API_URL);
  }, [publicKey, fetchMetadata]);

  useEffect(() => {
    fetchAllAssets(API_URL);
  }, [fetchAllAssets]);

  // ── Keyboard shortcuts (Issue #194) ────────────────────────────────────────
  useKeyboardShortcuts({
    search: () => {
      const element =
        document.getElementById('search-input') || document.getElementById('asset-search');
      if (element) {
        element.focus();
        element.select();
      } else {
        setView('marketplace');
      }
    },
    portfolio: () => setView('portfolio'),
    home: () => setView('marketplace'),
    help: () => setShortcutHelpOpen((previous) => !previous),
    escape: () => setShortcutHelpOpen(false),
  });

  return (
    <div className={styles.container}>
      <OnboardingTour />

      <AppHeader
        publicKey={publicKey}
        isConnecting={isConnecting}
        wsConnected={wsConnected}
        theme={theme}
        onToggleTheme={toggleTheme}
        onManageWallet={() => setWalletManagerOpen(true)}
        onDisconnect={handleDisconnectWallet}
        onSelectProvider={(provider) => {
          useWalletStore.getState().connectWithProvider(provider);
        }}
        disconnectLabel={t('wallet.disconnect')}
      />

      <NetworkMismatchBanner
        mismatch={networkMismatch}
        expected={expectedNetworkLabel}
        walletNetwork={freighterNetwork}
        onRetry={recheckNetwork}
      />

      <ContractVerificationBanner
        status={contractVerification.status}
        reason={contractVerification.reason}
        configuredContractId={contractVerification.contractId}
        manifestUrl={contractVerification.manifestUrl}
      />

      <AppTabs
        view={view}
        publicKey={publicKey}
        preferencesOpen={preferencesOpen}
        onChangeView={setView}
        onOpenPreferences={() => setPreferencesOpen(true)}
        t={t}
      />

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

      <Suspense fallback={<LazyFallback />}>
        {view === 'portfolio' ? (
          <ErrorBoundary moduleName="Portfolio Dashboard">
            <PortfolioPage />
          </ErrorBoundary>
        ) : view === 'admin' ? (
          <ErrorBoundary moduleName="Admin Dashboard">
            <AdminPage publicKey={publicKey} onDisconnect={() => setView('marketplace')} />
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
          <MarketplaceView
            publicKey={publicKey}
            walletError={walletError}
            assetMeta={assetMeta}
            assets={assets}
            isFetchingAssets={isFetchingAssets}
            assetsError={assetsError}
            hasNextPage={hasNextPage}
            fetchNextPage={fetchNextPage}
            shares={purchase.shares}
            loadingShares={purchase.loadingShares}
            buyAmount={purchase.buyAmount}
            setBuyAmount={purchase.setBuyAmount}
            loadingBuy={purchase.loadingBuy}
            handleBuyShares={purchase.handleBuyShares}
            pricePerShare={purchase.pricePerShare}
            acceptedTokens={purchase.acceptedTokens}
            paymentToken={purchase.paymentToken}
            setPaymentToken={purchase.setPaymentToken}
            availableShares={purchase.availableShares}
            totalShares={purchase.totalShares}
            hasPendingTx={purchase.hasPendingTx}
            recoveringTx={purchase.recoveringTx}
            walletAddress={walletAddress}
            isReconnecting={isReconnecting}
            onConnectFreighter={connectFreighter}
            onDisconnectFreighter={disconnectFreighter}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        <WalletManager isOpen={walletManagerOpen} onClose={() => setWalletManagerOpen(false)} />
      </Suspense>

      <PreferencesPanel open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />

      <ShortcutHelpModal open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      <div
        role="button"
        tabIndex={0}
        id="shortcut-help-trigger"
        aria-label="Show keyboard shortcuts"
        onClick={() => setShortcutHelpOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setShortcutHelpOpen(true);
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

      <Footer />
    </div>
  );
}

export default App;
