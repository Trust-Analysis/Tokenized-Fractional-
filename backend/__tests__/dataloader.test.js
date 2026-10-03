import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DataLoader,
  createDataLoaders,
  getPerformanceMetrics,
  resetPerformanceMetrics,
} from '../dataloader.js';

describe('GraphQL DataLoader Implementation (#292)', () => {
  let mockDataLayer;

  beforeEach(() => {
    resetPerformanceMetrics();
    let loadCount = 0;
    mockDataLayer = {
      getLoadCount: () => loadCount,
      loadData: () => {
        loadCount += 1;
        return {
          C1: {
            title: 'Asset One',
            location: 'NY',
            description: 'Desc 1',
            assetType: 'commercial_real_estate',
            pricePerShare: 100,
            availableShares: 50,
            documents: [{ name: 'doc1.pdf', hash: 'hash1' }],
            priceHistory: [{ price: 100, timestamp: '2026-01-01T00:00:00Z' }],
            transactions: [{ buyer: 'wallet1', shareCount: 5, totalPrice: 500 }],
          },
          C2: {
            title: 'Asset Two',
            location: 'CA',
            description: 'Desc 2',
            assetType: 'residential',
            pricePerShare: 200,
            availableShares: 100,
            documents: [{ name: 'doc2.pdf', hash: 'hash2' }],
          },
        };
      },
    };
  });

  it('batches multiple load requests for assets in a single tick', async () => {
    const loaders = createDataLoaders({ dataLayer: mockDataLayer });

    const [a1, a2] = await Promise.all([
      loaders.assetLoader.load('C1'),
      loaders.assetLoader.load('C2'),
    ]);

    assert.equal(a1.title, 'Asset One');
    assert.equal(a2.title, 'Asset Two');
    assert.equal(mockDataLayer.getLoadCount(), 1);

    const metrics = getPerformanceMetrics();
    assert.equal(metrics.batchCount, 1);
    assert.equal(metrics.totalKeysBatched, 2);
  });

  it('caches loaded keys within the same DataLoader instance (per-request scoping)', async () => {
    const loaders = createDataLoaders({ dataLayer: mockDataLayer });

    const first = await loaders.assetLoader.load('C1');
    const second = await loaders.assetLoader.load('C1');

    assert.equal(first, second);
    assert.equal(mockDataLayer.getLoadCount(), 1);

    const metrics = getPerformanceMetrics();
    assert.equal(metrics.cacheHits, 1);
  });

  it('isolates cache between different request contexts (per-request scoping)', async () => {
    const req1Loaders = createDataLoaders({ dataLayer: mockDataLayer });
    const req2Loaders = createDataLoaders({ dataLayer: mockDataLayer });

    await req1Loaders.assetLoader.load('C1');
    await req2Loaders.assetLoader.load('C1');

    assert.equal(mockDataLayer.getLoadCount(), 2);
  });

  it('handles batch size optimization with maxBatchSize limit', async () => {
    const loaders = createDataLoaders({ dataLayer: mockDataLayer, maxBatchSize: 1 });

    await Promise.all([
      loaders.assetLoader.load('C1'),
      loaders.assetLoader.load('C2'),
    ]);

    const metrics = getPerformanceMetrics();
    assert.equal(metrics.batchCount, 2);
  });

  it('handles partial batch failures gracefully returning Error objects', async () => {
    const errorDataLayer = {
      loadData: () => {
        throw new Error('Database connection failed');
      },
    };

    const loaders = createDataLoaders({ dataLayer: errorDataLayer });

    await assert.rejects(
      async () => {
        await loaders.assetLoader.load('C1');
      },
      { message: 'Database connection failed' }
    );
    const metrics = getPerformanceMetrics();
    assert.equal(metrics.errors, 1);
  });

  it('supports documentsLoader, priceHistoryLoader, and transactionsLoader', async () => {
    const loaders = createDataLoaders({ dataLayer: mockDataLayer });

    const [docs, priceHist, txs] = await Promise.all([
      loaders.documentsLoader.load('C1'),
      loaders.priceHistoryLoader.load('C1'),
      loaders.transactionsLoader.load('C1'),
    ]);

    assert.equal(docs.length, 1);
    assert.equal(docs[0].name, 'doc1.pdf');
    assert.equal(priceHist[0].price, 100);
    assert.equal(txs[0].buyer, 'wallet1');
  });

  it('supports externalApiLoader with caching layer integration', async () => {
    const mockCacheMap = new Map();
    const mockCache = {
      get: async (key) => mockCacheMap.get(key),
      set: async (key, val) => mockCacheMap.set(key, val),
    };
    let fetchCount = 0;
    const mockFetcher = async (url) => {
      fetchCount += 1;
      return { url, data: 'rate_usd_xlm: 0.12' };
    };

    const loaders = createDataLoaders({
      dataLayer: mockDataLayer,
      cache: mockCache,
      externalFetcher: mockFetcher,
    });

    const res1 = await loaders.externalApiLoader.load('https://api.example.com/rate');
    assert.equal(res1.data, 'rate_usd_xlm: 0.12');
    assert.equal(fetchCount, 1);

    const loaders2 = createDataLoaders({
      dataLayer: mockDataLayer,
      cache: mockCache,
      externalFetcher: mockFetcher,
    });

    const res2 = await loaders2.externalApiLoader.load('https://api.example.com/rate');
    assert.equal(res2.data, 'rate_usd_xlm: 0.12');
    assert.equal(fetchCount, 1);
  });

  it('provides testing utilities for clearing and priming loaders', async () => {
    const loaders = createDataLoaders({ dataLayer: mockDataLayer });

    loaders.primeAll({ C99: { title: 'Primed Asset' } });
    const primedAsset = await loaders.assetLoader.load('C99');
    assert.equal(primedAsset.title, 'Primed Asset');

    loaders.clearAll();
    await loaders.assetLoader.load('C1');
    assert.equal(mockDataLayer.getLoadCount(), 1);
  });
});
