/**
 * SDK compatibility tests (Issue #888).
 *
 * Runs against the compiled output in dist/ (`npm test` builds first) using
 * Node's built-in test runner — no extra test dependencies.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  COMPATIBILITY_MATRIX,
  SDK_VERSION,
  checkCompatibility,
  compareVersions,
  extractContractVersion,
  findMatrixRow,
  parseVersion,
  versionSatisfies,
  warnOnIncompatibleCombination,
} from '../dist/compatibility.js';
import { RwaApiClient } from '../dist/rest.js';

test('parseVersion accepts strict semver and rejects anything else', () => {
  assert.deepEqual(parseVersion('0.4.0'), [0, 4, 0]);
  assert.equal(parseVersion('0.4'), null);
  assert.equal(parseVersion('v0.4.0'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
});

test('compareVersions orders versions', () => {
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('0.4.0', '0.5.0'), -1);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.throws(() => compareVersions('0.4', '0.5'));
});

test('versionSatisfies handles exact, wildcard and comparator specs', () => {
  assert.equal(versionSatisfies('0.4.0', '0.4.0'), true);
  assert.equal(versionSatisfies('0.4.1', '0.4.0'), false);
  assert.equal(versionSatisfies('0.4.7', '0.4.x'), true);
  assert.equal(versionSatisfies('0.5.0', '0.4.*'), false);
  assert.equal(versionSatisfies('0.4.2', '>=0.4.0 <0.5.0'), true);
  assert.equal(versionSatisfies('0.5.0', '>=0.4.0 <0.5.0'), false);
  assert.equal(versionSatisfies('nope', '>=0.4.0'), false);
  assert.equal(versionSatisfies('0.4.0', ''), false);
});

test('matrix covers the current SDK version and known deployments', () => {
  const row = findMatrixRow(SDK_VERSION);
  assert.ok(row, `no compatibility matrix row for SDK ${SDK_VERSION}`);
  assert.equal(versionSatisfies(SDK_VERSION, row.sdk), true);
  // Contract 0.4.0 (contracts/src/lib.rs metadata) must be supported.
  assert.equal(row.contractVersions.some((s) => versionSatisfies('0.4.0', s)), true);
  // Backend OpenAPI info.version 2.0.0 must be supported.
  assert.equal(row.apiVersions.some((s) => versionSatisfies('2.0.0', s)), true);
});

test('matrix rows are well-formed', () => {
  for (const row of COMPATIBILITY_MATRIX) {
    assert.ok(row.sdk, 'row must declare an sdk range');
    assert.ok(row.contractVersions.length > 0, 'row must declare contract versions');
    assert.ok(row.apiVersions.length > 0, 'row must declare API versions');
  }
});

test('checkCompatibility passes for a supported combination', () => {
  const report = checkCompatibility({ contractVersion: '0.4.0', apiVersion: '2.0.0' });
  assert.equal(report.compatible, true);
  assert.deepEqual(report.warnings, []);
});

test('checkCompatibility warns on an unsupported contract version', () => {
  const report = checkCompatibility({ contractVersion: '9.9.9', apiVersion: '2.0.0' });
  assert.equal(report.compatible, false);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /contract/i);
  assert.match(report.warnings[0], /9\.9\.9/);
});

test('checkCompatibility warns on an unsupported API version', () => {
  const report = checkCompatibility({ contractVersion: '0.4.0', apiVersion: '1.0.0' });
  assert.equal(report.compatible, false);
  assert.match(report.warnings[0], /REST API/i);
});

test('checkCompatibility skips versions that could not be determined', () => {
  assert.equal(checkCompatibility({}).compatible, true);
  assert.equal(checkCompatibility({ contractVersion: null, apiVersion: null }).compatible, true);
});

test('checkCompatibility warns for an SDK version missing from the matrix', () => {
  const report = checkCompatibility({ sdkVersion: '99.0.0', contractVersion: '0.4.0' });
  assert.equal(report.compatible, false);
  assert.match(report.warnings[0], /compatibility matrix/i);
});

test('warnOnIncompatibleCombination forwards warnings to the warn callback', () => {
  const seen = [];
  const report = warnOnIncompatibleCombination(
    { contractVersion: '9.9.9' },
    (message) => seen.push(message),
  );
  assert.equal(report.compatible, false);
  assert.equal(seen.length, report.warnings.length);
  assert.ok(seen.length > 0);
});

test('extractContractVersion handles native, string and ScVec-shaped values', () => {
  assert.equal(extractContractVersion({ version: '0.4.0' }), '0.4.0');
  assert.equal(extractContractVersion('0.4.0'), '0.4.0');
  assert.equal(extractContractVersion(['Tokenized Fractional', '0.4.0']), '0.4.0');
  assert.equal(extractContractVersion({ version: 'not-a-version' }), null);
  assert.equal(extractContractVersion(null), null);
});

test('RwaApiClient reads the deployed API version and warns on mismatch', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api-docs.json')) {
      return {
        ok: true,
        json: async () => ({ info: { version: '2.0.0' } }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const api = new RwaApiClient({ baseUrl: 'http://localhost:3001', fetch: fakeFetch });
  assert.equal(await api.getApiVersion(), '2.0.0');

  const ok = await api.checkCompatibility(() => {});
  assert.equal(ok.compatible, true);

  const staleFetch = async () => ({
    ok: true,
    json: async () => ({ info: { version: '1.0.0' } }),
  });
  const stale = new RwaApiClient({ baseUrl: 'http://localhost:3001', fetch: staleFetch });
  const seen = [];
  const report = await stale.checkCompatibility((message) => seen.push(message));
  assert.equal(report.compatible, false);
  assert.ok(seen.length > 0);
});
