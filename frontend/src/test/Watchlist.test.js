import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { getStorageKey, useFavoritesStore } from '../store/useFavoritesStore.js';

describe('Favorites and Watchlist Management System (#277)', () => {
  beforeEach(() => {
    useFavoritesStore.setState({
      walletAddress: null,
      favorites: [],
      categories: [
        { id: 'default', name: 'Default Watchlist' },
        { id: 'high-yield', name: 'High Yield' },
      ],
      notifications: [],
    });
  });

  it('generates storage key scoped by active wallet address', () => {
    assert.equal(getStorageKey('GABC12345'), 'rwa-watchlist_gabc12345');
    assert.equal(getStorageKey(null), 'rwa-watchlist_guest');
    assert.equal(getStorageKey(''), 'rwa-watchlist_guest');
  });

  it('allows adding and toggling assets in favorites', () => {
    const store = useFavoritesStore.getState();
    const asset = { contractId: 'C100', title: 'Luxury Apt', pricePerShare: 500, availableShares: 20 };

    store.toggleFavorite(asset);
    assert.equal(useFavoritesStore.getState().isFavorited('C100'), true);
    assert.equal(useFavoritesStore.getState().favorites.length, 1);

    // Toggle out
    useFavoritesStore.getState().toggleFavorite(asset);
    assert.equal(useFavoritesStore.getState().isFavorited('C100'), false);
    assert.equal(useFavoritesStore.getState().favorites.length, 0);
  });

  it('supports custom categories and asset category assignment', () => {
    const store = useFavoritesStore.getState();
    const catId = store.createCategory('Dividend Stars');
    assert.ok(catId.startsWith('cat_'));

    const asset = { contractId: 'C200', title: 'Office Tower' };
    store.toggleFavorite(asset, 'default');
    store.setAssetCategory('C200', catId);

    const fav = useFavoritesStore.getState().favorites.find((f) => f.contractId === 'C200');
    assert.ok(fav.categories.includes(catId));
  });

  it('triggers price and availability change notifications', () => {
    const store = useFavoritesStore.getState();
    const asset = { contractId: 'C300', title: 'Retail Mall', pricePerShare: 1000, availableShares: 50 };
    store.toggleFavorite(asset);

    // Simulate price drop & availability change
    const latestData = {
      C300: { pricePerShare: 800, availableShares: 40 },
    };

    useFavoritesStore.getState().syncNotifications(latestData);
    const notifications = useFavoritesStore.getState().notifications;
    assert.ok(notifications.length >= 2);
    assert.ok(notifications.some((n) => n.type === 'price_change'));
    assert.ok(notifications.some((n) => n.type === 'availability_change'));
  });

  it('exports watchlist in JSON and CSV formats', () => {
    const store = useFavoritesStore.getState();
    store.toggleFavorite({ contractId: 'C400', title: 'Solar Farm', location: 'TX', assetType: 'green', pricePerShare: 300, availableShares: 100 });

    const jsonExport = store.exportWatchlist('json');
    assert.ok(jsonExport.includes('Solar Farm'));

    const csvExport = store.exportWatchlist('csv');
    assert.ok(csvExport.includes('ContractId,Title'));
    assert.ok(csvExport.includes('"C400"'));
  });

  it('generates shareable watchlist link', () => {
    const store = useFavoritesStore.getState();
    store.toggleFavorite({ contractId: 'C500', title: 'Wind Park' });

    const link = store.getShareableLink();
    assert.ok(link.includes('/watchlist?shared=C500'));
  });
});
