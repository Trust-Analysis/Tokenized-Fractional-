import { create } from 'zustand';

/**
 * Upper bound on assets in a single comparison (issue #904).
 *
 * Each compared asset is a column in the comparison table and may trigger its
 * own data fetch when the view loads, so the list must stay small: beyond 4
 * the table no longer fits side-by-side and the request fan-out grows
 * unbounded. Callers must surface the `limit_reached` result to the user
 * rather than dropping the add silently.
 */
export const MAX_COMPARISON = 4;

/**
 * useComparisonStore — manages the set of assets selected for side-by-side comparison.
 * Maximum of MAX_COMPARISON assets can be compared simultaneously.
 */
export const useComparisonStore = create((set, get) => ({
  /** @type {Array<Object>} */
  comparedAssets: [],

  /**
   * Toggle an asset in/out of the comparison list.
   * Refuses to add once the list holds MAX_COMPARISON assets.
   *
   * @returns {{ status: 'added' | 'removed' | 'limit_reached' }}
   */
  toggleComparison: (asset) => {
    const { comparedAssets } = get();
    const exists = comparedAssets.some((a) => a.contractId === asset.contractId);
    if (exists) {
      set({ comparedAssets: comparedAssets.filter((a) => a.contractId !== asset.contractId) });
      return { status: 'removed' };
    }
    if (comparedAssets.length >= MAX_COMPARISON) {
      return { status: 'limit_reached' };
    }
    set({ comparedAssets: [...comparedAssets, asset] });
    return { status: 'added' };
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

  /** Returns true when no further assets can be added. */
  isComparisonFull: () => get().comparedAssets.length >= MAX_COMPARISON,

  MAX_COMPARISON,
}));
