import { create } from 'zustand';

let nextId = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],
  history: [],
  preferences: {
    position: 'top-right',
    maxToasts: 5,
    defaultDuration: 5000,
    soundEnabled: false,
  },

  addToast: ({
    message,
    type = 'info',
    txHash = null,
    duration = null,
    action = null,
    nextSteps = null,
    details = null,
  }) => {
    const id = ++nextId;
    const prefs = get().preferences;
    const toast = {
      id,
      message,
      type,
      txHash,
      duration: duration ?? prefs.defaultDuration,
      action,
      nextSteps,
      details,
      createdAt: Date.now(),
    };
    set((s) => {
      const updated = [toast, ...s.toasts].slice(0, s.preferences.maxToasts);
      return {
        toasts: updated,
        history: [toast, ...s.history].slice(0, 100),
      };
    });
    return id;
  },

  removeToast: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => set({ toasts: [] }),

  clearHistory: () => set({ history: [] }),

  updatePreferences: (patch) =>
    set((s) => ({
      preferences: { ...s.preferences, ...patch },
    })),
}));
