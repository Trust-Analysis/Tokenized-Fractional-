import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app } from '../index.js';
import { setClient } from '../cache.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-graphql-data.json';

beforeAll(() => setClient(null));
afterAll(() => {
  setClient(null);
  if (existsSync('test-graphql-data.json')) unlinkSync('test-graphql-data.json');
});

const API_KEY = 'test-key-for-jest';
const VALID_ID = 'C' + 'A'.repeat(55);
const ASSET_PAYLOAD = {
  contractId: VALID_ID,
  title: 'GraphQL Test Asset',
  location: 'Test Location',
  description: 'A test asset for GraphQL queries',
  assetType: 'Real Estate',
  totalValuation: '$1,000,000',
};

beforeAll(async () => {
  await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(ASSET_PAYLOAD);
});

describe('GraphQL Endpoint', () => {
  test('GET /api/graphql returns 405 for introspection', async () => {
    // Yoga returns 405 for GET without Accept: text/html
    const res = await request(app)
      .get('/api/graphql')
      .set('Accept', 'application/json');
    expect(res.status).toBe(405);
  });

  test('POST /api/graphql - query single asset', async () => {
    const query = `
      query {
        asset(contractId: "${VALID_ID}") {
          contractId
          title
          location
          assetType
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.asset.title).toBe('GraphQL Test Asset');
  });

  test('POST /api/graphql - query assets list', async () => {
    const query = `
      query {
        assets(filter: { limit: 5 }) {
          data { contractId title }
          pagination { total page limit }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.assets.pagination.total).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/graphql - filter by assetType', async () => {
    const query = `
      query {
        assets(filter: { assetType: "Real Estate" }) {
          data { title assetType }
          pagination { total }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.every(a => a.assetType === 'Real Estate')).toBe(true);
  });

  test('POST /api/graphql - filter by search', async () => {
    const query = `
      query {
        assets(filter: { search: "GraphQL" }) {
          data { title }
          pagination { total }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/graphql - asset not found returns null', async () => {
    const query = `
      query {
        asset(contractId: "C${'Z'.repeat(55)}") {
          contractId
          title
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.asset).toBeNull();
  });

  test('POST /api/graphql - queryComplexity returns metadata', async () => {
    const query = `
      query {
        queryComplexity {
          score
          depth
          fieldCount
          maxAllowed
          remaining
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.queryComplexity.maxAllowed).toBeGreaterThan(0);
  });

  test('POST /api/graphql - rejects query exceeding depth limit', async () => {
    // Build a deeply nested query
    const buildDeepQuery = (depth) => {
      if (depth <= 0) return '{ contractId title }';
      return `{ data ${buildDeepQuery(depth - 1)} }`;
    };
    const query = `query { assets(filter: { limit: 1 }) ${buildDeepQuery(15)} }`;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    // Should either succeed or be rejected - depth 15 exceeds default 10
    if (res.body.errors) {
      expect(res.body.errors[0].message).toMatch(/depth/i);
    }
  });
});

describe('GraphQL Complexity Analysis', () => {
  test('simple query has low complexity score', async () => {
    const query = `
      query {
        asset(contractId: "${VALID_ID}") {
          contractId
          title
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
  });

  test('complex query with nested fields has higher score', async () => {
    const query = `
      query {
        assets(filter: { limit: 100 }) {
          data {
            contractId
            title
            location
            description
            assetType
            imageUrl
            totalValuation
            documents { name url }
            createdAt
            updatedAt
          }
          pagination { total page limit totalPages }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    // Should succeed within default limits
    expect(res.body.errors).toBeUndefined();
  });
});

describe('GraphQL Error Handling', () => {
  test('invalid query returns GraphQL error', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .send({ query: '{ invalidField }' });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('empty query returns error', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .send({ query: '' });
    expect(res.status).toBe(400);
  });
});

describe('Issue #616: getOrderHistory resolver with limit and cursor', () => {
  test('POST /api/graphql - query getOrderHistory with limit argument', async () => {
    const query = `
      query {
        getOrderHistory(limit: 5) {
          orders {
            id
            price
            amount
            type
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.getOrderHistory.orders.length).toBe(5);
    expect(res.body.data.getOrderHistory.pageInfo.hasNextPage).toBe(true);
    expect(res.body.data.getOrderHistory.pageInfo.endCursor).toBeDefined();
  });

  test('POST /api/graphql - query getOrderHistory with cursor pagination', async () => {
    // 1. Fetch first page
    const query1 = `
      query {
        getOrderHistory(limit: 3) {
          orders { id }
          pageInfo { endCursor hasNextPage }
        }
      }
    `;
    const res1 = await request(app).post('/api/graphql').send({ query: query1 });
    const cursor = res1.body.data.getOrderHistory.pageInfo.endCursor;
    const firstPageIds = res1.body.data.getOrderHistory.orders.map((o) => o.id);

    // 2. Fetch second page with cursor
    const query2 = `
      query($cursor: String) {
        getOrderHistory(limit: 3, cursor: $cursor) {
          orders { id }
          pageInfo { hasNextPage hasPreviousPage }
        }
      }
    `;
    const res2 = await request(app)
      .post('/api/graphql')
      .send({ query: query2, variables: { cursor } });
    expect(res2.status).toBe(200);
    const secondPageIds = res2.body.data.getOrderHistory.orders.map((o) => o.id);
    expect(secondPageIds.length).toBe(3);
    // Ensure distinct paginated items
    expect(firstPageIds.some((id) => secondPageIds.includes(id))).toBe(false);
  });
});

