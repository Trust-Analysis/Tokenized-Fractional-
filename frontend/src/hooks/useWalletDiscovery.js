import { useState, useEffect, useCallback } from 'react';
import { discoverProviders, onProviderDiscovered } from '../services/walletDiscovery';

export function useWalletDiscovery() {
  const [providers, setProviders] = useState([]);
  const [discovering, setDiscovering] = useState(true);

  useEffect(() => {
    const initial = discoverProviders();
    if (initial.length > 0) {
      setProviders(initial);
    }
    setDiscovering(false);

    const unsubscribe = onProviderDiscovered((provider) => {
      setProviders((prev) => {
        const exists = prev.some((p) => p.uuid === provider.uuid);
        if (exists) {
          return prev.map((p) => (p.uuid === provider.uuid ? provider : p));
        }
        return [...prev, provider];
      });
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(() => {
    const current = discoverProviders();
    setProviders(current);
  }, []);

  const hasProviders = providers.length > 0;
  const freighterProvider = providers.find(
    (p) => p.rdns?.includes('freighter') || p.name?.toLowerCase().includes('freighter'),
  );
  const otherProviders = providers.filter((p) => p.uuid !== freighterProvider?.uuid);

  return {
    providers,
    discovering,
    refresh,
    hasProviders,
    freighterProvider,
    otherProviders,
  };
}
