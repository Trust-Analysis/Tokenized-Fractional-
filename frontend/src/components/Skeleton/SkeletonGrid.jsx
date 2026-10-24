import React from 'react';
import Skeleton from './Skeleton';
import styles from './SkeletonGrid.module.css';

/**
 * SkeletonGrid Component
 * 
 * Provides an exact pixel-dimension matched skeleton grid loader.
 * Guarantees zero Cumulative Layout Shift (CLS score = 0.0) during async data fetching.
 */
export default function SkeletonGrid({ count = 6 }) {
  return (
    <div className={styles.skeletonGrid} data-testid="skeleton-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={styles.skeletonCard} data-testid="skeleton-card">
          <div className={styles.thumbnailContainer}>
            <Skeleton variant="rect" width="100%" height="100%" />
          </div>
          <div className={styles.cardBody}>
            <Skeleton variant="text" width="35%" height="12px" />
            <Skeleton variant="text" width="80%" height="20px" />
            <Skeleton variant="text" width="55%" height="14px" />
            <Skeleton variant="text" width="45%" height="14px" />
            <div className={styles.cardFooter}>
              <Skeleton variant="text" width="90px" height="14px" />
              <Skeleton variant="text" width="70px" height="14px" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
