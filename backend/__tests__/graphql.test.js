/**
 * GraphQL API Tests
 *
 * Tests for GraphQL queries and mutations using Apollo Server test client.
 */

import { ApolloServer } from '@apollo/server';
import { typeDefs, createResolvers } from '../graphql.js';

describe('GraphQL API', () => {
  let server;

  // Mock data layer
  const mockDataLayer = {
    data: {
      CTEST123456789012345678901234567890123456789012: {
        title: 'Test Asset',
        location: 'Test City',
        description: 'Test Description',
        assetType: 'residential',
        totalShares: 100,
        pricePerShare: 1000000,
        availableShares: 50,
        paused: false,
        createdAt: '2026-06-30T00:00:00Z',
        updatedAt: '2026-06-30T00:00:00Z',
      },
    },
    loadData() {
      return this.data;
    },
    saveData(data) {
      this.data = data;
    },
    validateContractId: (id) => typeof id === 'string' && id.length >= 50 && id.startsWith('C'),
    validateRwaBody: (body) => {
      const required = ['title', 'location', 'description', 'assetType'];
      const missing = required.filter((f) => !body[f]);
      return missing.length > 0 ? `Missing: ${missing.join(', ')}` : null;
    },
    scoreSearch: (query, data) => Object.keys(data).map((id) => ({ contractId: id, score: 1 })),
    syncSearchIndex() {},
  };

  beforeEach(async () => {
    server = new ApolloServer({
      typeDefs,
      resolvers: createResolvers(mockDataLayer),
      context: ({ req }) => {
        const apiKey = req?.headers['x-api-key'];
        return { isAdmin: apiKey === 'test-admin-key' };
      },
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Queries', () => {
    test('should query all assets', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            assets {
              contractId
              title
              location
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.assets).toHaveLength(1);
      expect(result.data.assets[0].title).toBe('Test Asset');
    });

    test('should query single asset by contractId', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            asset(contractId: "CTEST123456789012345678901234567890123456789012") {
              contractId
              title
              pricePerShare
              availableShares
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.asset).toBeDefined();
      expect(result.data.asset.title).toBe('Test Asset');
      expect(result.data.asset.pricePerShare).toBe(1000000);
    });

    test('should return null for non-existent asset', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            asset(contractId: "CNONEXISTENT123456789012345678901234567890")
          {
              title
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.asset).toBeNull();
    });

    test('should get assets count', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            assetsCount
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.assetsCount).toBe(1);
    });

    test('should get marketplace statistics', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            statistics {
              totalAssets
              pendingAssets
              totalSharesAvailable
              averagePricePerShare
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.statistics).toBeDefined();
      expect(result.data.statistics.totalAssets).toBe(1);
      expect(result.data.statistics.totalSharesAvailable).toBe(50);
    });

    test('should filter assets by search term', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            assets(filter: { search: "Test" }) {
              contractId
              title
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.assets.length).toBeGreaterThan(0);
    });

    test('should apply pagination', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            assets(limit: 1, offset: 0) {
              contractId
            }
          }
        `,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.assets).toHaveLength(1);
    });

    test('should return pending assets only for admin', async () => {
      mockDataLayer.data.CPENDING123456789012345678901234567890123456789012 = {
        title: 'Pending Asset',
        location: 'Pending City',
        description: 'Pending Description',
        assetType: 'commercial_real_estate',
        pending: true,
        paused: false,
        createdAt: '2026-06-30T00:00:00Z',
        updatedAt: '2026-06-30T00:00:00Z',
      };

      const result = await server.executeOperation(
        {
          query: `
            query {
              pendingAssets {
                contractId
                title
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.pendingAssets.length).toBeGreaterThan(0);
    });

    test('should deny pending assets for non-admin', async () => {
      const result = await server.executeOperation(
        {
          query: `
            query {
              pendingAssets {
                contractId
              }
            }
          `,
        },
        { req: { headers: {} } },
      );

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Unauthorized');
    });
  });

  describe('Mutations', () => {
    test('should create asset with admin key', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              createAsset(
                input: {
                  title: "New Asset"
                  location: "New City"
                  description: "New Description"
                  assetType: "commercial_real_estate"
                  totalShares: 500
                  pricePerShare: 5000000
                  availableShares: 500
                }
              ) {
                contractId
                title
                isPaused
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.createAsset).toBeDefined();
      expect(result.data.createAsset.title).toBe('New Asset');
      expect(result.data.createAsset.isPaused).toBe(false);
    });

    test('should deny create asset without admin key', async () => {
      const result = await server.executeOperation({
        query: `
          mutation {
            createAsset(
              input: {
                title: "Unauthorized Asset"
                location: "City"
                description: "Description"
                assetType: "residential"
              }
            ) {
              contractId
            }
          }
        `,
      });

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Unauthorized');
    });

    test('should validate required fields on create', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              createAsset(
                input: {
                  title: "Incomplete Asset"
                }
              ) {
                contractId
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Missing');
    });

    test('should update asset', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              updateAsset(
                contractId: "CTEST123456789012345678901234567890123456789012"
                input: {
                  title: "Updated Asset"
                  location: "Updated City"
                  description: "Updated Description"
                  assetType: "residential"
                  totalShares: 200
                  pricePerShare: 2000000
                  availableShares: 100
                }
              ) {
                contractId
                title
                pricePerShare
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.updateAsset.title).toBe('Updated Asset');
      expect(result.data.updateAsset.pricePerShare).toBe(2000000);
    });

    test('should approve pending asset', async () => {
      mockDataLayer.data.CTEST123456789012345678901234567890123456789012.pending = true;

      const result = await server.executeOperation(
        {
          query: `
            mutation {
              approveAsset(contractId: "CTEST123456789012345678901234567890123456789012") {
                contractId
                title
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.approveAsset).toBeDefined();
    });

    test('should pause asset', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              pauseAsset(contractId: "CTEST123456789012345678901234567890123456789012") {
                contractId
                isPaused
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.pauseAsset.isPaused).toBe(true);
    });

    test('should unpause asset', async () => {
      mockDataLayer.data.CTEST123456789012345678901234567890123456789012.paused = true;

      const result = await server.executeOperation(
        {
          query: `
            mutation {
              unpauseAsset(contractId: "CTEST123456789012345678901234567890123456789012") {
                contractId
                isPaused
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.unpauseAsset.isPaused).toBe(false);
    });

    test('should delete asset', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              deleteAsset(contractId: "CTEST123456789012345678901234567890123456789012")
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.deleteAsset).toBe(true);
      expect(
        mockDataLayer.loadData().CTEST123456789012345678901234567890123456789012,
      ).toBeUndefined();
    });

    test('should return error for invalid contract ID', async () => {
      const result = await server.executeOperation(
        {
          query: `
            mutation {
              updateAsset(
                contractId: "INVALID"
                input: {
                  title: "Title"
                  location: "Location"
                  description: "Description"
                  assetType: "residential"
                }
              ) {
                contractId
              }
            }
          `,
        },
        { req: { headers: { 'x-api-key': 'test-admin-key' } } },
      );

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Invalid contract ID');
    });
  });
});
