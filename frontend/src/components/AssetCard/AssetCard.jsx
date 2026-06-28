import React from 'react';
import Card from '../Card/Card';
import styles from './AssetCard.module.css';

/**
 * AssetCard — displays a single RWA asset in a card format
 * with image, title, location, valuation, and a "Buy Shares" action.
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
  if (!asset) return null;

  const { imageUrl, title, location, totalValuation, contractId, assetType } =
    asset;

  return (
    <Card hoverable className={styles.assetCard}>
      {imageUrl ? (
        <div className={styles.imageWrapper}>
          <img
            src={imageUrl}
            alt={title || 'Asset'}
            className={styles.image}
            loading="lazy"
          />
        </div>
      ) : (
        <div className={styles.imagePlaceholder}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      <div className={styles.body}>
        {assetType && <span className={styles.assetType}>{assetType}</span>}

        <h3 className={styles.title}>{title || 'Untitled Asset'}</h3>

        {location && (
          <p className={styles.location}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.icon}
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {location}
          </p>
        )}

        {totalValuation && (
          <p className={styles.valuation}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.icon}
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
      </div>
    </Card>
  );
}
