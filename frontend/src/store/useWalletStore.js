import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isAllowed, setAllowed, getUserInfo } from "@stellar/freighter-api";

export const useWalletStore = create(
  persist(
    (set, get) => ({
      publicKey: null,
      isConnecting: false,
      walletError: null,
      shares: 0,

      isConnected: () => Boolean(get().publicKey),

      checkConnection: async () => {
        if (import.meta.env.VITE_MOCK_WALLET === "true") {
          const stored = localStorage.getItem("mock_wallet_pubkey");
          if (stored) {
            set({ publicKey: stored, walletError: null });
            return stored;
          }
          return null;
        }
        try {
          if (await isAllowed()) {
            const user = await getUserInfo();
            if (user?.publicKey) {
              set({ publicKey: user.publicKey, walletError: null });
              return user.publicKey;
            }
          }
        } catch (err) {
          console.error("[WalletStore] Freighter check failed:", err);
        }
        set({ publicKey: null, shares: 0 });
        return null;
      },

      connect: async () => {
        set({ isConnecting: true, walletError: null });
        if (import.meta.env.VITE_MOCK_WALLET === "true") {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const mockPubKey = "GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR";
          localStorage.setItem("mock_wallet_pubkey", mockPubKey);
          set({ publicKey: mockPubKey, isConnecting: false });
          return mockPubKey;
        }
        try {
          await setAllowed();
          const user = await getUserInfo();
          if (user?.publicKey) {
            set({ publicKey: user.publicKey, isConnecting: false });
            return user.publicKey;
          }
          throw new Error("No public key returned by Freighter.");
        } catch (err) {
          const msg =
            "Failed to connect Freighter wallet. Ensure the extension is installed and unlocked.";
          console.error("[WalletStore] connect failed:", err);
          set({ walletError: msg, isConnecting: false });
          return null;
        }
      },

      disconnect: () => {
        if (import.meta.env.VITE_MOCK_WALLET === "true") {
          localStorage.removeItem("mock_wallet_pubkey");
          localStorage.removeItem("mock_shares_balance");
        }
        set({
          publicKey: null,
          shares: 0,
          walletError: null,
          isConnecting: false,
        });
      },

      setShares: (n) => set({ shares: n }),

      setWalletError: (msg) => set({ walletError: msg }),

      clearWalletError: () => set({ walletError: null }),
    }),
    {
      name: "rwa-wallet-store",
      partialize: (state) => ({
        publicKey: state.publicKey,
        shares: state.shares,
      }),
    },
  ),
);
