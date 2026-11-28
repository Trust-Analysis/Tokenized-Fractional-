// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Labelled request sequences for the anomaly detector (issue #903).
 *
 * Each scenario is a generator returning `{ at, ip, apiKey, userAgent, path,
 * method }` events, `at` in ms from the scenario start. Generators take a
 * seeded RNG so every run replays the same traffic, and each pattern is
 * expanded into several variants (different seeds and sizes) to make the
 * rates below more than a handful of samples.
 *
 *   label 'normal'     — must not be flagged at any point
 *   label 'suspicious' — must be flagged at least once
 *
 * See docs/ANOMALY_DETECTION.md for the accuracy bar these are held to.
 */

export const START = Date.parse('2026-03-10T14:00:00Z');
const NIGHT_START = Date.parse('2026-03-10T03:00:00Z');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15';
const APP_PATHS = [
  '/assets',
  '/assets/C123',
  '/assets/C456',
  '/portfolio',
  '/orders',
  '/transactions',
  '/prices/C123',
  '/prices/C456',
  '/notifications',
];

/* eslint-disable no-bitwise, no-param-reassign, no-multi-assign -- standard mulberry32 PRNG */
export function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise, no-param-reassign, no-multi-assign */

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// ── Known-normal traffic ─────────────────────────────────────────────────────

function casualBrowsing(rng, { start = START } = {}) {
  const events = [];
  let at = 0;
  for (let i = 0; i < 40; i++) {
    at += 2000 + rng() * 13000;
    events.push({
      at,
      ip: '198.51.100.10',
      apiKey: 'anon:198.51.100.10',
      userAgent: BROWSER_UA,
      path: pick(rng, APP_PATHS),
      method: 'GET',
    });
  }
  return events.map((e) => ({ ...e, start }));
}

function activeTraderPolling(rng) {
  // Polls prices every second for 5 minutes, places an order now and then.
  const events = [];
  for (let s = 0; s < 300; s++) {
    events.push({
      at: s * 1000 + rng() * 200,
      ip: '198.51.100.20',
      apiKey: 'key-trader',
      userAgent: BROWSER_UA,
      path: '/prices/C123',
      method: 'GET',
    });
    if (rng() < 0.05) {
      events.push({
        at: s * 1000 + 500,
        ip: '198.51.100.20',
        apiKey: 'key-trader',
        userAgent: BROWSER_UA,
        path: '/transactions',
        method: 'POST',
      });
    }
  }
  return events;
}

function spaPageLoads(rng) {
  // Each navigation fans out ~15 parallel requests across 8 endpoints.
  const events = [];
  for (let load = 0; load < 10; load++) {
    const base = load * 30000;
    for (let i = 0; i < 15; i++) {
      events.push({
        at: base + rng() * 300,
        ip: '198.51.100.30',
        apiKey: 'anon:198.51.100.30',
        userAgent: BROWSER_UA,
        path: APP_PATHS[i % 8],
        method: 'GET',
      });
    }
  }
  return events;
}

function officeBehindNat(rng) {
  // Three people, three browsers, one public IP.
  const uas = [
    BROWSER_UA,
    'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/126.0',
    'Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0',
  ];
  const events = [];
  for (let i = 0; i < 300; i++) {
    events.push({
      at: rng() * 300000,
      ip: '203.0.113.5',
      apiKey: 'anon:203.0.113.5',
      userAgent: pick(rng, uas),
      path: pick(rng, APP_PATHS),
      method: 'GET',
    });
  }
  return events;
}

function integrationPartner(rng) {
  // Server-to-server client at a steady 8 req/s across 4 endpoints.
  const events = [];
  for (let i = 0; i < 480; i++) {
    events.push({
      at: i * 125 + rng() * 20,
      ip: '192.0.2.40',
      apiKey: 'key-partner',
      userAgent: 'partner-sync/2.3',
      path: APP_PATHS[i % 4],
      method: 'GET',
    });
  }
  return events;
}

function nightOwl(rng) {
  return casualBrowsing(rng, { start: NIGHT_START });
}

// ── Known-suspicious traffic ─────────────────────────────────────────────────

function floodBurst(rng, { count = 150 } = {}) {
  return Array.from({ length: count }, () => ({
    at: rng() * 1000,
    ip: '233.252.0.1',
    apiKey: 'anon:233.252.0.1',
    userAgent: 'python-requests/2.31',
    path: '/assets',
    method: 'GET',
  }));
}

function sustainedScrape(rng, { rps = 60, seconds = 15 } = {}) {
  const events = [];
  for (let i = 0; i < rps * seconds; i++) {
    events.push({
      at: (i * 1000) / rps,
      ip: '233.252.0.2',
      apiKey: 'key-scraper',
      userAgent: 'Go-http-client/1.1',
      path: `/assets/C${100 + (i % 5)}`,
      method: 'GET',
    });
  }
  return events;
}

function endpointEnumeration(rng, { paths = 40 } = {}) {
  // Walks a wordlist of admin/debug paths quickly.
  const words = [
    'admin',
    'debug',
    'config',
    '.env',
    'backup',
    'internal',
    'graphql',
    'metrics',
    'swagger',
    'status',
  ];
  const events = [];
  for (let i = 0; i < paths; i++) {
    events.push({
      at: i * 100,
      ip: '233.252.0.3',
      apiKey: 'anon:233.252.0.3',
      userAgent: 'curl/8.6.0',
      path: `/${pick(rng, words)}/${i}`,
      method: 'GET',
    });
  }
  return events;
}

function userAgentRotationScan(rng, { uaCount = 10 } = {}) {
  // Bot evading fingerprinting: fresh UA per request while probing endpoints.
  const events = [];
  for (let i = 0; i < 60; i++) {
    events.push({
      at: i * 500,
      ip: '233.252.0.4',
      apiKey: 'anon:233.252.0.4',
      userAgent: `Mozilla/5.0 (bot-${i % uaCount})`,
      path: `/assets/C${i % 25}`,
      method: 'GET',
    });
  }
  return events;
}

function rapidBuySellCycling(rng, { count = 120 } = {}) {
  // Wash-trading-style churn: alternating buy/sell submissions in ~2s.
  return Array.from({ length: count }, (_, i) => ({
    at: i * (2000 / count) + rng() * 5,
    ip: '233.252.0.5',
    apiKey: 'key-churn',
    userAgent: 'trade-bot/0.1',
    path: i % 2 ? '/orders/sell' : '/orders/buy',
    method: 'POST',
  }));
}

const variants = (label, name, generator, optionsList) =>
  optionsList.map((options, i) => ({
    label,
    name: `${name} #${i + 1}`,
    events: generator(mulberry32(1000 + i * 7919 + name.length), options),
  }));

export function buildDataset() {
  return [
    ...variants('normal', 'casual browsing', casualBrowsing, [{}, {}, {}, {}]),
    ...variants('normal', 'active trader polling', activeTraderPolling, [{}, {}, {}]),
    ...variants('normal', 'SPA page loads', spaPageLoads, [{}, {}, {}]),
    ...variants('normal', 'office behind NAT', officeBehindNat, [{}, {}, {}]),
    ...variants('normal', 'integration partner', integrationPartner, [{}, {}, {}]),
    ...variants('normal', 'night-time browsing', nightOwl, [{}, {}]),
    ...variants('suspicious', 'flood burst', floodBurst, [
      { count: 110 },
      { count: 150 },
      { count: 300 },
    ]),
    ...variants('suspicious', 'sustained scrape', sustainedScrape, [
      { rps: 50, seconds: 20 },
      { rps: 60 },
      { rps: 100, seconds: 10 },
    ]),
    ...variants('suspicious', 'endpoint enumeration', endpointEnumeration, [
      { paths: 30 },
      { paths: 40 },
      { paths: 80 },
    ]),
    ...variants('suspicious', 'user-agent rotation scan', userAgentRotationScan, [
      { uaCount: 8 },
      { uaCount: 10 },
      { uaCount: 20 },
    ]),
    ...variants('suspicious', 'rapid buy/sell cycling', rapidBuySellCycling, [
      { count: 110 },
      { count: 120 },
      { count: 200 },
    ]),
  ];
}
