import React, { useState, useId } from 'react';
import { useFavoritesStore } from '../../store/useFavoritesStore';
import AssetGrid from '../AssetGrid/AssetGrid';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Card from '../Card/Card';
import styles from './WatchlistManager.module.css';

/**
 * WatchlistManager Component (#277)
 */
export default function WatchlistManager({ walletAddress }) {
  const {
    favorites,
    categories,
    notifications,
    removeFavorite,
    createCategory,
    deleteCategory,
    exportWatchlist,
    getShareableLink,
  } = useFavoritesStore();

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('addedAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [showCatModal, setShowCatModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const categoryFilterSelectId = useId();
  const sortBySelectId = useId();
  const sortOrderSelectId = useId();

  // Filter items
  let filtered = favorites;

  if (selectedCategory !== 'all') {
    filtered = filtered.filter((item) =>
      Array.isArray(item.categories) && item.categories.includes(selectedCategory)
    );
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.location && item.location.toLowerCase().includes(q)) ||
        (item.assetType && item.assetType.toLowerCase().includes(q))
    );
  }

  // Sort items
  filtered = [...filtered].sort((a, b) => {
    let valA = a[sortBy] || 0;
    let valB = b[sortBy] || 0;
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const handleCreateCategory = (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    createCategory(newCatName.trim());
    setNewCatName('');
    setShowCatModal(false);
  };

  const handleExport = (format) => {
    const content = exportWatchlist(format);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchlist_${walletAddress || 'guest'}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyShareLink = () => {
    const link = getShareableLink();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  return (
    <div className={styles.watchlistContainer}>
      {/* ── Header & Action Bar ── */}
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.title}>My Watchlist & Favorites</h2>
          <span className={styles.subtitle}>
            Wallet: <code>{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Guest Mode'}</code>
          </span>
        </div>

        <div className={styles.actionGroup}>
          <Button variant="secondary" onClick={() => handleExport('json')}>
            Export JSON
          </Button>
          <Button variant="secondary" onClick={() => handleExport('csv')}>
            Export CSV
          </Button>
          <Button variant="primary" onClick={handleCopyShareLink}>
            {copiedLink ? '✓ Link Copied!' : 'Share Watchlist 🔗'}
          </Button>
        </div>
      </div>

      {/* ── Notification Alerts Banner (#277) ── */}
      {notifications.length > 0 && (
        <div className={styles.alertsBanner}>
          <h4>🔔 Price & Availability Updates ({notifications.length})</h4>
          <ul className={styles.alertsList}>
            {notifications.slice(0, 3).map((n) => (
              <li key={n.id} className={styles.alertItem}>
                <span>{n.message}</span>
                <span className={styles.alertTime}>{new Date(n.timestamp).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Filter & Categories Bar ── */}
      <Card className={styles.filterCard}>
        <div className={styles.filterRow}>
          <div className={styles.searchBox}>
            <Input
              type="search"
              placeholder="Search in watchlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className={styles.selectGroup}>
            <label htmlFor={categoryFilterSelectId} className={styles.selectLabel}>Category:</label>
            <select
              id={categoryFilterSelectId}
              className={styles.selectInput}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Watchlists ({favorites.length})</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            <label htmlFor={sortBySelectId} className={styles.selectLabel}>Sort By:</label>
            <select
              id={sortBySelectId}
              className={styles.selectInput}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="addedAt">Date Added</option>
              <option value="pricePerShare">Price</option>
              <option value="availableShares">Available Shares</option>
              <option value="title">Asset Title</option>
            </select>

            <select
              id={sortOrderSelectId}
              className={styles.selectInput}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>

            <Button variant="secondary" onClick={() => setShowCatModal(true)}>
              + New Category
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Create Category Modal ── */}
      {showCatModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>Create Custom Watchlist Category</h3>
            <form onSubmit={handleCreateCategory}>
              <Input
                placeholder="Category Name (e.g. Dividend Yielders)"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                autoFocus
              />
              <div className={styles.modalActions}>
                <Button variant="secondary" onClick={() => setShowCatModal(false)}>
                  Cancel
                </Button>

                <Button variant="primary" type="submit">
                  Save Category
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assets Display ── */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No favorited assets found matching your selection.</p>
        </div>
      ) : (
        <AssetGrid assets={filtered} />
      )}
    </div>
  );
}
