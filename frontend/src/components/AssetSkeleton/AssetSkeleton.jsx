import React from 'react';
import Skeleton from '../Skeleton/Skeleton';
import styles from './AssetSkeleton.module.css';

/**
 * AssetSkeleton — Shows loading placeholders for asset metadata and pricing.
 *
 * Displays skeleton UI while Soroban RPC read calls are in-flight:
 *   - Asset title and description
 *   - Share price
 *   - Share count (user holdings)
 *   - Asset valuation
 *
 * Uses the same shimmer animation as the main Skeleton component
 * for visual consistency across the app.
 */
export default function AssetSkeleton() {
  return (
    <div className={styles.container}>
      {/* Asset Metadata Card Skeleton */}
      <div className={styles.card}>
        {/* Image placeholder */}
        <div className={styles.imageWrapper}>
          <Skeleton variant="rect" height="200px" />
        </div>

        {/* Title */}
        <div className={styles.titleSection}>
          <Skeleton variant="text" height="1.8em" width="75%" />
        </div>

        {/* Location */}
        <div className={styles.locationSection}>
          <div className={styles.locationIcon}>📍</div>
          <Skeleton variant="text" height="1em" width="60%" />
        </div>

        {/* Description */}
        <div className={styles.descriptionSection}>
          <Skeleton variant="text" lines={3} />
        </div>

        {/* Valuation */}
        <div className={styles.valuationSection}>
          <div className={styles.valuationIcon}>💰</div>
          <Skeleton variant="text" height="1.1em" width="50%" />
        </div>
      </div>

      {/* Share Price Section Skeleton */}
      <div className={styles.card}>
        <div className={styles.priceHeader}>
          <Skeleton variant="text" height="1.2em" width="40%" />
        </div>
        <div className={styles.priceValue}>
          <Skeleton variant="text" height="2em" width="60%" />
        </div>
      </div>

      {/* Holdings + Buy Card Skeleton */}
      <div className={styles.card}>
        {/* Share Balance Row */}
        <div className={styles.holdingsRow}>
          <Skeleton variant="text" height="1em" width="40%" />
          <Skeleton variant="text" height="1.6em" width="30%" />
        </div>

        <div className={styles.divider} />

        {/* Buy Section */}
        <div className={styles.buyHeader}>
          <Skeleton variant="text" height="1.2em" width="50%" />
        </div>

        <div className={styles.buyRow}>
          <div className={styles.inputPlaceholder}>
            <Skeleton variant="rect" height="44px" />
          </div>
          <div className={styles.buttonPlaceholder}>
            <Skeleton variant="rect" height="44px" width="120px" />
          </div>
        </div>

        {/* Buy loading hint */}
        <div className={styles.loadingHint}>
          <Skeleton variant="text" lines={2} height="0.9em" />
        </div>
      </div>
    </div>
  );
}
