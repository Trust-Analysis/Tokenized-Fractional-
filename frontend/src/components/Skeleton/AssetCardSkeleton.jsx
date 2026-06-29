import React from 'react';
import Card from '../Card/Card';
import Skeleton from './Skeleton';
import styles from '../AssetCard/AssetCard.module.css';
import gridStyles from '../AssetGrid/AssetGrid.module.css';

/**
 * AssetCardSkeleton — animated placeholder matching the AssetCard layout.
 * Shown while asset data is being fetched.
 */
export default function AssetCardSkeleton() {
  return (
    <Card className={styles.assetCard}>
      {/* Image area */}
      <div className={gridStyles.skeletonImage}>
        <Skeleton variant="rect" height="100%" style={{ borderRadius: 0 }} />
      </div>

      {/* Body area */}
      <div className={`${styles.body} ${gridStyles.skeletonBody}`}>
        {/* assetType */}
        <Skeleton variant="text" width="30%" height="0.75rem" />
        {/* title */}
        <Skeleton variant="text" width="75%" height="1.1em" />
        {/* location */}
        <Skeleton variant="text" width="50%" height="0.9em" />
        {/* valuation */}
        <Skeleton variant="text" width="40%" height="0.9em" />
        {/* footer */}
        <div className={styles.footer}>
          <Skeleton variant="text" width="90px" height="0.75rem" />
          <Skeleton variant="text" width="70px" height="0.75rem" />
        </div>
      </div>
    </Card>
  );
}
