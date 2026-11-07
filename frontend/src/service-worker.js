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

// ── Soroban RPC transactions — queue for background sync when offline (Issue #425) ──
registerRoute(
  ({ url }) => url.href.includes('soroban') || url.href.includes('stellar.org'),
  new NetworkFirst({
    cacheName: 'soroban-rpc-v1',
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 }),
    ],
  }),
);

// ── IndexedDB-based transaction queue for failed writes (Issue #425) ──────────
// Enhanced: intercept failed Soroban transactions and queue them
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' && event.request.method !== 'PUT') return;
  if (!event.request.url.includes('/api/') && !event.request.url.includes('soroban')) return;

  const clonedRequest = event.request.clone();
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(clonedRequest);
        if (!response.ok && !navigator.onLine) {
          throw new Error('Offline');
        }
        return response;
      } catch (err) {
        const body = await clonedRequest
          .clone()
          .text()
          .catch(() => '');
        const db = await openIndexedDBForSW();
        await saveToDB(db, 'failed-transactions', {
          url: clonedRequest.url,
          method: clonedRequest.method,
          headers: [...clonedRequest.headers.entries()],
          body,
          timestamp: Date.now(),
        });
        return new Response(JSON.stringify({ queued: true, error: 'Request queued for retry' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    })(),
  );
});

function openIndexedDBForSW() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sw-failed-tx-queue', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('failed-transactions')) {
        db.createObjectStore('failed-transactions', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function saveToDB(db, store, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

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

// ── Issue #308: Enhanced PWA Service Worker ─────────────────────────────────────
// Cache versioning + invalidation strategy
const CACHE_VERSION = 'v2';
const CACHE_NAMES = {
  static: `static-assets-${CACHE_VERSION}`,
  apiRwa: `api-rwa-${CACHE_VERSION}`,
  apiMisc: `api-misc-${CACHE_VERSION}`,
  adminWrites: `admin-writes-${CACHE_VERSION}`,
  googleFonts: `google-fonts-${CACHE_VERSION}`,
  images: `images-${CACHE_VERSION}`,
};

// ── Cache versioning & cleanup ──────────────────────────────────────────────────
// Delete old caches when a new SW version activates
self.addEventListener('activate', (event) => {
  const validCacheNames = Object.values(CACHE_NAMES);
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => !validCacheNames.some((valid) => key === valid || key.startsWith(valid)))
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }),
      );
      // Claim all clients immediately
      await self.clients.claim();
    })(),
  );
});

// ── Image caching — CacheFirst with long expiry + blur placeholders ───────────
registerRoute(
  ({ request }) => request.destination === 'image' && !request.url.includes('data:'),
  new CacheFirst({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Periodic Background Sync for data updates ─────────────────────────────────
// Periodically refresh cached API data when the app is in the background
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-marketplace-data') {
    event.waitUntil(refreshMarketplaceData());
  }
});

async function refreshMarketplaceData() {
  try {
    const cache = await caches.open(CACHE_NAMES.apiRwa);
    const requests = await cache.keys();
    // Re-fetch and update cached API responses in the background
    await Promise.all(
      requests.map(async (request) => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
          }
        } catch {
          // Network failed — keep stale data
        }
      }),
    );
  } catch (err) {
    console.error('[SW] Periodic sync failed:', err);
  }
}

// ── Enhanced Background Sync with retry tracking ───────────────────────────────
// Track failed requests for better UX feedback
const failedRequestsStore = 'failed-requests';
let pendingQueueSize = 0;

self.addEventListener('sync', (event) => {
  if (event.tag === 'admin-writes-queue') {
    event.waitUntil(replayFailedRequests());
  }
});

async function replayFailedRequests() {
  try {
    const db = await openDB();
    const requests = await getAllFromDB(db, failedRequestsStore);
    pendingQueueSize = requests.length;

    for (const requestData of requests) {
      try {
        const response = await fetch(requestData.url, requestData.options);
        if (response.ok) {
          await deleteFromDB(db, failedRequestsStore, requestData.id);
          pendingQueueSize--;
          // Notify clients of successful replay
          const clients = await self.clients.matchAll();
          clients.forEach((client) => {
            client.postMessage({ type: 'BG_SYNC_SUCCESS', url: requestData.url });
          });
        }
      } catch (err) {
        // Will be retried on next sync event
        break;
      }
    }
  } catch (err) {
    console.error('[SW] Background sync replay failed:', err);
  }
}

// Simple IndexedDB helpers for tracking failed requests
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sw-bg-sync-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(failedRequestsStore)) {
        db.createObjectStore(failedRequestsStore, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromDB(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteFromDB(db, store, id) {
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ── GraphQL / API query caching from IndexedDB-backed store (Issue #425) ───────
// Cache GraphQL portfolio queries for offline access
const GRAPHQL_CACHE_NAME = 'graphql-queries-v1';

registerRoute(
  ({ url }) => url.pathname.includes('/graphql') || url.pathname.includes('/api/v1/rwa'),
  new NetworkFirst({
    cacheName: GRAPHQL_CACHE_NAME,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Cache management: respond to messages from the app ────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_UPDATED') {
    const { key, data } = event.data.payload || {};
    if (key && data) {
      const cacheKey = `api-cache-${key}`;
      event.waitUntil(
        (async () => {
          const cache = await caches.open(GRAPHQL_CACHE_NAME);
          const response = new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', 'X-Cache-Updated': 'true' },
          });
          await cache.put(cacheKey, response);
        })(),
      );
    }
  }

  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      (async () => {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        // Notify the app that caches were cleared
        event.source?.postMessage({ type: 'CACHES_CLEARED' });
      })(),
    );
  }

  if (event.data && event.data.type === 'GET_CACHE_SIZE') {
    event.waitUntil(
      (async () => {
        const cacheKeys = await caches.keys();
        let totalSize = 0;
        for (const key of cacheKeys) {
          const cache = await caches.open(key);
          const requests = await cache.keys();
          for (const req of requests) {
            const response = await cache.match(req);
            if (response) {
              const blob = await response.blob();
              totalSize += blob.size;
            }
          }
        }
        event.source?.postMessage({
          type: 'CACHE_SIZE',
          size: totalSize,
          sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
          cacheCount: cacheKeys.length,
        });
      })(),
    );
  }

  if (event.data && event.data.type === 'GET_BG_SYNC_QUEUE') {
    event.source?.postMessage({
      type: 'BG_SYNC_QUEUE',
      pending: pendingQueueSize,
    });
  }
});

// ── Push notification enhancements ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action) {
    // Handle custom notification actions
    console.log('[SW] Notification action:', event.action);
  }
  // Focus or open the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
