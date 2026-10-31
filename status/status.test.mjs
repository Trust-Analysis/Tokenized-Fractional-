// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the public status page's evaluation logic (issue #797).
 *
 * Uses the Node built-in test runner so the static page keeps zero
 * dependencies: `node --test status/status.test.mjs`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_ENDPOINTS,
  STATUS,
  collectStatus,
  describeBackendHealth,
  describeRpcHealth,
  overallSummary,
  probe,
  resolveEndpoints,
  worstStatus,
} from './status.js';

/** A fetch stub that answers with a canned response. */
function fakeFetch({ status = 200, json = null, throws = null, delayMs = 0, onCall = null } = {}) {
  return async (url, init) => {
    if (onCall) onCall(url, init);
    if (throws) throw throws;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      status,
      json: async () => {
        if (json === null) throw new Error('no body');
        return json;
      },
    };
  };
}

test('worstStatus', async (t) => {
  await t.test('an empty set is unknown, never operational', () => {
    assert.equal(worstStatus([]), STATUS.UNKNOWN);
    assert.equal(worstStatus(undefined), STATUS.UNKNOWN);
  });

  await t.test('a single status is returned unchanged', () => {
    assert.equal(worstStatus([STATUS.OPERATIONAL]), STATUS.OPERATIONAL);
    assert.equal(worstStatus([STATUS.DEGRADED]), STATUS.DEGRADED);
  });

  await t.test('the most severe status wins', () => {
    assert.equal(worstStatus([STATUS.OPERATIONAL, STATUS.DEGRADED]), STATUS.DEGRADED);
    assert.equal(worstStatus([STATUS.DEGRADED, STATUS.OUTAGE]), STATUS.OUTAGE);
    assert.equal(worstStatus([STATUS.OUTAGE, STATUS.OPERATIONAL, STATUS.UNKNOWN]), STATUS.OUTAGE);
  });

  await t.test('unknown outranks operational', () => {
    assert.equal(worstStatus([STATUS.OPERATIONAL, STATUS.UNKNOWN]), STATUS.UNKNOWN);
  });

  await t.test('an unrecognised value is treated as worse than anything known', () => {
    assert.equal(worstStatus([STATUS.OUTAGE, 'something-else']), 'something-else');
  });
});

test('overallSummary', async (t) => {
  await t.test('labels a clean run and reports no affected tiers', () => {
    const summary = overallSummary([
      { id: 'api', status: STATUS.OPERATIONAL },
      { id: 'web', status: STATUS.OPERATIONAL },
    ]);
    assert.equal(summary.status, STATUS.OPERATIONAL);
    assert.equal(summary.label, 'Operational');
    assert.deepEqual(summary.affected, []);
  });

  await t.test('lists exactly the tiers that are not operational', () => {
    const summary = overallSummary([
      { id: 'api', status: STATUS.OPERATIONAL },
      { id: 'web', status: STATUS.DEGRADED },
      { id: 'rpc', status: STATUS.OUTAGE },
    ]);
    assert.equal(summary.status, STATUS.OUTAGE);
    assert.deepEqual(summary.affected, ['web', 'rpc']);
  });

  await t.test('an empty list is unknown rather than operational', () => {
    assert.equal(overallSummary([]).status, STATUS.UNKNOWN);
    assert.equal(overallSummary(undefined).status, STATUS.UNKNOWN);
  });
});

test('describeBackendHealth', async (t) => {
  await t.test('a healthy payload is operational', () => {
    const verdict = describeBackendHealth(
      { status: 'ok', dependencies: { redis: { status: 'not_configured' } } },
      200,
    );
    assert.equal(verdict.status, STATUS.OPERATIONAL);
  });

  await t.test('an unreadable body with a 2xx is degraded, not operational', () => {
    assert.equal(describeBackendHealth(null, 200).status, STATUS.DEGRADED);
  });

  await t.test('an unreadable body with a 5xx is an outage', () => {
    assert.equal(describeBackendHealth(null, 503).status, STATUS.OUTAGE);
  });

  await t.test('names the degraded dependency', () => {
    const verdict = describeBackendHealth(
      { status: 'degraded', dependencies: { redis: { status: 'error' }, storage: { status: 'ok' } } },
      503,
    );
    assert.equal(verdict.status, STATUS.DEGRADED);
    assert.match(verdict.detail, /redis/);
    assert.doesNotMatch(verdict.detail, /storage/);
  });

  await t.test('a not_configured dependency is not counted as degraded', () => {
    const verdict = describeBackendHealth(
      { status: 'degraded', dependencies: { redis: { status: 'not_configured' } } },
      503,
    );
    assert.match(verdict.detail, /degraded dependency/);
    assert.doesNotMatch(verdict.detail, /redis/);
  });

  await t.test('disk pressure on an otherwise healthy API is degraded, not an outage', () => {
    const verdict = describeBackendHealth(
      { status: 'ok', dependencies: { disk: { status: 'critical', usedPercent: 94.5 } } },
      200,
    );
    assert.equal(verdict.status, STATUS.DEGRADED);
    assert.match(verdict.detail, /94\.5%/);
  });

  await t.test('a disk warning is degraded too', () => {
    const verdict = describeBackendHealth(
      { status: 'ok', dependencies: { disk: { status: 'warn', usedPercent: 81 } } },
      200,
    );
    assert.equal(verdict.status, STATUS.DEGRADED);
  });

  await t.test('an unrecognised backend status is unknown', () => {
    assert.equal(describeBackendHealth({ status: 'starting' }, 200).status, STATUS.UNKNOWN);
  });
});

test('describeRpcHealth', async (t) => {
  await t.test('healthy is operational', () => {
    const verdict = describeRpcHealth({ result: { status: 'healthy', version: '22.0.0' } });
    assert.equal(verdict.status, STATUS.OPERATIONAL);
    assert.match(verdict.detail, /v22\.0\.0/);
  });

  await t.test('a JSON-RPC error is an outage', () => {
    const verdict = describeRpcHealth({ error: { message: 'method not found' } });
    assert.equal(verdict.status, STATUS.OUTAGE);
    assert.match(verdict.detail, /method not found/);
  });

  await t.test('a missing status is unknown', () => {
    assert.equal(describeRpcHealth({ result: {} }).status, STATUS.UNKNOWN);
    assert.equal(describeRpcHealth(null).status, STATUS.UNKNOWN);
  });

  await t.test('any other reported status is degraded, not operational', () => {
    assert.equal(describeRpcHealth({ result: { status: 'behind' } }).status, STATUS.DEGRADED);
  });
});

test('resolveEndpoints', async (t) => {
  await t.test('falls back to the module defaults', () => {
    assert.deepEqual(resolveEndpoints({ search: '', globalObject: {} }), DEFAULT_ENDPOINTS);
  });

  await t.test('accepts a global override', () => {
    const resolved = resolveEndpoints({
      search: '',
      globalObject: { STATUS_ENDPOINTS: { api: 'https://api.example.com' } },
    });
    assert.equal(resolved.api, 'https://api.example.com');
    assert.equal(resolved.web, DEFAULT_ENDPOINTS.web);
  });

  await t.test('query parameters win over the global override', () => {
    const resolved = resolveEndpoints({
      search: '?api=https://q.example.com&rpc=https://r.example.com',
      globalObject: { STATUS_ENDPOINTS: { api: 'https://g.example.com' } },
    });
    assert.equal(resolved.api, 'https://q.example.com');
    assert.equal(resolved.rpc, 'https://r.example.com');
    assert.equal(resolved.web, DEFAULT_ENDPOINTS.web);
  });

  await t.test('strips a trailing slash so probe URLs do not double up', () => {
    const resolved = resolveEndpoints({ search: '?api=https://api.example.com/', globalObject: {} });
    assert.equal(resolved.api, 'https://api.example.com');
  });
});

test('probe', async (t) => {
  await t.test('a 2xx with the default interpreter is operational', async () => {
    const result = await probe('web', 'https://example.com/index.html', { fetchImpl: fakeFetch({ status: 200 }) });
    assert.equal(result.status, STATUS.OPERATIONAL);
    assert.equal(result.id, 'web');
    assert.ok(typeof result.latencyMs === 'number');
  });

  await t.test('a 5xx with the default interpreter is an outage', async () => {
    const result = await probe('web', 'https://example.com', { fetchImpl: fakeFetch({ status: 500 }) });
    assert.equal(result.status, STATUS.OUTAGE);
  });

  await t.test('a thrown network error is an outage and never propagates', async () => {
    const result = await probe('api', 'https://example.com', {
      fetchImpl: fakeFetch({ throws: new Error('dns failure') }),
    });
    assert.equal(result.status, STATUS.OUTAGE);
    assert.match(result.detail, /dns failure/);
    assert.equal(result.latencyMs, null);
  });

  await t.test('a timeout is reported as no response, not as a raw abort', async () => {
    const result = await probe('api', 'https://example.com', {
      fetchImpl: fakeFetch({ throws: Object.assign(new Error('aborted'), { name: 'AbortError' }) }),
      timeoutMs: 5,
    });
    assert.equal(result.status, STATUS.OUTAGE);
    assert.match(result.detail, /no response within 5ms/);
  });

  await t.test('passes requestInit through, which the RPC tier needs for POST', async () => {
    let seen = null;
    await probe('rpc', 'https://rpc.example.com', {
      fetchImpl: fakeFetch({ status: 200, json: { result: { status: 'healthy' } }, onCall: (_url, init) => { seen = init; } }),
      requestInit: { method: 'POST', body: '{"jsonrpc":"2.0"}' },
      interpret: describeRpcHealth,
    });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.body, '{"jsonrpc":"2.0"}');
    assert.equal(seen.cache, 'no-store');
  });

  await t.test('survives a body that is not JSON', async () => {
    const result = await probe('web', 'https://example.com', { fetchImpl: fakeFetch({ status: 200, json: null }) });
    assert.equal(result.status, STATUS.OPERATIONAL);
  });

  await t.test('always carries a label and a checkedAt timestamp', async () => {
    const result = await probe('web', 'https://example.com', { fetchImpl: fakeFetch({ status: 200 }) });
    assert.equal(result.label, 'Operational');
    assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
  });

  await t.test('reports unknown rather than throwing when fetch is unavailable', async () => {
    const original = globalThis.fetch;
    delete globalThis.fetch;
    try {
      const result = await probe('web', 'https://example.com');
      assert.equal(result.status, STATUS.UNKNOWN);
      assert.match(result.detail, /no fetch implementation available/);
      assert.equal(result.latencyMs, null);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('collectStatus', async (t) => {
  await t.test('folds three tiers into one verdict', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/health')) {
        return { status: 200, json: async () => ({ status: 'ok', dependencies: {} }) };
      }
      if (url.includes('rpc')) {
        return { status: 200, json: async () => ({ result: { status: 'healthy' } }) };
      }
      return { status: 200, json: async () => ({}) };
    };

    const snapshot = await collectStatus({
      endpoints: { api: 'https://api.test', web: 'https://web.test', rpc: 'https://rpc.test' },
      fetchImpl,
    });

    assert.equal(snapshot.checks.length, 3);
    assert.deepEqual(snapshot.checks.map((check) => check.id), ['api', 'web', 'rpc']);
    assert.equal(snapshot.overall.status, STATUS.OPERATIONAL);
    assert.deepEqual(snapshot.overall.affected, []);
  });

  await t.test('an RPC outage drives the overall verdict', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('rpc')) throw new Error('rpc down');
      return { status: 200, json: async () => ({ status: 'ok', dependencies: {} }) };
    };

    const snapshot = await collectStatus({
      endpoints: { api: 'https://api.test', web: 'https://web.test', rpc: 'https://rpc.test' },
      fetchImpl,
    });

    assert.equal(snapshot.overall.status, STATUS.OUTAGE);
    assert.deepEqual(snapshot.overall.affected, ['rpc']);
  });
});
