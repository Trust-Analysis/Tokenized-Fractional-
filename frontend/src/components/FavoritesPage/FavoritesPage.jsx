import React from 'react';
import Button from '../Button/Button';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import styles from './FavoritesPage.module.css';

/**
 * FavoritesPage — shows all bookmarked/favorited assets in a grid.
 * Users can remove individual favorites or clear all at once.
 */
export default function FavoritesPage() {
  const { favorites, removeFavorite, clearFavorites } = useFavoritesStore();

  if (favorites.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon} aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
        </div>
        <p className={styles.emptyTitle}>No favorites yet</p>
        <p className={styles.emptySubtitle}>
          Click the <strong>★</strong> bookmark button on any asset card to save it here for quick access.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className={styles.titleIcon} aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
            </svg>
            Favorites
          </h2>
          <span className={styles.favoriteCount}>
            {favorites.length} asset{favorites.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Button onClick={clearFavorites} variant="danger" size="sm">
          Clear All
        </Button>
      </div>

      {/* Favorites grid */}
      <div className={styles.grid}>
        {favorites.map((asset) => (
          <FavoriteCard key={asset.contractId} asset={asset} onRemove={removeFavorite} />
        ))}
      </div>
    </div>
  );
}

/**
 * FavoriteCard — individual favorited asset card with a remove button.
 */
function FavoriteCard({ asset, onRemove }) {
  const {
    imageUrl,
    title,
    location,
    totalValuation,
    contractId,
    assetType,
  } = asset;

  return (
    <div className={styles.card}>
      {/* Image */}
      {imageUrl ? (
        <div className={styles.imageWrapper}>
          <img src={imageUrl} alt={title || 'Asset'} className={styles.image} loading="lazy" />
        </div>
      ) : (
        <div className={styles.imagePlaceholder} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      <div className={styles.body}>
        {assetType && <span className={styles.assetType}>{assetType}</span>}
        <h3 className={styles.cardTitle}>{title || 'Untitled Asset'}</h3>

        {location && (
          <p className={styles.location}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {location}
          </p>
        )}

        {totalValuation && (
          <p className={styles.valuation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {totalValuation}
          </p>
        )}

        <div className={styles.footer}>
          {contractId && (
            <span className={styles.contractId} title={contractId}>
              {contractId.slice(0, 8)}…{contractId.slice(-6)}
            </span>
          )}
          <button
            className={styles.removeBtn}
            onClick={() => onRemove(contractId)}
            aria-label={`Remove ${title || 'asset'} from favorites`}
            title="Remove from favorites"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
