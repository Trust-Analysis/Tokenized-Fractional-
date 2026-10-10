/**
 * Helper to get wallet-specific localStorage key (#277)
 */
export function getStorageKey(walletAddress) {
  const cleanAddr = walletAddress ? walletAddress.trim().toLowerCase() : 'guest';
  return `rwa-watchlist_${cleanAddr}`;
}

export const DEFAULT_CATEGORIES = [
  { id: 'default', name: 'Default Watchlist', color: '#3b82f6' },
  { id: 'high-yield', name: 'High Yield', color: '#22c55e' },
  { id: 'real-estate', name: 'Real Estate', color: '#a855f7' },
];

/**
 * Lightweight zero-dependency store creator fallback for state management
 */
function createVanillaStore(storeInitializer) {
  let state = {};
  const listeners = new Set();

  const set = (partial) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (nextState && nextState !== state) {
      state = { ...state, ...nextState };
      listeners.forEach((fn) => fn(state));
    }
  };

  const get = () => state;
  state = storeInitializer(set, get);

  const useStore = (selector = (s) => s) => selector(state);
  useStore.getState = get;
  useStore.setState = (newState) => set(newState);
  useStore.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return useStore;
}

let createStoreImpl = createVanillaStore;

try {
  const zustandModule = await import('zustand');
  if (zustandModule && typeof zustandModule.create === 'function') {
    createStoreImpl = zustandModule.create;
  }
} catch {
  // Use zero-dependency store fallback
}

/**
 * Helper to load persistent state from localStorage for a given wallet
 */
function loadStateFromStorage(walletAddress) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { favorites: [], categories: DEFAULT_CATEGORIES, notifications: [] };
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(walletAddress));
    if (!raw) return { favorites: [], categories: DEFAULT_CATEGORIES, notifications: [] };
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_CATEGORIES,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch (err) {
    return { favorites: [], categories: DEFAULT_CATEGORIES, notifications: [] };
  }
}

/**
 * Helper to save state to localStorage for a given wallet
 */
function saveStateToStorage(walletAddress, state) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload = {
      favorites: state.favorites,
      categories: state.categories,
      notifications: state.notifications,
    };
    window.localStorage.setItem(getStorageKey(walletAddress), JSON.stringify(payload));
  } catch (err) {
    // Ignore storage write error
  }
}

/**
 * Enhanced useFavoritesStore (#277)
 */
export const useFavoritesStore = createStoreImpl((set, get) => ({
  walletAddress: null,
  favorites: [],
  categories: DEFAULT_CATEGORIES,
  notifications: [],

  /**
   * Set active wallet address and switch storage key seamlessly
   */
  setActiveWallet: (walletAddress) => {
    const loaded = loadStateFromStorage(walletAddress);
    set({
      walletAddress,
      favorites: loaded.favorites,
      categories: loaded.categories,
      notifications: loaded.notifications,
    });
  },

  /**
   * Toggle an asset in/out of favorites
   */
  toggleFavorite: (asset, categoryId = 'default') => {
    const { favorites, walletAddress } = get();
    const contractId = asset.contractId || asset.id;
    const existingIndex = favorites.findIndex((a) => (a.contractId || a.id) === contractId);

    let nextFavorites;
    if (existingIndex >= 0) {
      nextFavorites = favorites.filter((a) => (a.contractId || a.id) !== contractId);
    } else {
      const item = {
        ...asset,
        contractId,
        addedAt: new Date().toISOString(),
        categories: [categoryId],
        initialPrice: asset.pricePerShare,
        initialAvailable: asset.availableShares,
      };
      nextFavorites = [...favorites, item];
    }

    set({ favorites: nextFavorites });
    saveStateToStorage(walletAddress, get());
  },

  /**
   * Assign an asset to a specific watchlist category
   */
  setAssetCategory: (contractId, categoryId) => {
    const { favorites, walletAddress } = get();
    const nextFavorites = favorites.map((a) => {
      if ((a.contractId || a.id) === contractId) {
        const cats = Array.isArray(a.categories) ? a.categories : ['default'];
        const hasCat = cats.includes(categoryId);
        const updatedCats = hasCat ? cats.filter((c) => c !== categoryId) : [...cats, categoryId];
        return { ...a, categories: updatedCats.length > 0 ? updatedCats : ['default'] };
      }
      return a;
    });

    set({ favorites: nextFavorites });
    saveStateToStorage(walletAddress, get());
  },

  /**
   * Create a new custom watchlist category
   */
  createCategory: (name, color = '#3b82f6') => {
    const { categories, walletAddress } = get();
    const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nextCategories = [...categories, { id, name, color }];
    set({ categories: nextCategories });
    saveStateToStorage(walletAddress, get());
    return id;
  },

  /**
   * Delete a category
   */
  deleteCategory: (categoryId) => {
    if (categoryId === 'default') return;
    const { categories, favorites, walletAddress } = get();
    const nextCategories = categories.filter((c) => c.id !== categoryId);
    const nextFavorites = favorites.map((a) => ({
      ...a,
      categories: (a.categories || []).filter((c) => c !== categoryId),
    }));

    set({ categories: nextCategories, favorites: nextFavorites });
    saveStateToStorage(walletAddress, get());
  },

  /**
   * Check latest market data against saved favorites and trigger price/availability alerts
   */
  syncNotifications: (latestAssetsMap = {}) => {
    const { favorites, notifications, walletAddress } = get();
    const newAlerts = [];

    favorites.forEach((fav) => {
      const contractId = fav.contractId || fav.id;
      const latest = latestAssetsMap[contractId];
      if (!latest) return;

      if (fav.pricePerShare != null && latest.pricePerShare != null && fav.pricePerShare !== latest.pricePerShare) {
        const diff = latest.pricePerShare - fav.pricePerShare;
        newAlerts.push({
          id: `alert_price_${contractId}_${Date.now()}`,
          contractId,
          title: fav.title,
          type: 'price_change',
          message: `Price changed for ${fav.title}: ${diff > 0 ? '+' : ''}${(diff / 1e7).toFixed(2)} XLM`,
          timestamp: new Date().toISOString(),
        });
      }

      if (fav.availableShares != null && latest.availableShares != null && fav.availableShares !== latest.availableShares) {
        newAlerts.push({
          id: `alert_avail_${contractId}_${Date.now()}`,
          contractId,
          title: fav.title,
          type: 'availability_change',
          message: `Available shares updated for ${fav.title}: ${latest.availableShares} shares left`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (newAlerts.length > 0) {
      const combined = [...newAlerts, ...notifications].slice(0, 50);
      set({ notifications: combined });
      saveStateToStorage(walletAddress, get());
    }
  },

  /** Remove a single asset from favorites by contractId. */
  removeFavorite: (contractId) => {
    const { favorites, walletAddress } = get();
    const nextFavorites = favorites.filter((a) => (a.contractId || a.id) !== contractId);
    set({ favorites: nextFavorites });
    saveStateToStorage(walletAddress, get());
  },

  /** Clear all favorites for active wallet. */
  clearFavorites: () => {
    const { walletAddress } = get();
    set({ favorites: [], notifications: [] });
    saveStateToStorage(walletAddress, get());
  },

  /** Returns true if an asset is currently favorited. */
  isFavorited: (contractId) => {
    return get().favorites.some((a) => (a.contractId || a.id) === contractId);
  },

  /**
   * Export watchlist as JSON or CSV
   */
  exportWatchlist: (format = 'json') => {
    const { favorites } = get();
    if (format === 'csv') {
      const headers = ['ContractId', 'Title', 'Location', 'AssetType', 'PricePerShare', 'AvailableShares'];
      const rows = favorites.map((f) => [
        `"${f.contractId || f.id || ''}"`,
        `"${(f.title || '').replace(/"/g, '""')}"`,
        `"${(f.location || '').replace(/"/g, '""')}"`,
        `"${f.assetType || ''}"`,
        f.pricePerShare || 0,
        f.availableShares || 0,
      ]);
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }
    return JSON.stringify(favorites, null, 2);
  },

  /**
   * Generate encoded shareable URL link
   */
  getShareableLink: () => {
    const { favorites } = get();
    const ids = favorites.map((f) => f.contractId || f.id).join(',');
    const encoded = encodeURIComponent(ids);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://rwa-marketplace.com';
    return `${origin}/watchlist?shared=${encoded}`;
  },
}));
