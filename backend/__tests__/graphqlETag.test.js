import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app } from '../index.js';
import { setClient } from '../cache.js';
import { computeETag, invalidateLedger, getLedgerRevision } from '../graphql/etag.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-graphql-etag-data.json';

beforeAll(() => setClient(null));
afterAll(() => {
  setClient(null);
  if (existsSync('test-graphql-etag-data.json')) unlinkSync('test-graphql-etag-data.json');
});

const API_KEY = 'test-key-for-jest';
const VALID_ID = 'C' + 'B'.repeat(55);
const OTHER_ID = 'C' + 'D'.repeat(55);
const ASSET_PAYLOAD = {
  contractId: VALID_ID,
  title: 'ETag Test Asset',
  location: 'ETag Location',
  description: 'An asset used to exercise GraphQL ETag caching',
  assetType: 'Real Estate',
  totalValuation: '$2,000,000',
};

const SINGLE_ASSET_QUERY = `
  query {
    asset(contractId: "${VALID_ID}") {
      contractId
      title
      location
      assetType
    }
  }
`;

function etagOf(res) {
  return res.headers.etag;
}

beforeAll(async () => {
  await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(ASSET_PAYLOAD);
});

function stripQuotes(etag) {
  return etag ? etag.replace(/^"|"$/g, '') : '';
}

describe('Issue #413: Deterministic ETag caching for GraphQL responses', () => {
  test('single-vault query returns 200 with an ETag header', async () => {
    const res = await request(app).post('/api/graphql').send({ query: SINGLE_ASSET_QUERY });
    expect(res.status).toBe(200);
    expect(res.body.data.asset.title).toBe('ETag Test Asset');
    expect(etagOf(res)).toBeTruthy();
  });

  test('unchanged vault query returns 304 Not Modified when If-None-Match matches', async () => {
    const first = await request(app).post('/api/graphql').send({ query: SINGLE_ASSET_QUERY });
    expect(first.status).toBe(200);
    const etag = etagOf(first);

    const second = await request(app)
      .post('/api/graphql')
      .set('If-None-Match', etag)
      .send({ query: SINGLE_ASSET_QUERY });

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
    expect(etagOf(second)).toBe(etag);
  });

  test('mismatched If-None-Match returns full 200 response', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('If-None-Match', '"deadbeef"')
      .send({ query: SINGLE_ASSET_QUERY });
    expect(res.status).toBe(200);
    expect(res.body.data.asset.title).toBe('ETag Test Asset');
  });

  test('ETag is deterministic for the same ledger state and vault', () => {
    expect(computeETag(VALID_ID)).toBe(computeETag(VALID_ID));
    // Different vaults under the same revision hash differently
    expect(computeETag(VALID_ID)).not.toBe(computeETag(OTHER_ID));
  });

  test('ETag changes after a data mutation invalidates the cache', async () => {
    const before = await request(app).post('/api/graphql').send({ query: SINGLE_ASSET_QUERY });
    const etagBefore = etagOf(before);

    // Mutate the underlying data through the REST API (bumps ledger revision)
    await request(app)
      .patch('/api/rwa/' + VALID_ID)
      .set('x-api-key', API_KEY)
      .send({ title: 'ETag Test Asset (updated)' });

    const after = await request(app)
      .post('/api/graphql')
      .set('If-None-Match', etagBefore)
      .send({ query: SINGLE_ASSET_QUERY });

    expect(after.status).toBe(200);
    expect(after.body.data.asset.title).toBe('ETag Test Asset (updated)');
    expect(stripQuotes(etagOf(after))).not.toBe(stripQuotes(etagBefore));
  });

  test('list (non-single-vault) queries are not short-circuited and still work', async () => {
    const query = `query { assets(filter: { limit: 5 }) { data { contractId } pagination { total } } }`;
    const res = await request(app)
      .post('/api/graphql')
      .set('If-None-Match', '"anything"')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.pagination.total).toBeGreaterThanOrEqual(1);
  });

  test('invalidates through invalidateLedger() directly', () => {
    const revBefore = getLedgerRevision();
    invalidateLedger();
    expect(getLedgerRevision()).not.toBe(revBefore);
  });
});
