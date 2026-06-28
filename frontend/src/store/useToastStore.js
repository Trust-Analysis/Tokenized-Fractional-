import { create } from 'zustand';

let nextId = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],

  addToast: ({ message, type = 'info', txHash = null, duration = null }) => {
    const id = ++nextId;
    const toast = { id, message, type, txHash, duration };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clearToasts: () => set({ toasts: [] }),
}));
