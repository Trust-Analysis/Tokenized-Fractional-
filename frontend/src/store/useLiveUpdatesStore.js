import { create } from 'zustand';

/**
 * useLiveUpdatesStore - Manages state for assets receiving real-time updates
 * Tracks which assets are currently receiving live WebSocket updates
 */
const useLiveUpdatesStore = create((set, get) => ({
  // Set of contract IDs that are currently receiving live updates
  liveAssets: new Set(),

  // Timestamp of last update for each asset
  lastUpdateTimes: {},

  /**
   * Mark an asset as receiving live updates
   * @param {string} contractId - The contract ID of the asset
   */
  markAssetLive: (contractId) => {
    set((state) => {
      const newLiveAssets = new Set(state.liveAssets);
      newLiveAssets.add(contractId);
      return {
        liveAssets: newLiveAssets,
        lastUpdateTimes: {
          ...state.lastUpdateTimes,
          [contractId]: Date.now(),
        },
      };
    });
  },

  /**
   * Mark an asset as not receiving live updates
   * @param {string} contractId - The contract ID of the asset
   */
  markAssetNotLive: (contractId) => {
    set((state) => {
      const newLiveAssets = new Set(state.liveAssets);
      newLiveAssets.delete(contractId);
      return {
        liveAssets: newLiveAssets,
      };
    });
  },

  /**
   * Check if an asset is currently receiving live updates
   * @param {string} contractId - The contract ID of the asset
   * @returns {boolean} True if the asset is live
   */
  isAssetLive: (contractId) => {
    return get().liveAssets.has(contractId);
  },

  /**
   * Update the timestamp for an asset (called when receiving WebSocket events)
   * @param {string} contractId - The contract ID of the asset
   */
  updateAssetTimestamp: (contractId) => {
    set((state) => ({
      lastUpdateTimes: {
        ...state.lastUpdateTimes,
        [contractId]: Date.now(),
      },
    }));
  },

  /**
   * Clear all live assets (useful for disconnect/cleanup)
   */
  clearAllLiveAssets: () => {
    set({
      liveAssets: new Set(),
      lastUpdateTimes: {},
    });
  },

  /**
   * Get the timestamp of the last update for an asset
   * @param {string} contractId - The contract ID of the asset
   * @returns {number|null} Timestamp or null if no updates
   */
  getLastUpdateTime: (contractId) => {
    return get().lastUpdateTimes[contractId] || null;
  },

  /**
   * Mark multiple assets as live at once
   * @param {string[]} contractIds - Array of contract IDs
   */
  markAssetsLive: (contractIds) => {
    set((state) => {
      const newLiveAssets = new Set(state.liveAssets);
      const newUpdateTimes = { ...state.lastUpdateTimes };
      const now = Date.now();

      contractIds.forEach((id) => {
        newLiveAssets.add(id);
        newUpdateTimes[id] = now;
      });

      return {
        liveAssets: newLiveAssets,
        lastUpdateTimes: newUpdateTimes,
      };
    });
  },
}));

export default useLiveUpdatesStore;
