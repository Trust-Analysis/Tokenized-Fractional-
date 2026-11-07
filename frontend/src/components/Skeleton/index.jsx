import React from 'react';
import Skeleton from './Skeleton';
import styles from './Skeleton.module.css';

/**
 * TextSkeleton — convenience wrapper for one or more lines of text skeleton.
 *
 * @param {number} lines  - Number of text lines to render (default 1).
 * @param {string} width  - CSS width override for single-line variant.
 * @param {string} height - CSS height override.
 */
export function TextSkeleton({ lines = 1, width, height, style, className, ...rest }) {
  return (
    <Skeleton
      variant="text"
      lines={lines}
      width={width}
      height={height}
      style={style}
      className={className}
      {...rest}
    />
  );
}

/**
 * ImageSkeleton — convenience wrapper for an image / rect placeholder.
 *
 * @param {string} width  - CSS width (default '100%').
 * @param {string} height - CSS height (default '180px').
 */
export function ImageSkeleton({ width = '100%', height = '180px', style, className, ...rest }) {
  return (
    <Skeleton
      variant="rect"
      width={width}
      height={height}
      style={style}
      className={className}
      {...rest}
    />
  );
}

/**
 * AssetCardSkeleton — animated placeholder matching the AssetCard layout.
 * Shown while asset data is being fetched.
 */
export function AssetCardSkeleton() {
  return (
    <div className={styles.assetCardSkeleton}>
      <div className={styles.skeletonImage}>
        <Skeleton variant="rect" height="100%" />
      </div>
      <div className={styles.skeletonBody}>
        <Skeleton variant="text" width="30%" height="0.75rem" />
        <Skeleton variant="text" width="75%" height="1.1em" />
        <Skeleton variant="text" width="50%" height="0.9em" />
        <Skeleton variant="text" width="40%" height="0.9em" />
        <div className={styles.skeletonFooter}>
          <Skeleton variant="text" width="90px" height="0.75rem" />
          <Skeleton variant="text" width="70px" height="0.75rem" />
        </div>
      </div>
    </div>
  );
}

/**
 * TransactionRowSkeleton — placeholder for transaction list items.
 */
export function TransactionRowSkeleton() {
  return (
    <div className={styles.transactionRow}>
      <div className={styles.transactionIcon}>
        <Skeleton variant="circle" width="40px" height="40px" />
      </div>
      <div className={styles.transactionDetails}>
        <Skeleton variant="text" width="60%" height="0.9em" />
        <Skeleton variant="text" width="40%" height="0.75rem" />
      </div>
      <div className={styles.transactionAmount}>
        <Skeleton variant="text" width="80px" height="0.9em" />
      </div>
    </div>
  );
}

/**
 * TransactionListSkeleton — placeholder for transaction history list.
 */
export function TransactionListSkeleton({ rows = 5 }) {
  return (
    <div className={styles.transactionList}>
      {Array.from({ length: rows }).map((_, i) => (
        <TransactionRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * ProfileHeaderSkeleton — placeholder for user profile header.
 */
export function ProfileHeaderSkeleton() {
  return (
    <div className={styles.profileHeader}>
      <div className={styles.profileAvatar}>
        <Skeleton variant="circle" width="80px" height="80px" />
      </div>
      <div className={styles.profileInfo}>
        <Skeleton variant="text" width="200px" height="1.2em" />
        <Skeleton variant="text" width="150px" height="0.9em" />
        <Skeleton variant="text" width="120px" height="0.75rem" />
      </div>
    </div>
  );
}

/**
 * ProfileStatsSkeleton — placeholder for profile statistics.
 */
export function ProfileStatsSkeleton() {
  return (
    <div className={styles.profileStats}>
      <Skeleton variant="rect" height="100px" />
      <Skeleton variant="rect" height="100px" />
      <Skeleton variant="rect" height="100px" />
    </div>
  );
}

export { default as OrderBookSkeleton } from './OrderBookSkeleton';
export { default as SkeletonGrid } from './SkeletonGrid';
