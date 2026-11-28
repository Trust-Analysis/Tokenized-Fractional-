import express from 'express';
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import { configureAdminAuth, createAdminAuth } from '../src/middleware/auth.js';
import { v1 } from '../src/routes/rwa.js';
import { createFederatedGraphQLServer } from '../src/federation/gateway.js';

const apiKeyService = {
  validate: async (key) => ({ valid: key === 'test-contract-key' }),
};
const app = express();
app.use(express.json());
app.use('/api/v1', v1);
let federation;

beforeAll(async () => {
  configureAdminAuth(createAdminAuth(apiKeyService));
  federation = await createFederatedGraphQLServer({
    apiKeyService,
    dataLayer: { loadData: () => ({}) },
  });
  app.use('/graphql', federation.middleware);
}, 30_000);

afterAll(async () => {
  configureAdminAuth(undefined);
  await federation?.server.stop();
}, 30_000);

const input = {
  contractId: StrKey.encodeContract(Buffer.alloc(32)),
  title: 'Asset',
  description: 'Description',
  location: 'Location',
  assetType: 'real_estate',
};
const query = 'mutation Create($input: RWAInput!) { createAsset(input: $input) { contractId } }';

test.each([
  { title: '' },
  { title: null, location: null },
  { description: '   ' },
  { totalShares: -1 },
  { pricePerShare: 0 },
  { availableShares: -2 },
  { contractId: 'invalid' },
])('rejects invalid asset input consistently across REST and GraphQL (%j)', async (invalid) => {
  const payload = { ...input, ...invalid };
  const rest = await request(app).post('/api/v1/rwa')
    .set('x-api-key', 'test-contract-key').send(payload);
  const graphql = await request(app).post('/graphql')
    .set('x-api-key', 'test-contract-key').send({ query, variables: { input: payload } });
  expect(rest.status).toBe(400);
  expect(graphql.status).toBe(200);
  expect(graphql.body.errors[0].message).toBe(rest.body.error);
});
