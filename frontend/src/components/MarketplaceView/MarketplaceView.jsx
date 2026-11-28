import React, { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '../Card/Card';
import Alert from '../Alert/Alert';
import AssetGrid from '../AssetGrid/AssetGrid';
import BuyShares from '../BuyShares/BuyShares';
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary';
import PriceRangeFilter from '../PriceRangeFilter/PriceRangeFilter';
import OptimizedImage from '../OptimizedImage/OptimizedImage';
import LazyFallback from '../LazyFallback/LazyFallback';
import MarketplaceSearch from '../MarketplaceSearch/MarketplaceSearch';
import CertificateGallery from '../CertificateGallery/CertificateGallery';
import RpcResilienceBanner from '../RpcResilienceBanner/RpcResilienceBanner';
import ContractVerificationCard from '../ContractVerificationCard/ContractVerificationCard';
import WalletConnectionBar from '../WalletConnectionBar/WalletConnectionBar';
import styles from '../../App.module.css';
import { CONTRACT_ID, API_URL } from '../../constants/app';
import { CONTRACT_NOT_CONFIGURED } from '../../constants/errors';

const VirtualTour = lazy(() => import('../VirtualTour/VirtualTour'));
const NewsSection = lazy(() => import('../NewsSection/NewsSection'));
const PriceAlert = lazy(() => import('../PriceAlert/PriceAlert'));
const InvestmentCalculator = lazy(() => import('../InvestmentCalculator/InvestmentCalculator'));

/**
 * Marketplace route: wallet/demo panels, asset metadata and grid, purchase
 * card, alerts, calculator, and news.
 */
export default function MarketplaceView({
  publicKey,
  walletError,
  assetMeta,
  assets,
  isFetchingAssets,
  assetsError,
  hasNextPage,
  fetchNextPage,
  shares,
  loadingShares,
  buyAmount,
  setBuyAmount,
  loadingBuy,
  handleBuyShares,
  pricePerShare,
  acceptedTokens,
  paymentToken,
  setPaymentToken,
  availableShares,
  totalShares,
  hasPendingTx,
  recoveringTx,
  walletAddress,
  isReconnecting,
  onConnectFreighter,
  onDisconnectFreighter,
}) {
  const { t } = useTranslation();
  const [priceRangeFilter, setPriceRangeFilter] = useState(null);

  // Price bounds come from the loaded assets; zero-priced assets fall back to 0.
  const prices = assets
    .map((asset) => Number(asset.price ?? asset.pricePerShare ?? 0))
    .filter((price) => price > 0);
  const absoluteMin = prices.length ? Math.min(...prices) : 0;
  const absoluteMax = prices.length ? Math.max(...prices) : 10_000;
  const [filterMin, filterMax] = priceRangeFilter ?? [absoluteMin, absoluteMax];

  const filteredAssets =
    priceRangeFilter && prices.length > 0
      ? assets.filter((asset) => {
          const price = Number(asset.price ?? asset.pricePerShare ?? 0);
          // Keep assets without price data visible.
          if (price === 0) return true;
          return price >= filterMin && price <= filterMax;
        })
      : assets;

  return (
    <>
      {walletError && <Alert variant="error">{walletError}</Alert>}
      {CONTRACT_ID === 'C...' && <Alert variant="warning">{CONTRACT_NOT_CONFIGURED}</Alert>}

      <WalletConnectionBar
        walletAddress={walletAddress}
        isReconnecting={isReconnecting}
        onConnect={onConnectFreighter}
        onDisconnect={onDisconnectFreighter}
      />

      <MarketplaceSearch />

      <CertificateGallery walletAddress={walletAddress} />

      <RpcResilienceBanner />

      <ContractVerificationCard />

      {/* ── Asset Metadata Card ─────────────────────────────────────────── */}
      <ErrorBoundary moduleName="Featured Asset">
        {assetMeta ? (
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
              <Suspense fallback={<LazyFallback />}>
                <VirtualTour imageUrl={assetMeta.imageUrl} title={assetMeta.title} />
              </Suspense>
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
                aria-hidden="true"
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
                  aria-hidden="true"
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
        </section>
      </ErrorBoundary>

      {/* ── News & Updates Section (Issue #191) ─────────────────────────── */}
      <ErrorBoundary moduleName="Marketplace News">
        <Suspense fallback={<LazyFallback />}>
          <NewsSection />
        </Suspense>
      </ErrorBoundary>

      <div className="tour-order-book">
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
  );
}
