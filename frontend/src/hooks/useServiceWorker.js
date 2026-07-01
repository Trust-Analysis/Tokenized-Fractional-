// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/hooks/useServiceWorker.js
 *
 * Registers the Workbox service worker via the vite-plugin-pwa virtual module
 * and provides update state so the app can prompt users to refresh.
 *
 * Uses dynamic import so the module is only loaded when service workers are
 * supported (production builds), falling back gracefully in dev/test.
 */

import { useState, useEffect } from 'react';

/**
 * @typedef {Object} SWState
 * @property {boolean} needsUpdate - A new SW version is waiting to activate.
 * @property {Function} updateSW   - Call to skip waiting and reload the page.
 */

/**
 * @returns {SWState}
 */
export function useServiceWorker() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [updateSWFn, setUpdateSWFn] = useState(null);

  useEffect(() => {
    // Only register in production-like environments where SW is supported
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        // vite-plugin-pwa generates this virtual module at build time
        const { registerSW } = await import('virtual:pwa-register');

        const updateSW = registerSW({
          onNeedRefresh() {
            if (!cancelled) setNeedsUpdate(true);
          },
          onOfflineReady() {
            // App is ready to work offline — we surface this via OfflineIndicator
          },
          onRegistered(registration) {
            if (registration) {
              // Poll for updates every 60 s when the page is visible
              setInterval(() => {
                if (document.visibilityState === 'visible') {
                  registration.update();
                }
              }, 60_000);
            }
          },
        });

        if (!cancelled) setUpdateSWFn(() => updateSW);
      } catch {
        // Virtual module not available in dev or test — silently skip
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return {
    needsUpdate,
    updateSW: updateSWFn ?? (() => {}),
  };
}
