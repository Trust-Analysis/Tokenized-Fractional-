import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'rwa-favorites';

/**
 * useFavoritesStore — manages bookmarked/favorited assets.
 * Persists to localStorage via zustand/middleware persist.
 */
export const useFavoritesStore = create(
  persist(
    (set, get) => ({
      /** @type {Array<Object>} Full asset objects that have been bookmarked */
      favorites: [],

      /**
       * Toggle an asset in/out of the favorites list.
       * Uses contractId as the unique identifier.
       */
      toggleFavorite: (asset) => {
        const { favorites } = get();
        const exists = favorites.some((a) => a.contractId === asset.contractId);
        if (exists) {
          set({ favorites: favorites.filter((a) => a.contractId !== asset.contractId) });
        } else {
          set({ favorites: [...favorites, asset] });
        }
      },

      /** Remove a single asset from favorites by contractId. */
      removeFavorite: (contractId) => {
        set((state) => ({
          favorites: state.favorites.filter((a) => a.contractId !== contractId),
        }));
      },

      /** Clear all favorites. */
      clearFavorites: () => set({ favorites: [] }),

      /** Returns true if an asset is currently favorited. */
      isFavorited: (contractId) => get().favorites.some((a) => a.contractId === contractId),
    }),
    {
      name: STORAGE_KEY,
      // Only persist the favorites array itself, not the methods
      partialize: (state) => ({ favorites: state.favorites }),
    },
  ),
);
