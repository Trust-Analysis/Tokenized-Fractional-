import React, { useState } from 'react';
import Card from '../Card/Card';
import PriceHistoryModal from '../PriceHistoryChart/PriceHistoryModal';
import { useComparisonStore } from '../../store/useComparisonStore';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import styles from './AssetCard.module.css';

/**
 * AssetCard — displays a single RWA asset in a card format
 * with image, title, location, valuation, a "Buy Shares" action,
 * a Compare checkbox (issue #190), and a Bookmark/Favorite button (issue #187).
 * Also includes a price history chart view.
 *
 * @param {Object}  asset            - Asset metadata object
 * @param {string}  asset.imageUrl   - URL to the asset image
 * @param {string}  asset.title      - Asset title
 * @param {string}  asset.location   - Asset location
 * @param {string}  asset.totalValuation - Valuation string
 * @param {string}  asset.contractId - On-chain contract ID
 * @param {string}  asset.assetType  - Type of asset
 */
export default function AssetCard({ asset }) {
  const [showPriceHistory, setShowPriceHistory] = useState(false);

  if (!asset) return null;

  const {
    imageUrl,
    title,
    location,
    totalValuation,
    contractId,
    assetType,
  } = asset;

  // ── Comparison (issue #190) ───────────────────────────────────────────────
  const { toggleComparison, isCompared, comparedAssets, MAX_COMPARISON } = useComparisonStore();
  const compared = isCompared(contractId);
  const atMax = !compared && comparedAssets.length >= MAX_COMPARISON;

  const handleCompareChange = (e) => {
    e.stopPropagation();
    toggleComparison(asset);
  };

  // ── Favorites/Bookmarks (issue #187) ────────────────────────────────────
  const { toggleFavorite, isFavorited } = useFavoritesStore();
  const favorited = isFavorited(contractId);

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    toggleFavorite(asset);
  };

  // ── Price History ───────────────────────────────────────────────────────
  const handleOpenPriceHistory = (e) => {
    e.stopPropagation();
    setShowPriceHistory(true);
  };

  const handleClosePriceHistory = () => {
    setShowPriceHistory(false);
  };

  return (
    <>
      <Card hoverable className={styles.assetCard}>
        {imageUrl ? (
          <div className={styles.imageWrapper}>
            <img
              src={imageUrl}
              alt={title || 'Asset'}
              className={styles.image}
              loading="lazy"
            />
            {/* Bookmark button overlaid on image */}
            <button
              className={`${styles.bookmarkBtn} ${favorited ? styles.bookmarkActive : ''}`}
              onClick={handleFavoriteClick}
              aria-label={favorited ? `Remove ${title || 'asset'} from favorites` : `Add ${title || 'asset'} to favorites`}
              title={favorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={favorited ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
              </svg>
            </button>

            {/* Price history chart button */}
            <button
              className={styles.chartBtn}
              onClick={handleOpenPriceHistory}
              title="View price history chart"
              aria-label={`View price history chart for ${title || 'asset'}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
            </button>
          </div>
        ) : (
          <div className={styles.imagePlaceholder}>
            {/* Bookmark button for cards without image */}
            <button
              className={`${styles.bookmarkBtnFloat} ${favorited ? styles.bookmarkActive : ''}`}
              onClick={handleFavoriteClick}
              aria-label={favorited ? `Remove ${title || 'asset'} from favorites` : `Add ${title || 'asset'} to favorites`}
              title={favorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={favorited ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
              </svg>
            </button>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
        )}

        <div className={styles.body}>
          {assetType && (
            <span className={styles.assetType}>{assetType}</span>
          )}

          <h3 className={styles.title}>{title || 'Untitled Asset'}</h3>

          {location && (
            <p className={styles.location}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon} aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              {location}
            </p>
          )}

          {totalValuation && (
            <p className={styles.valuation}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.icon} aria-hidden="true">
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
              {totalValuation}
            </p>
          )}

          <div className={styles.footer}>
            {contractId && (
              <span className={styles.contractId} title={contractId}>
                {contractId.slice(0, 10)}…{contractId.slice(-6)}
              </span>
            )}
            <span className={styles.buyLabel}>Buy Shares →</span>
          </div>

          {/* Action buttons section */}
          <div className={styles.actionsSection}>
            {/* Price history button */}
            <button
              className={styles.actionButton}
              onClick={handleOpenPriceHistory}
              title="View price history"
              aria-label={`View price history for ${title || 'asset'}`}
            >
              📈 Price History
            </button>

            {/* ── Compare checkbox (issue #190) ───────────────────────────── */}
            <label
              className={`${styles.compareLabel} ${atMax ? styles.compareLabelDisabled : ''}`}
              title={atMax ? `Maximum ${MAX_COMPARISON} assets can be compared` : 'Compare this asset'}
            >
              <input
                type="checkbox"
                className={styles.compareCheckbox}
                checked={compared}
                onChange={handleCompareChange}
                disabled={atMax}
                aria-label={`Compare ${title || 'this asset'}`}
              />
              <span className={styles.compareText}>Compare</span>
            </label>
          </div>
        </div>
      </Card>

      {/* Price History Modal */}
      <PriceHistoryModal
        isOpen={showPriceHistory}
        onClose={handleClosePriceHistory}
        asset={asset}
      />
    </>
  );
}
