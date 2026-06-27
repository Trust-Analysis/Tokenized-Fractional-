import { create } from 'zustand';

/**
 * useAssetStore
 *
 * Global state for RWA asset metadata fetched from the backend API.
 * Not persisted — metadata is lightweight and always re-fetched
 * when a wallet connects, ensuring it stays fresh.
 */
export const useAssetStore = create((set, get) => ({
  // ── Single asset state ─────────────────────────────────
  assetMeta: null,
  isFetchingMeta: false,
  metaError: null,

  // ── All assets listing state ────────────────────────────
  assets: [],
  isFetchingAssets: false,
  assetsError: null,

  // ── Actions ────────────────────────────────────────────

  /**
   * Fetches RWA metadata from the backend API.
   * Silently skips if the contractId is a placeholder.
   *
   * @param {string} contractId - The on-chain contract address
   * @param {string} apiUrl     - Base URL of the metadata API
   */
  fetchMetadata: async (contractId, apiUrl) => {
    // Guard: skip placeholder / unconfigured contract IDs
    if (!contractId || contractId.length < 50) return;

    // Avoid duplicate concurrent fetches
    if (get().isFetchingMeta) return;

    set({ isFetchingMeta: true, metaError: null });
    try {
      const res = await fetch(`${apiUrl}/api/v1/rwa/${contractId}`);
      if (res.ok) {
        const data = await res.json();
        set({ assetMeta: data });
      } else {
        console.warn('[AssetStore] Metadata endpoint returned', res.status);
        set({ metaError: `Metadata unavailable (${res.status})` });
      }
    } catch (err) {
      console.warn('[AssetStore] Metadata server unreachable:', err.message);
      // Non-fatal — app works fine without metadata
    } finally {
      set({ isFetchingMeta: false });
    }
  },

  /**
   * Fetches ALL RWA assets from GET /api/v1/rwa.
   *
   * @param {string} apiUrl - Base URL of the metadata API
   */
  fetchAllAssets: async (apiUrl) => {
    // Avoid duplicate concurrent fetches
    if (get().isFetchingAssets) return;

    set({ isFetchingAssets: true, assetsError: null });
    try {
      const res = await fetch(`${apiUrl}/api/v1/rwa`);
      if (res.ok) {
        const json = await res.json();
        set({ assets: json.data || [] });
      } else {
        console.warn('[AssetStore] Assets endpoint returned', res.status);
        set({ assetsError: `Unable to load assets (${res.status})` });
      }
    } catch (err) {
      console.warn('[AssetStore] Assets server unreachable:', err.message);
      set({ assetsError: 'Unable to reach the metadata server. Please try again.' });
    } finally {
      set({ isFetchingAssets: false });
    }
  },

  /** Clears asset metadata (e.g. on wallet disconnect). */
  clearMeta: () => set({ assetMeta: null, metaError: null }),

  /** Clear metadata error. */
  clearMetaError: () => set({ metaError: null }),

  /** Clear assets listing and error. */
  clearAssets: () => set({ assets: [], assetsError: null }),
}));
