// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/service-worker.js — Custom Workbox service worker for the RWA Marketplace.
 *
 * Strategy summary:
 *   - App shell / static assets  → CacheFirst  (long-lived, versioned)
 *   - API responses (/api/rwa)   → StaleWhileRevalidate (show cached, refresh in background)
 *   - Google Fonts               → CacheFirst  with long expiry
 *   - Navigation fallback        → Serve /index.html from precache when offline
 */

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// ── Core ──────────────────────────────────────────────────────────────────────

// Take control of all clients immediately when a new SW activates
clientsClaim();

// Inject the Vite build manifest (filled in at build time by vite-plugin-pwa)
// eslint-disable-next-line no-underscore-dangle
precacheAndRoute(self.__WB_MANIFEST || []);

// ── SPA Navigation fallback ───────────────────────────────────────────────────
// Any navigation request that isn't a file serves /index.html from precache.
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler, {
  // Don't intercept requests to /api/* or /metrics — those are backend calls
  denylist: [/^\/api\//, /^\/metrics/, /^\/api-docs/],
});
registerRoute(navigationRoute);

// ── Static assets — CacheFirst ────────────────────────────────────────────────
// JS, CSS, images and fonts bundled by Vite are already versioned; we can
// serve them from the cache without hitting the network.
registerRoute(
  ({ request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font',
  new CacheFirst({
    cacheName: 'static-assets-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Google Fonts — CacheFirst ─────────────────────────────────────────────────
registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
      }),
    ],
  }),
);

// ── API: RWA asset list — StaleWhileRevalidate ────────────────────────────────
// Show stale data immediately, refresh in background.
// This lets users browse cached assets while offline.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && url.pathname.includes('/rwa'),
  new StaleWhileRevalidate({
    cacheName: 'api-rwa-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes — keep API responses reasonably fresh
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── API: health and news — NetworkFirst ───────────────────────────────────────
// Prefer live data; fall back to cache when offline.
registerRoute(
  ({ url }) =>
    url.pathname === '/health' ||
    url.pathname.startsWith('/api/v1/news') ||
    url.pathname.startsWith('/api/news'),
  new NetworkFirst({
    cacheName: 'api-misc-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 10 * 60 }),
    ],
  }),
);

// ── Background Sync — queue failed POST/PATCH/DELETE ─────────────────────────
// Admin write operations attempted while offline are replayed when the
// network comes back. (Read-only users are unaffected.)
const bgSyncPlugin = new BackgroundSyncPlugin('admin-writes-queue', {
  maxRetentionTime: 24 * 60, // Retry up to 24 hours (in minutes)
});

registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(request.method),
  new NetworkFirst({
    cacheName: 'admin-writes-v1',
    plugins: [bgSyncPlugin],
    fetchOptions: { credentials: 'same-origin' },
  }),
  'POST',
);

// ── Push notifications (placeholder) ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const { title = 'RWA Marketplace', body = '', icon = '/favicon.ico' } = event.data.json();
    event.waitUntil(self.registration.showNotification(title, { body, icon }));
  } catch {
    // Ignore malformed push data
  }
});

// ── Message handling ──────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
