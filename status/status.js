// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * status/status.js — issue #797
 *
 * The evaluation logic behind the public status page, kept free of any DOM
 * access so it can be unit-tested directly with `node --test` (see
 * status/status.test.mjs) instead of only through a browser.
 *
 * The page answers one question for a user: "is this a known problem, or is it
 * my own connection or wallet?" So it reports three independent tiers —
 * the backend API, the web frontend, and the Stellar RPC the app depends on —
 * and a single overall verdict derived from them.
 */

/** Per-tier status values, worst-last. */
export const STATUS = {
  OPERATIONAL: 'operational',
  DEGRADED: 'degraded',
  OUTAGE: 'outage',
  UNKNOWN: 'unknown',
};

/** Relative severity, used to fold several tiers into one verdict. */
export const SEVERITY = {
  [STATUS.OPERATIONAL]: 0,
  [STATUS.UNKNOWN]: 1,
  [STATUS.DEGRADED]: 2,
  [STATUS.OUTAGE]: 3,
};

/** Human-facing label per status. */
export const LABELS = {
  [STATUS.OPERATIONAL]: 'Operational',
  [STATUS.DEGRADED]: 'Degraded',
  [STATUS.OUTAGE]: 'Outage',
  [STATUS.UNKNOWN]: 'Unknown',
};

/**
 * Endpoints the page probes by default.
 *
 * These are overridable at runtime, because the page is expected to be hosted
 * independently of the app it monitors: set `STATUS_ENDPOINTS` on the global
 * object before the module loads, or pass `?api=`, `?web=` and `?rpc=` query
 * parameters (see status/README.md).
 */
export const DEFAULT_ENDPOINTS = {
  api: 'https://rwa-marketplace-backend-blue.onrender.com',
  web: 'https://rwa-marketplace-frontend-blue.onrender.com',
  rpc: 'https://soroban-testnet.stellar.org:443',
};

/** How long a single probe may take before it is treated as unreachable. */
export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fold a list of per-tier statuses into one overall verdict.
 *
 * An empty list is UNKNOWN rather than OPERATIONAL: "we measured nothing" must
 * never render as "all good", which is the one wrong answer a status page can
 * give that actively misleads someone.
 *
 * @param {string[]} statuses
 * @returns {string}
 */
export function worstStatus(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return STATUS.UNKNOWN;

  let worst = STATUS.OPERATIONAL;
  for (const status of statuses) {
    const severity = SEVERITY[status];
    if (severity === undefined || severity > SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

/**
 * Build the overall record shown at the top of the page.
 *
 * @param {Array<{ id: string, status: string }>} checks
 * @returns {{ status: string, label: string, affected: string[] }}
 */
export function overallSummary(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const status = worstStatus(list.map((check) => check.status));
  return {
    status,
    label: LABELS[status] ?? LABELS[STATUS.UNKNOWN],
    // Everything that is not clean, so the reader can see the blast radius
    // without scanning the tiers themselves.
    affected: list.filter((check) => check.status !== STATUS.OPERATIONAL).map((check) => check.id),
  };
}

/**
 * Translate the backend's GET /health payload into a tier status.
 *
 * The backend returns 200 with `status: 'ok'` when healthy and 503 with
 * `status: 'degraded'` when a dependency such as Redis is configured but
 * unreachable. Disk pressure is reported inside `dependencies.disk` but
 * deliberately does not change the HTTP status (issue #801), so it is reported
 * here as DEGRADED rather than OUTAGE: the API still serves reads and writes.
 *
 * @param {object|null} payload parsed JSON body, or null when the body was empty
 * @param {number} httpStatus
 * @returns {{ status: string, detail: string }}
 */
export function describeBackendHealth(payload, httpStatus) {
  if (!payload || typeof payload !== 'object') {
    return {
      status: httpStatus >= 200 && httpStatus < 300 ? STATUS.DEGRADED : STATUS.OUTAGE,
      detail: `API answered HTTP ${httpStatus} without a health payload`,
    };
  }

  if (payload.status === 'degraded') {
    const failing = Object.entries(payload.dependencies || {})
      .filter(([, value]) => value && value.status && value.status !== 'ok' && value.status !== 'not_configured')
      .map(([name]) => name);
    return {
      status: STATUS.DEGRADED,
      detail: failing.length
        ? `API running with a degraded dependency: ${failing.join(', ')}`
        : 'API reports a degraded dependency',
    };
  }

  if (payload.status !== 'ok') {
    return { status: STATUS.UNKNOWN, detail: `API returned an unrecognised status: ${payload.status}` };
  }

  const disk = payload.dependencies?.disk;
  if (disk && (disk.status === 'warn' || disk.status === 'critical')) {
    const percent = typeof disk.usedPercent === 'number' ? ` (${disk.usedPercent}% used)` : '';
    return {
      status: STATUS.DEGRADED,
      detail: `API healthy, but this instance's disk is ${disk.status}${percent}`,
    };
  }

  return { status: STATUS.OPERATIONAL, detail: 'API responding normally' };
}

/**
 * Translate a Stellar RPC `getHealth` result into a tier status.
 *
 * Soroban RPC answers JSON-RPC `getHealth` with
 * `{ result: { status: 'healthy' } }`. Anything else — including a JSON-RPC
 * error object — means the app cannot reach the ledger, which is an outage for
 * anything that reads or writes contract state.
 *
 * @param {object|null} payload
 * @returns {{ status: string, detail: string }}
 */
export function describeRpcHealth(payload) {
  if (payload && payload.error) {
    return {
      status: STATUS.OUTAGE,
      detail: `RPC returned an error: ${payload.error.message || 'unknown error'}`,
    };
  }

  const rpcStatus = payload?.result?.status ?? payload?.status;
  if (rpcStatus === 'healthy') {
    const version = payload?.result?.version ? ` (v${payload.result.version})` : '';
    return { status: STATUS.OPERATIONAL, detail: `RPC healthy${version}` };
  }

  if (rpcStatus === undefined) {
    return { status: STATUS.UNKNOWN, detail: 'RPC response did not include a status' };
  }

  return { status: STATUS.DEGRADED, detail: `RPC reports: ${rpcStatus}` };
}

/**
 * Probe one endpoint and turn the outcome into a tier result.
 *
 * Never throws: a status page that crashes on a network error is useless
 * exactly when it is needed, so every failure mode becomes a status.
 *
 * @param {string} id tier identifier ('api' | 'web' | 'rpc')
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, requestInit?: object, interpret?: (payload: object|null, httpStatus: number) => {status: string, detail: string} }} [options]
 * @returns {Promise<{ id: string, url: string, status: string, label: string, detail: string, latencyMs: number|null, checkedAt: string }>}
 */
export async function probe(id, url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interpret =
    options.interpret ??
    ((payload, httpStatus) => ({
      status: httpStatus >= 200 && httpStatus < 300 ? STATUS.OPERATIONAL : STATUS.OUTAGE,
      detail: `answered HTTP ${httpStatus}`,
    }));

  const startedAt = Date.now();
  const base = { id, url, checkedAt: new Date().toISOString() };

  if (typeof fetchImpl !== 'function') {
    return { ...base, status: STATUS.UNKNOWN, label: LABELS[STATUS.UNKNOWN], detail: 'no fetch implementation available', latencyMs: null };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      // The RPC tier needs a JSON-RPC POST; everything else is a plain GET.
      ...(options.requestInit || {}),
      ...(controller && { signal: controller.signal }),
      // A cached 200 would defeat the point of the page.
      cache: 'no-store',
    });

    const httpStatus = response?.status ?? 0;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const verdict = interpret(payload, httpStatus);
    return {
      ...base,
      status: verdict.status,
      label: LABELS[verdict.status] ?? LABELS[STATUS.UNKNOWN],
      detail: verdict.detail,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      ...base,
      status: STATUS.OUTAGE,
      label: LABELS[STATUS.OUTAGE],
      detail: timedOut ? `no response within ${timeoutMs}ms` : `unreachable: ${error?.message || 'network error'}`,
      latencyMs: null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve the endpoint configuration from the browser globals and the URL.
 *
 * @param {{ search?: string, globalObject?: object }} [options]
 * @returns {{ api: string, web: string, rpc: string }}
 */
export function resolveEndpoints(options = {}) {
  const search = options.search ?? (typeof location !== 'undefined' ? location.search : '');
  const globalObject = options.globalObject ?? globalThis;
  const overrides = globalObject.STATUS_ENDPOINTS || {};

  let params = new URLSearchParams();
  try {
    params = new URLSearchParams(search || '');
  } catch {
    params = new URLSearchParams();
  }

  const pick = (key) => {
    const fromQuery = params.get(key);
    if (fromQuery) return fromQuery.replace(/\/+$/, '');
    const fromGlobal = overrides[key];
    if (fromGlobal) return String(fromGlobal).replace(/\/+$/, '');
    return DEFAULT_ENDPOINTS[key];
  };

  return { api: pick('api'), web: pick('web'), rpc: pick('rpc') };
}

/**
 * Probe all three tiers and fold them into a page-ready snapshot.
 *
 * @param {{ endpoints?: {api: string, web: string, rpc: string}, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ overall: object, checks: object[], generatedAt: string }>}
 */
export async function collectStatus(options = {}) {
  const endpoints = options.endpoints ?? resolveEndpoints();
  const shared = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };

  const [api, web, rpc] = await Promise.all([
    probe('api', `${endpoints.api}/health`, { ...shared, interpret: describeBackendHealth }),
    probe('web', `${endpoints.web}/index.html`, shared),
    probe('rpc', endpoints.rpc, {
      ...shared,
      // getHealth is a JSON-RPC POST, not a GET.
      requestInit: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      },
      interpret: (payload) => describeRpcHealth(payload),
    }),
  ]);

  const checks = [api, web, rpc];
  return {
    overall: overallSummary(checks),
    checks,
    generatedAt: new Date().toISOString(),
  };
}
