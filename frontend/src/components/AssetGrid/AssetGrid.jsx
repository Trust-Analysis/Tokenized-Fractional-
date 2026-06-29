import React from 'react';
import AssetCard from '../AssetCard/AssetCard';
import AssetCardSkeleton from '../Skeleton/AssetCardSkeleton';
import Card from '../Card/Card';
import styles from './AssetGrid.module.css';

/**
 * AssetGrid — responsive grid of AssetCards.
 *
 * @param {Array}    assets       - Array of asset metadata objects
 * @param {boolean}  loading      - Is data being fetched?
 * @param {string}   error        - Error message if fetch failed
 * @param {boolean}  isEmpty      - True when fetch succeeded but returned 0 assets
 */
export default function AssetGrid({ assets = [], loading = false, error = null, isEmpty = false }) {
  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.stateContainer}>
        <div className={styles.stateIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <p className={styles.stateText}>Failed to load assets</p>
        <p className={styles.stateSubtext}>{error}</p>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (isEmpty || assets.length === 0) {
    return (
      <div className={styles.stateContainer}>
        <div className={styles.stateIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
        </div>
        <p className={styles.stateText}>No assets available</p>
        <p className={styles.stateSubtext}>Check back later for new listings.</p>
      </div>
    );
  }

  // ── Normal state ───────────────────────────────────────────────────────
  return (
    <div className={styles.grid}>
      {assets.map((asset) => (
        <AssetCard key={asset.contractId} asset={asset} />
      ))}
    </div>
  );
}
