/**
 * Persisted-query enforcement tests (Issue #885).
 *
 * Verifies that, with persisted-query enforcement enabled, an arbitrary
 * unregistered (ad-hoc) GraphQL query is *rejected* — not merely that a
 * registered query succeeds — and that enforcement is a no-op when disabled.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import {
  PERSISTED_QUERY_ENFORCEMENT_CODE,
  createPersistedQueryEnforcementMiddleware,
  createPersistedQueryRegistry,
  hashQuery,
  isPersistedQueryEnforcementEnabled,
  loadPersistedQueryRegistryFile,
  normalizeQuery,
} from '../src/middleware/persistedQueryEnforcement.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const REGISTRY_FILE = join(FIXTURES_DIR, 'persisted-queries.json');

const REGISTERED_QUERY = 'query GetAssetsCount { assetsCount }';
const REGISTERED_HASH = hashQuery(REGISTERED_QUERY);
const UNREGISTERED_HASH = 'f'.repeat(64);

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function runMiddleware(middleware, req) {
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe('persistedQueryEnforcement middleware (unit)', () => {
  test('hash normalization matches query registration (whitespace-insensitive)', () => {
    expect(normalizeQuery('  query   GetAssetsCount\n{  assetsCount  }  '))
      .toBe('query GetAssetsCount { assetsCount }');
    expect(hashQuery('query   GetAssetsCount { assetsCount }')).toBe(REGISTERED_HASH);
  });

  test('registry built from raw query strings and explicit hashes', () => {
    const registry = createPersistedQueryRegistry([
      REGISTERED_QUERY,
      { hash: UNREGISTERED_HASH },
      { queryString: 'query Foo { foo }' },
    ]);
    expect(registry.isRegistered(REGISTERED_HASH)).toBe(true);
    expect(registry.isRegistered(UNREGISTERED_HASH)).toBe(true);
    expect(registry.isRegistered(hashQuery('query Foo { foo }'))).toBe(true);
    expect(registry.isRegistered(UNREGISTERED_HASH.replace(/f$/, 'e'))).toBe(false);
  });

  test('registry file loader accepts the documented JSON shape', () => {
    const registry = loadPersistedQueryRegistryFile(REGISTRY_FILE);
    // hash derived from the fixture's queryString entry
    expect(registry.isRegistered(REGISTERED_HASH)).toBe(true);
    // explicit hash entry from the fixture
    expect(registry.isRegistered(`${'0'.repeat(63)}1`)).toBe(true);
    // anything else stays unregistered
    expect(registry.isRegistered(UNREGISTERED_HASH)).toBe(false);
  });

  test('disabled by default: arbitrary ad-hoc query passes through', () => {
    expect(isPersistedQueryEnforcementEnabled()).toBe(false);
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: false,
      registry: createPersistedQueryRegistry([REGISTERED_QUERY]),
    });
    const { nextCalled, res } = runMiddleware(middleware, {
      method: 'POST',
      body: { query: 'query Sneaky { assetsCount }' },
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  test('enabled: arbitrary unregistered ad-hoc query is REJECTED (403)', () => {
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: true,
      registry: createPersistedQueryRegistry([REGISTERED_QUERY]),
      logger: { info() {}, warn() {}, error() {} },
    });
    const { nextCalled, res } = runMiddleware(middleware, {
      method: 'POST',
      body: { query: 'query Sneaky { assetsCount }' },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.errors[0].extensions.code).toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });

  test('enabled: unregistered APQ hash is REJECTED (403)', () => {
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: true,
      registry: createPersistedQueryRegistry([REGISTERED_QUERY]),
      logger: { info() {}, warn() {}, error() {} },
    });
    const { nextCalled, res } = runMiddleware(middleware, {
      method: 'POST',
      body: { extensions: { persistedQuery: { sha256Hash: UNREGISTERED_HASH } } },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.errors[0].extensions.code).toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });

  test('enabled: registered APQ hash passes and inline query is stripped', () => {
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: true,
      registry: createPersistedQueryRegistry([REGISTERED_QUERY]),
      logger: { info() {}, warn() {}, error() {} },
    });
    const body = {
      query: 'query Sneaky { secretField }',
      extensions: { persistedQuery: { sha256Hash: REGISTERED_HASH } },
    };
    const { nextCalled, res } = runMiddleware(middleware, { method: 'POST', body });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(body.query).toBeUndefined();
  });

  test('enabled: inline query matching a registered query passes', () => {
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: true,
      registry: createPersistedQueryRegistry([REGISTERED_QUERY]),
      logger: { info() {}, warn() {}, error() {} },
    });
    const { nextCalled } = runMiddleware(middleware, {
      method: 'POST',
      body: { query: 'query   GetAssetsCount\n{  assetsCount  }' },
    });
    expect(nextCalled).toBe(true);
  });

  test('enabled without allowlist fails closed: everything is rejected', () => {
    const middleware = createPersistedQueryEnforcementMiddleware({
      enabled: true,
      registryFile: join(FIXTURES_DIR, 'does-not-exist.json'),
      logger: { info() {}, warn() {}, error() {} },
    });
    const { nextCalled, res } = runMiddleware(middleware, {
      method: 'POST',
      body: { query: REGISTERED_QUERY },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.errors[0].extensions.code).toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });
});

describe('GraphQL endpoint enforcement (integration over HTTP)', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PERSISTED_QUERY_ENFORCEMENT = 'true';
    process.env.PERSISTED_QUERIES_FILE = REGISTRY_FILE;

    // Mirrors the production mount order in backend/index.js:
    // enforcement middleware registered directly in front of the GraphQL handler.
    const testApp = express();
    testApp.use(express.json({ limit: '10kb' }));
    testApp.use(
      '/api/graphql',
      createPersistedQueryEnforcementMiddleware({ logger: { info() {}, warn() {}, error() {} } }),
    );
    testApp.use('/api/graphql', (_req, res) => res.json({ data: { stub: true } }));

    await new Promise((resolve) => {
      server = testApp.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    delete process.env.PERSISTED_QUERY_ENFORCEMENT;
    delete process.env.PERSISTED_QUERIES_FILE;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function postGraphql(payload) {
    const response = await fetch(`${baseUrl}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  test('arbitrary unregistered ad-hoc query is rejected with 403 PERSISTED_QUERY_NOT_REGISTERED', async () => {
    const { status, body } = await postGraphql({ query: 'query Sneaky { assetsCount }' });

    expect(status).toBe(403);
    expect(body.errors).toBeDefined();
    expect(body.errors[0].extensions.code).toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });

  test('unregistered APQ hash is rejected with 403 PERSISTED_QUERY_NOT_REGISTERED', async () => {
    const { status, body } = await postGraphql({
      extensions: { persistedQuery: { sha256Hash: UNREGISTERED_HASH } },
    });

    expect(status).toBe(403);
    expect(body.errors[0].extensions.code).toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });

  test('registered persisted query is NOT rejected by enforcement', async () => {
    const { status, body } = await postGraphql({
      extensions: { persistedQuery: { sha256Hash: REGISTERED_HASH } },
    });

    expect(status).not.toBe(403);
    expect(body?.errors?.[0]?.extensions?.code).not.toBe(PERSISTED_QUERY_ENFORCEMENT_CODE);
  });
});
