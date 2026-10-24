import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Networks, nativeToScVal } from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';

import Card from './components/Card/Card';
import Alert from './components/Alert/Alert';
import NetworkBadge from './components/NetworkBadge/NetworkBadge';
import Button from './components/Button/Button';
import Skeleton from './components/Skeleton/Skeleton';
import Input from './components/Input/Input';
import AssetGrid from './components/AssetGrid/AssetGrid';
import BuyShares from './components/BuyShares/BuyShares';
import ToastContainer from './components/Toast/Toast';
import ConfirmPurchase from './components/ConfirmPurchase/ConfirmPurchase';
import LanguageSwitcher from './components/LanguageSwitcher/LanguageSwitcher';
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
  FAILED_FETCH_SHARE_BALANCE,
  MUST_BUY_AT_LEAST_ONE_SHARE,
  CONTRACT_NOT_CONFIGURED,
} from './constants/errors';
import { toToastError } from './lib/errorMapper';
import { useAssetStore } from './store/useAssetStore';
import { useToastStore } from './store/useToastStore';
import { useFavoritesStore } from './store/useFavoritesStore';
import { useSorobanRead, useSorobanWrite } from './hooks/useSoroban';
import useTransactionStatus from './hooks/useTransactionStatus';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { WS_EVENT_TYPES } from './hooks/useWebSocket';
import { useGraphQLSubscription } from './hooks/useGraphQLSubscription';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useWalletDiscovery } from './hooks/useWalletDiscovery';
import { useDebouncedCallback } from './hooks/useDebounce';
import { usePendingTransaction } from './hooks/usePendingTransaction';
import OfflineIndicator from './components/OfflineIndicator/OfflineIndicator';
import WalletSelector from './components/WalletSelector/WalletSelector';
import NetworkMismatchBanner from './components/NetworkMismatchBanner';
import useNetworkMismatch from './hooks/useNetworkMismatch';
import OnboardingTour from './components/OnboardingTour';
import WalletAddressBadge from './components/WalletAddressBadge/WalletAddressBadge';
import ContractVerificationBanner from './components/ContractVerificationBanner/ContractVerificationBanner';
import PreferencesPanel from './components/PreferencesPanel/PreferencesPanel';
import OptimizedImage from './components/OptimizedImage/OptimizedImage';
import VirtualTour from './components/VirtualTour/VirtualTour';
import ShortcutHelpModal from './components/ShortcutHelp/ShortcutHelp';
import Spinner from './components/Spinner/Spinner';
import useContractManifest from './hooks/useContractManifest';
import Footer from './components/Footer/Footer';
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

      {/* Asset Search, Filter, and Sort Toolbar (#786) */}
      <div className="asset-search-toolbar" style={{ margin: "20px auto", padding: "16px 20px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", maxWidth: "900px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <input 
          type="text"
          placeholder="🔍 Search assets by name or location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: "1 1 280px", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "14px" }}
        />
        <select 
          value={assetTypeFilter}
          onChange={(e) => setAssetTypeFilter(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
        >
          <option value="all">All Asset Types</option>
          <option value="real_estate">Real Estate</option>
          <option value="energy">Energy & Infrastructure</option>
        </select>
        <select 
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
        >
          <option value="newest">Sort: Newest First</option>
          <option value="valuation-desc">Valuation: High to Low</option>
          <option value="valuation-asc">Valuation: Low to High</option>
        </select>
      </div>

      {/* Asset Listing Results */}
      <div className="asset-grid" style={{ margin: "10px auto", maxWidth: "900px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px", textAlign: "left" }}>
        {filteredAssets.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", padding: "30px", background: "#fff", borderRadius: "8px", textAlign: "center", color: "#64748b" }}>
            No assets match your search criteria.
          </div>
        ) : (
          filteredAssets.map(asset => (
            <div key={asset.contractId} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#0284c7", background: "#e0f2fe", padding: "2px 8px", borderRadius: "12px", textTransform: "uppercase" }}>{asset.assetType}</span>
              <h4 style={{ margin: "10px 0 6px 0", color: "#0f172a", fontSize: "16px" }}>{asset.title}</h4>
              <p style={{ margin: "0 0 6px 0", fontSize: "13px", color: "#475569" }}>📍 {asset.location}</p>
              <p style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: "600", color: "#16a34a" }}>Valuation: $${asset.valuation.toLocaleString()}</p>
              <code style={{ fontSize: "10px", color: "#94a3b8", display: "block", wordBreak: "break-all" }}>{asset.contractId}</code>
            </div>
          ))
        )}
      </div>


      {/* My NFT Certificates Gallery Section (#788) */}
      <div className="nft-certificates-gallery" style={{ margin: "30px auto", padding: "24px", background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", maxWidth: "900px", textAlign: "left" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, color: "#0f172a", fontSize: "20px" }}>🎨 My NFT Share Certificates</h3>
          <button 
            onClick={fetchUserCertificates}
            disabled={loadingCerts || !walletAddress}
            style={{ padding: "6px 14px", background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}
          >
            {loadingCerts ? "🔄 Refreshing..." : "🔄 Refresh Gallery"}
          </button>
        </div>

        {!walletAddress ? (
          <div style={{ padding: "20px", background: "#f8fafc", borderRadius: "8px", color: "#64748b", textAlign: "center", fontSize: "14px" }}>
            🔒 Connect your Freighter wallet to view your owned NFT certificates.
          </div>
        ) : loadingCerts ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#2563eb", fontWeight: "600" }}>
            ⏳ Querying Soroban NFT contract for certificates...
          </div>
        ) : certError ? (
          <div style={{ padding: "16px", background: "#fef2f2", color: "#991b1b", borderRadius: "8px", fontSize: "14px" }}>
            ⚠️ {certError}
          </div>
        ) : certificates.length === 0 ? (
          <div style={{ padding: "30px", background: "#f8fafc", borderRadius: "8px", textAlign: "center", color: "#64748b" }}>
            <p style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "600" }}>No NFT Certificates Found</p>
            <p style={{ margin: 0, fontSize: "14px" }}>Purchase fractional shares to mint ownership certificates directly to your wallet.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "20px" }}>
            {certificates.map((cert) => (
              <div key={cert.id} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", overflow: "hidden", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <img src={cert.imageUrl} alt={cert.assetTitle} style={{ width: "100%", height: "150px", objectFit: "cover" }} />
                <div style={{ padding: "14px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#2563eb", background: "#dbeafe", padding: "2px 8px", borderRadius: "12px", textTransform: "uppercase" }}>{cert.id}</span>
                  <h4 style={{ margin: "8px 0 6px 0", fontSize: "15px", color: "#1e293b" }}>{cert.assetTitle}</h4>
                  <p style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#475569" }}>
                    <strong>Shares Held:</strong> {cert.sharesOwned}
                  </p>
                  <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#64748b" }}>
                    Minted: {cert.mintDate}
                  </p>
                  <code style={{ fontSize: "10px", color: "#94a3b8", display: "block", wordBreak: "break-all", background: "#f8fafc", padding: "4px", borderRadius: "4px" }}>
                    {cert.contractId.substring(0, 16)}...
                  </code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* RPC Network & Connectivity Resilience Alert (#790) */}
      {rpcError && (
        <div className="rpc-error-banner" style={{ margin: "16px auto", padding: "14px 18px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", maxWidth: "600px", textAlign: "left" }}>
          <h4 style={{ margin: "0 0 6px 0", color: "#991b1b", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
            ⚠️ {rpcError.startsWith("NETWORK_OUTAGE") ? "RPC Connectivity Issue" : "Smart Contract Exception"}
          </h4>
          <p style={{ margin: 0, color: "#7f1d1d", fontSize: "13px" }}>
            {rpcError.replace("NETWORK_OUTAGE: ", "").replace("CONTRACT_ERROR: ", "")}
          </p>
          <button onClick={simulateRpcCall} style={{ marginTop: "10px", padding: "6px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
            🔄 Retry Network Call
          </button>
        </div>
      )}
      {isRpcRetrying && (
        <div className="rpc-retrying-indicator" style={{ margin: "10px auto", color: "#d97706", fontSize: "13px", fontWeight: "600" }}>
          ⏳ Retrying connection to Soroban RPC endpoint (exponential backoff)...
        </div>
      )}


      {/* Official Contract Address & Verification Widget (#787) */}
      <div className="contract-verification-card" style={{ margin: "20px auto", padding: "16px 20px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #cbd5e1", maxWidth: "600px", textAlign: "left" }}>
        <h4 style={{ margin: "0 0 8px 0", color: "#1e293b", fontSize: "15px" }}>🛡️ Official Contract Verification</h4>
        <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#475569" }}>
          Active Contract ID: <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>{activeContractId}</code>
        </p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button 
            onClick={() => handleCopyContractId(activeContractId)}
            style={{ padding: "6px 12px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
          >
            {copiedContractId === activeContractId ? "✅ Copied to Clipboard!" : "📋 Copy Contract Address"}
          </button>
          <a 
            href="https://github.com/Code-Paragon/Tokenized-Fractional-/blob/main/docs/official-deployments.md" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ fontSize: "13px", color: "#2563eb", textDecoration: "underline" }}
          >
            Verify against Official Registry ↗
          </a>
        </div>
      {/* Wallet Connection Bar */}
      <div className="wallet-bar" style={{ padding: "12px 20px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "14px", fontWeight: "600", color: "#374151" }}>
          {isReconnecting ? "🔄 Reconnecting Wallet..." : walletAddress ? `Connected: ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}` : "Wallet Not Connected"}
        </span>
        {walletAddress ? (
          <button onClick={handleDisconnectWallet} style={{ padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>Disconnect</button>
        ) : (
          <button onClick={handleConnectWallet} style={{ padding: "6px 12px", background: "#2563eb", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>Connect Freighter Wallet</button>
        )}
      </div>

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
    hasNextPage,
    fetchNextPage,
  }) => {
    // Debounce the buyAmount setter to prevent rapid successive state updates
    // that could trigger redundant RPC calls or expensive recalculations
    const debouncedSetBuyAmount = useDebouncedCallback((val) => {
      setBuyAmount(val);
    }, 400); // 400ms debounce delay
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
            
            {/* ── Pending Transaction Recovery Alert (Issue #719) ─────────────────── */}
            {hasPendingTx && (
              <Alert variant="warning">
                {recoveringTx ? (
                  <>
                    <Spinner size="sm" label="Checking transaction status…" />
                    <span>Checking the status of your pending transaction…</span>
                  </>
                ) : (
                  <>
                    <span>You have a pending transaction from your previous session. </span>
                    <span style={{ fontWeight: 'bold' }}>Please wait for it to complete before starting a new purchase.</span>
                  </>
                )}
              </Alert>
            )}
            
            <h3 className={styles.purchaseHeader}>Buy Fractional Shares</h3>
            <div className={styles.purchaseRow}>
              <Input
                id="buy-amount-input"
                type="number"
                value={buyAmount}
                onChange={(e) => debouncedSetBuyAmount(Math.max(1, Number(e.target.value)))}
                min="1"
                disabled={loadingBuy || hasPendingTx}
                className={styles.buyInput}
              />
              <Button 
                onClick={handleBuyShares} 
                loading={loadingBuy} 
                disabled={hasPendingTx}
                variant="primary"
              >
                {loadingBuy ? 'Processing…' : hasPendingTx ? 'Pending Transaction' : 'Buy Shares'}
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
  // Search, Filter, and Sort State & URL Sync (#786)
  const [searchQuery, setSearchQuery] = React.useState("");
  const [assetTypeFilter, setAssetTypeFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("newest");
  const [filteredAssets, setFilteredAssets] = React.useState([]);

  // Mock asset catalog for searching and filtering
  const catalogAssets = [
    { contractId: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE", title: "Luxury Manhattan Condo Unit 12B", location: "New York, NY", assetType: "real_estate", valuation: 2500000, status: "approved", createdAt: "2026-06-01" },
    { contractId: "CC1234567890ABCDEFGHJKLMNOPQRSTUVWXYZ23456789ABCDEFGH", title: "Silicon Valley Tech Park Parcel A", location: "San Jose, CA", assetType: "real_estate", valuation: 8500000, status: "approved", createdAt: "2026-07-15" },
    { contractId: "CC9876543210FEDCBAZYXWVUTSRQPONMLKJIHGFEDCBA9876543210", title: "Solar Farm Infrastructure Alpha", location: "Austin, TX", assetType: "energy", valuation: 1200000, status: "approved", createdAt: "2026-08-10" }
  ];

  // Initialize state from URL query parameters on mount
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("search") || "";
    const type = params.get("type") || "all";
    const sort = params.get("sort") || "newest";

    setSearchQuery(q);
    setAssetTypeFilter(type);
    setSortBy(sort);
  }, []);

  // Update URL query parameters whenever filters change
  React.useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (assetTypeFilter !== "all") params.set("type", assetTypeFilter);
    if (sortBy !== "newest") params.set("sort", sortBy);

    const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
    window.history.replaceState({}, "", newUrl);

    // Apply filtering and sorting
    let result = [...catalogAssets];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(query) || a.location.toLowerCase().includes(query));
    }
    if (assetTypeFilter !== "all") {
      result = result.filter(a => a.assetType === assetTypeFilter);
    }
    if (sortBy === "valuation-asc") {
      result.sort((a, b) => a.valuation - b.valuation);
    } else if (sortBy === "valuation-desc") {
      result.sort((a, b) => b.valuation - a.valuation);
    } else if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    setFilteredAssets(result);
  }, [searchQuery, assetTypeFilter, sortBy]);

  // NFT Certificates Gallery State (#788)
  const [certificates, setCertificates] = React.useState([]);
  const [loadingCerts, setLoadingCerts] = React.useState(false);
  const [certError, setCertError] = React.useState("");

  const fetchUserCertificates = async () => {
    if (!walletAddress) {
      setCertificates([]);
      return;
    }
    setLoadingCerts(true);
    setCertError("");

    try {
      // Simulated NFT contract metadata query for owned certificates
      const mockCerts = [
        {
          id: "NFT-CERT-001",
          assetTitle: "Luxury Manhattan Condo Unit 12B",
          sharesOwned: 10,
          mintDate: "2026-09-12",
          imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80",
          contractId: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE"
        },
        {
          id: "NFT-CERT-002",
          assetTitle: "Silicon Valley Tech Park Parcel A",
          sharesOwned: 5,
          mintDate: "2026-10-01",
          imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80",
          contractId: "CC1234567890ABCDEFGHJKLMNOPQRSTUVWXYZ23456789ABCDEFGH"
        }
      ];

      setCertificates(mockCerts);
    } catch (err) {
      console.error("Failed to fetch NFT certificates:", err);
      setCertError("Unable to load certificates from the NFT contract.");
    } finally {
      setLoadingCerts(false);
    }
  };

  React.useEffect(() => {
    fetchUserCertificates();
  }, [walletAddress]);

  // RPC Resilience, Timeout & Retry Logic (#790)
  const [rpcError, setRpcError] = React.useState("");
  const [isRpcRetrying, setIsRpcRetrying] = React.useState(false);

  /**
   * Resilient RPC fetcher with explicit timeouts and exponential backoff.
   */
  const callRpcWithRetry = async (rpcFn, maxRetries = 3, timeoutMs = 5000) => {
    setRpcError("");
    setIsRpcRetrying(false);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("RPC Request Timeout")), timeoutMs)
        );

        // Race RPC call against explicit timeout
        const result = await Promise.race([rpcFn(), timeoutPromise]);
        return result;
      } catch (err) {
        console.warn(`RPC Call failed (Attempt ${attempt}/${maxRetries}):`, err.message);
        
        if (attempt === maxRetries) {
          if (err.message.includes("Timeout") || err.message.includes("NetworkError") || err.message.includes("Failed to fetch")) {
            setRpcError("NETWORK_OUTAGE: The Soroban RPC endpoint is unresponsive or timing out. Please try again later.");
          } else {
            setRpcError(`CONTRACT_ERROR: ${err.message}`);
          }
          throw err;
        }

        setIsRpcRetrying(true);
        // Exponential backoff delay (500ms, 1000ms, 2000ms...)
        const backoffDelay = Math.pow(2, attempt - 1) * 500;
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }
  };

  const simulateRpcCall = async () => {
    try {
      await callRpcWithRetry(async () => {
        // Simulated RPC operation
        return true;
      });
    } catch (err) {
      // Error handled in state
    }
  };

  // Contract Verification State (#787)
  const [copiedContractId, setCopiedContractId] = React.useState("");
  const activeContractId = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

  const handleCopyContractId = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedContractId(id);
    setTimeout(() => setCopiedContractId(""), 2500);
  // Auto-reconnect Wallet Effect (#785)
  const [walletAddress, setWalletAddress] = React.useState("");
  const [isReconnecting, setIsReconnecting] = React.useState(false);

  React.useEffect(() => {
    const autoReconnect = async () => {
      const previouslyConnected = localStorage.getItem("wallet_previously_connected");
      if (previouslyConnected === "true") {
        setIsReconnecting(true);
        try {
          if (window.freighterApi && typeof window.freighterApi.isConnected === "function") {
            const isConnected = await window.freighterApi.isConnected();
            if (isConnected) {
              const publicKey = await window.freighterApi.getPublicKey();
              if (publicKey) {
                setWalletAddress(publicKey);
                localStorage.setItem("wallet_previously_connected", "true");
              }
            }
          }
        } catch (err) {
          console.warn("Silent wallet reconnection failed, falling back to manual connect:", err);
          localStorage.removeItem("wallet_previously_connected");
        } finally {
          setIsReconnecting(false);
        }
      }
    };

    autoReconnect();
  }, []);

  const handleConnectWallet = async () => {
    try {
      if (window.freighterApi) {
        const publicKey = await window.freighterApi.getPublicKey();
        if (publicKey) {
          setWalletAddress(publicKey);
          localStorage.setItem("wallet_previously_connected", "true");
        }
      } else {
        // Fallback demo connection
        const mockAddress = "GBRPYHIL2CI3FNQ4BXLFMNDLFIM33A";
        setWalletAddress(mockAddress);
        localStorage.setItem("wallet_previously_connected", "true");
      }
    } catch (err) {
      console.error("Manual wallet connection error:", err);
    }
  };

  const handleDisconnectWallet = () => {
    setWalletAddress("");
    localStorage.removeItem("wallet_previously_connected");
  };

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

  // ── Wrong-network detection (Issue #714) ────────────────────────────────────
  // Freighter can be pointed at a different network than the one this app is
  // configured for. Detect it, warn the user, and refuse to build a purchase
  // transaction until they switch, instead of failing deep inside the RPC call.
  const {
    mismatch: networkMismatch,
    walletNetwork: freighterNetwork,
    expected: expectedNetworkLabel,
    checkNow: recheckNetwork,
  } = useNetworkMismatch({ enabled: Boolean(publicKey) });

  // ── Official contract deployment check (Issue #792) ─────────────────────────
  // Cross-check the build-time contract address against the signed canonical
  // manifest so a misconfigured or tampered build warns the user instead of
  // silently signing against an unexpected contract.
  const contractVerification = useContractManifest({
    contractId: CONTRACT_ID,
    network: NETWORK_PASSPHRASE,
  });

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
  const [loadingMeta] = useState(false);
  const [txError, setTxError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const [recoveringTx, setRecoveringTx] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const txStatus = useTransactionStatus(lastTxHash);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const navigate = useNavigate();
  const location = useLocation();

  // ── Pending Transaction Recovery (Issue #719) ─────────────────────────────
  // Handle recovery of transactions that may be in-flight when the user
  // refreshes the browser or navigates away during submission.
  const {
    pendingTx,
    setPendingTx,
    clearPendingTx,
    hasPendingTx,
    isExpired,
    checkPendingTxStatus,
  } = usePendingTransaction();

  // Debounce the buyAmount setter to prevent rapid successive state updates
  // that could trigger redundant RPC calls or expensive recalculations
  const debouncedSetBuyAmount = useDebouncedCallback((val) => {
    setBuyAmount(val);
  }, 400); // 400ms debounce delay

  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState('marketplace');
  // Issue #791/#793: wallet manager modal and the persisted preferences panel.
  const [walletManagerOpen, setWalletManagerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  // ── WebSocket for real-time updates (Issues #425, #426) ─────────────────────
  const wsUrl = `ws://${new URL(API_URL).host}/ws`;
  const { connected: wsConnected } = useGraphQLSubscription(wsUrl, {
    enabled: process.env.NODE_ENV !== 'test',
    reconnectAttempts: 5,
    reconnectDelay: 3000,
    onEvent: handleSubscriptionEvent,
  });

  // ── Favorites follow the connected wallet (Issue #905) ──────────────────────
  // Merges any anonymous favorites into the wallet's list on connect; see
  // useFavoritesStore for the full guest/wallet policy.
  useEffect(() => {
    useFavoritesStore.getState().setActiveWallet(publicKey || null);
  }, [publicKey]);

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
    },
  });

  // On-chain price per share. Read before the confirmation effect below, which
  // lists it as a dependency — reading it later in the body would hit the TDZ.
  const { data: priceData } = useSorobanRead('get_price', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const pricePerShare = priceData?.retval ? Number(priceData.retval.u64()) : null;

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

      // Clear pending transaction marker on successful confirmation
      clearPendingTx();

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
      
      // Clear pending transaction marker on failure
      clearPendingTx();
    }
  }, [lastTxHash, txStatus, publicKey, pricePerShare, clearPendingTx]);

  // ── Pending Transaction Recovery Check (Issue #719) ─────────────────────
  // On page load, check if there's a pending transaction and attempt recovery
  useEffect(() => {
    if (!hasPendingTx || !publicKey || recoveringTx) return;

    const recoverTransaction = async () => {
      setRecoveringTx(true);
      try {
        const status = await checkPendingTxStatus();
        
        if (!status) {
          // Couldn't check status, but clear the marker to avoid blocking
          clearPendingTx();
          setRecoveringTx(false);
          return;
        }

        if (status.status === 'confirmed') {
          // Transaction was confirmed while we were away
          addToast({
            message: 'Your previous transaction was confirmed! Refreshing your balance...',
            type: 'success',
            txHash: status.txHash,
          });
          setLastTxHash(status.txHash);
          clearPendingTx();
          fetchShares();
        } else if (status.status === 'failed') {
          // Transaction failed while we were away
          addToast({
            message: 'Your previous transaction failed. You can try again.',
            type: 'error',
            txHash: status.txHash,
          });
          clearPendingTx();
        } else if (status.status === 'pending') {
          // Transaction is still pending, continue monitoring
          addToast({
            message: 'Detecting a pending transaction from your previous session. Monitoring for confirmation...',
            type: 'warning',
            txHash: status.txHash,
          });
          setLastTxHash(status.txHash);
        } else {
          // Unknown status, clear to avoid blocking
          addToast({
            message: 'Unable to determine the status of your previous transaction. You can try again.',
            type: 'warning',
          });
          clearPendingTx();
        }
      } catch (error) {
        console.error('Transaction recovery failed:', error);
        // Clear the marker to avoid blocking the user
        clearPendingTx();
      } finally {
        setRecoveringTx(false);
      }
    };

    recoverTransaction();
  }, [hasPendingTx, publicKey, checkPendingTxStatus, clearPendingTx, fetchShares, addToast]);

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

  const handleBuyShares = useCallback(async (purchaseDetails) => {
    if (!publicKey) return;
    if (networkMismatch) {
      addToast({
        message: `Freighter is on the wrong network. Switch it to ${expectedNetworkLabel} and try again.`,
        type: 'error',
      });
      recheckNetwork();
      return;
    }
    
    // Prevent new purchase if there's already a pending transaction
    if (hasPendingTx) {
      addToast({
        message: 'You have a pending transaction. Please wait for it to complete before starting a new purchase.',
        type: 'error',
      });
      return;
    }
    
    setTxResult(null);
    setLastTxHash(null);
    try {
      const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
      const scValShares = nativeToScVal(purchaseDetails.amount, { type: 'u32' });
      const scValToken = nativeToScVal(paymentToken, { type: 'address' });

      // Store purchase details for WebSocket broadcast on confirmation
      lastPurchaseRef.current = { amount: purchaseDetails.amount, timestamp: Date.now() };

      // Set pending transaction marker before submission (Issue #719)
      setPendingTx({
        txHash: null, // Will be set after submission
        amount: purchaseDetails.amount,
        contractId: CONTRACT_ID,
        publicKey,
      });

      const submitRes = await buySharesTx.execute([scValBuyer, scValShares, scValToken]);
      const { hash } = submitRes;
      setLastTxHash(hash);
      
      // Update pending transaction with the actual hash
      setPendingTx({
        txHash: hash,
        amount: purchaseDetails.amount,
        contractId: CONTRACT_ID,
        publicKey,
      });
      
      pendingToastRef.current = addToast({ message: TX_SUBMITTED, type: 'pending', txHash: hash });
      return { txHash: hash };
    } catch (err) {
      // Clear pending transaction marker on submission error
      clearPendingTx();
      addToast(toToastError(err, { operation: 'buy_shares' }));
      throw err;
    }
  }, [publicKey, networkMismatch, expectedNetworkLabel, recheckNetwork, hasPendingTx, paymentToken, buySharesTx, addToast, clearPendingTx]);

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
            <NetworkBadge />
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
            <WalletAddressBadge
              publicKey={publicKey}
              onManage={() => setWalletManagerOpen(true)}
              onDisconnect={disconnectWallet}
              disconnectLabel={t('wallet.disconnect')}
            />
          )}
        </div>
      </header>

      {/* ── Wrong-network warning (Issue #714) ──────────────────────────────── */}
      <NetworkMismatchBanner
        mismatch={networkMismatch}
        expected={expectedNetworkLabel}
        walletNetwork={freighterNetwork}
        onRetry={recheckNetwork}
      />

      {/* ── Official contract deployment warning (Issue #792) ───────────────── */}
      <ContractVerificationBanner
        status={contractVerification.status}
        reason={contractVerification.reason}
        configuredContractId={contractVerification.contractId}
        manifestUrl={contractVerification.manifestUrl}
      />

      {/* ── Tab Navigation ──────────────────────────────────────────────────── */}
      <nav className={styles.tabs}>
        <button
          className={`${styles.tab} ${view === 'marketplace' || view === 'asset-detail' ? styles.tabActive : ''}`}
          onClick={() => setView('marketplace')}
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
        <button
          className={`${styles.tab} ${preferencesOpen ? styles.tabActive : ''}`}
          onClick={() => setPreferencesOpen(true)}
        >
          Preferences
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
                  hasPendingTx={hasPendingTx}
                  recoveringTx={recoveringTx}
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


      {/* Wallet manager modal (Issue #791) */}
      <Suspense fallback={null}>
        <WalletManager isOpen={walletManagerOpen} onClose={() => setWalletManagerOpen(false)} />
      </Suspense>

      {/* Preferences panel (Issue #793) */}
      <PreferencesPanel open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />

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

      {/* ── Footer (Issue #797: link to the independent public status page) ── */}
      <Footer />
    </div>
  );
}

export default App;
