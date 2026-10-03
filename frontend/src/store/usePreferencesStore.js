import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  isDefaultPreferences,
  mergePreferences,
} from '../utils/preferences';

/**
 * usePreferencesStore (Issue #793)
 *
 * Persists the user's lightweight display/notification preferences in
 * `localStorage` so they survive reloads, and exposes simple setters for the
 * preferences panel. Unknown or malformed persisted values are sanitised back
 * to the defaults on rehydrate.
 */
export const usePreferencesStore = create(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFERENCES,

      /** Update a single preference by key (validated on read). */
      setPreference: (key, value) => set((state) => mergePreferences({ ...state, [key]: value })),

      setDisplayCurrency: (currency) => set({ displayCurrency: currency }),

      setPriceChangeNotifications: (enabled) => set({ priceChangeNotifications: Boolean(enabled) }),

      setSoldOutNotifications: (enabled) => set({ soldOutNotifications: Boolean(enabled) }),

      /** Commit a whole preferences draft at once (used by the panel's Save). */
      savePreferences: (draft) => set(mergePreferences(draft)),

      /** Restore the shipped defaults. */
      resetPreferences: () => set({ ...DEFAULT_PREFERENCES }),

      /** Whether the user has customised anything. */
      hasCustomPreferences: () => !isDefaultPreferences(get()),
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist the data fields; drop any actions that may end up in state.
      partialize: (state) => mergePreferences(state),
      // Sanitise whatever was stored before it reaches the app.
      merge: (persisted, current) => ({ ...current, ...mergePreferences(persisted) }),
    },
  ),
);
