import { useState, useEffect, useCallback } from 'react';

let onlineOverride = null;

export function useServiceWorker() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [updateSWFn, setUpdateSWFn] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [registration, setRegistration] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        const { registerSW } = await import('virtual:pwa-register');

        const updateSW = registerSW({
          onNeedRefresh() {
            if (!cancelled) setNeedsUpdate(true);
          },
          onOfflineReady() {
            if (!cancelled) setOfflineReady(true);
          },
          onRegistered(reg) {
            if (reg) {
              setRegistration(reg);
              setInterval(() => {
                if (document.visibilityState === 'visible') {
                  reg.update();
                }
              }, 60_000);
            }
          },
        });

        if (!cancelled) setUpdateSWFn(() => updateSW);
      } catch {
        // silently skip
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const checkOfflineCache = useCallback(async () => {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open('api-rwa-v2');
      const keys = await cache.keys();
      return keys.length > 0;
    } catch {
      return false;
    }
  }, []);

  return {
    needsUpdate,
    updateSW: updateSWFn ?? (() => {}),
    offlineReady,
    registration,
    checkOfflineCache,
  };
}
