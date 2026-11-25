import { useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWalletStore } from '../store/useWalletStore';
import { useAssetStore } from '../store/useAssetStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useWalletDiscovery } from './useWalletDiscovery';
import { clearAuthToken, purgeLegacyCredentialStorage } from '../lib/authToken';

/**
 * Owns the connected-wallet lifecycle: initial connection check, provider
 * discovery, favorites ownership, extension disconnect events, and a clean
 * disconnect that clears cached asset state and credentials.
 */
export function useWalletLifecycle() {
  const navigate = useNavigate();
  const location = useLocation();

  const { publicKey, activeProvider, disconnect, checkConnection } = useWalletStore();
  const { clearMeta, clearAssets } = useAssetStore();
  const { providers } = useWalletDiscovery();

  const handleDisconnectWallet = useCallback(() => {
    disconnect();
    clearMeta();
    clearAssets();
    clearAuthToken();
    purgeLegacyCredentialStorage();
    if (location.pathname !== '/') navigate('/', { replace: true });
  }, [disconnect, clearMeta, clearAssets, location.pathname, navigate]);

  // Connect on first mount if the wallet store persisted a provider.
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Favorites follow the connected wallet (Issue #905).
  useEffect(() => {
    useFavoritesStore.getState().setActiveWallet(publicKey || null);
  }, [publicKey]);

  // Wallet Discovery (Issue #424).
  useEffect(() => {
    if (providers.length > 0) {
      useWalletStore.getState().setAvailableProviders(providers);
    }
  }, [providers]);

  // Disconnect when the extension reports an account change/removal.
  useEffect(() => {
    if (!publicKey) return undefined;

    let disconnected = false;
    const handleDisconnect = () => {
      if (disconnected) return;
      disconnected = true;
      handleDisconnectWallet();
    };
    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) handleDisconnect();
    };

    const provider = activeProvider?.provider;
    const providerEvents = [
      ['accountsChanged', handleAccountsChanged],
      ['accountChanged', handleAccountsChanged],
      ['disconnect', handleDisconnect],
    ];

    providerEvents.forEach(([event, handler]) => provider?.on?.(event, handler));
    ['wallet:disconnect', 'freighter:disconnect', 'albedo:disconnect'].forEach((event) => {
      window.addEventListener(event, handleDisconnect);
    });

    const checkWallet = async () => {
      if (!disconnected && !(await checkConnection())) handleDisconnect();
    };
    const intervalId = window.setInterval(checkWallet, 2000);

    return () => {
      providerEvents.forEach(([event, handler]) => provider?.removeListener?.(event, handler));
      ['wallet:disconnect', 'freighter:disconnect', 'albedo:disconnect'].forEach((event) => {
        window.removeEventListener(event, handleDisconnect);
      });
      window.clearInterval(intervalId);
    };
  }, [publicKey, activeProvider, checkConnection, handleDisconnectWallet]);

  return { publicKey, handleDisconnectWallet };
}

export default useWalletLifecycle;
