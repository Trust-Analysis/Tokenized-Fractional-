import { create } from 'zustand';

const MAX_COMPARISON = 4;

/**
 * useComparisonStore — manages the set of assets selected for side-by-side comparison.
 * Maximum of 4 assets can be compared simultaneously.
 */
export const useComparisonStore = create((set, get) => ({
  /** @type {Array<Object>} */
  comparedAssets: [],

  /**
   * Toggle an asset in/out of the comparison list.
   * No-ops if the list is already at MAX_COMPARISON and the asset isn't already in it.
   */
  toggleComparison: (asset) => {
    const { comparedAssets } = get();
    const exists = comparedAssets.some((a) => a.contractId === asset.contractId);
    if (exists) {
      set({ comparedAssets: comparedAssets.filter((a) => a.contractId !== asset.contractId) });
    } else if (comparedAssets.length < MAX_COMPARISON) {
      set({ comparedAssets: [...comparedAssets, asset] });
    }
  },

  /** Remove a single asset from the comparison list. */
  removeFromComparison: (contractId) => {
    set((state) => ({
      comparedAssets: state.comparedAssets.filter((a) => a.contractId !== contractId),
    }));
  },

  /** Clear the entire comparison list. */
  clearComparison: () => set({ comparedAssets: [] }),

  /** Returns true if an asset is currently in the comparison list. */
  isCompared: (contractId) => get().comparedAssets.some((a) => a.contractId === contractId),

  MAX_COMPARISON,
}));
