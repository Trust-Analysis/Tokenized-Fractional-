import React from 'react';
import Skeleton from './Skeleton';
import styles from './Skeleton.module.css';

/**
 * OrderBookSkeleton — animated placeholder that mirrors the OrderBook layout
 * (Issue #572).
 *
 * The skeleton reproduces the order book's header, buy/sell section headers
 * and 48px-high rows, and reserves the same vertical footprint as the loaded
 * virtualized lists (420px per section), so swapping from skeleton to data
 * does not cause Cumulative Layout Shift (CLS).
 *
 * @param {number} rows - Number of skeleton rows per section (default 6).
 */
export default function OrderBookSkeleton({ rows = 6 }) {
  return (
    <div className={styles.orderBookSkeleton} role="status" aria-label="Loading order book">
      {/* Buy Orders */}
      <div className={styles.orderBookSection}>
        <Skeleton variant="text" width="120px" height="0.875rem" />
        <div className={styles.orderBookRows}>
          {Array.from({ length: rows }).map((_, i) => (
            <div className={styles.orderRowSkeleton} key={`buy-${i}`}>
              <div className={styles.orderRowSkeletonInfo}>
                <Skeleton variant="text" width="90px" height="0.875rem" />
                <Skeleton variant="text" width="140px" height="0.75rem" />
              </div>
              <Skeleton variant="text" width="70px" height="0.75rem" />
            </div>
          ))}
        </div>
      </div>

      {/* Sell Orders */}
      <div className={styles.orderBookSection}>
        <Skeleton variant="text" width="120px" height="0.875rem" />
        <div className={styles.orderBookRows}>
          {Array.from({ length: rows }).map((_, i) => (
            <div className={styles.orderRowSkeleton} key={`sell-${i}`}>
              <div className={styles.orderRowSkeletonInfo}>
                <Skeleton variant="text" width="90px" height="0.875rem" />
                <Skeleton variant="text" width="140px" height="0.75rem" />
              </div>
              <Skeleton variant="text" width="70px" height="0.75rem" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
