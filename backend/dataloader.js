/**
 * GraphQL DataLoader Implementation for RWA Marketplace
 * 
 * Provides batched, cached data loading to resolve N+1 query problems,
 * support per-request vs per-context scoping, partial failure handling,
 * custom batching strategies, performance monitoring, and external API caching.
 */

/**
 * Standard DataLoader implementation with batching, caching, per-request scoping,
 * and maxBatchSize limits.
 */
export class DataLoader {
  constructor(batchLoadFn, options = {}) {
    if (typeof batchLoadFn !== 'function') {
      throw new TypeError(`DataLoader must be constructed with a function, got ${typeof batchLoadFn}`);
    }
    this._batchLoadFn = batchLoadFn;
    this._maxBatchSize = options.maxBatchSize || Infinity;
    this._cache = options.cache !== false;
    this._cacheKeyFn = options.cacheKeyFn || ((key) => key);
    this._cacheMap = options.cacheMap || new Map();
    this._batch = null;
  }

  load(key) {
    if (key === null || key === undefined) {
      throw new TypeError(`The loader.load() function must be called with a value, got ${String(key)}`);
    }

    const cacheKey = this._cacheKeyFn(key);

    if (this._cache) {
      const cachedPromise = this._cacheMap.get(cacheKey);
      if (cachedPromise) {
        globalMetrics.cacheHits += 1;
        return cachedPromise;
      }
      globalMetrics.cacheMisses += 1;
    }

    const batch = this._getCurrentBatch();
    const promise = new Promise((resolve, reject) => {
      batch.keys.push(key);
      batch.callbacks.push({ resolve, reject });
    });

    if (this._cache) {
      this._cacheMap.set(cacheKey, promise);
    }

    if (batch.keys.length >= this._maxBatchSize) {
      this._dispatchBatch(batch);
      this._batch = null;
    }

    return promise;
  }

  loadMany(keys) {
    if (!Array.isArray(keys)) {
      throw new TypeError(`The loader.loadMany() function must be called with an Array, got ${String(keys)}`);
    }
    return Promise.all(keys.map((k) => this.load(k).catch((e) => e)));
  }

  clear(key) {
    const cacheKey = this._cacheKeyFn(key);
    this._cacheMap.delete(cacheKey);
    return this;
  }

  clearAll() {
    this._cacheMap.clear();
    return this;
  }

  prime(key, value) {
    const cacheKey = this._cacheKeyFn(key);
    if (!this._cacheMap.has(cacheKey)) {
      const promise = value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      // Suppress unhandled rejections if primed with an Error
      promise.catch(() => {});
      this._cacheMap.set(cacheKey, promise);
    }
    return this;
  }

  _getCurrentBatch() {
    if (this._batch && this._batch.keys.length < this._maxBatchSize && !this._batch.hasDispatched) {
      return this._batch;
    }

    const batch = {
      keys: [],
      callbacks: [],
      hasDispatched: false,
    };

    this._batch = batch;

    // Enqueue dispatch for next microtask tick
    Promise.resolve().then(() => {
      if (!batch.hasDispatched) {
        this._dispatchBatch(batch);
      }
    });

    return batch;
  }

  _dispatchBatch(batch) {
    batch.hasDispatched = true;
    if (this._batch === batch) {
      this._batch = null;
    }

    if (batch.keys.length === 0) return;

    try {
      const batchPromise = this._batchLoadFn(batch.keys);
      if (!batchPromise || typeof batchPromise.then !== 'function') {
        throw new TypeError(
          'DataLoader must be constructed with a function which accepts ' +
          `Array<key> and returns Promise<Array<value>>, got ${String(batchPromise)}`
        );
      }

      batchPromise
        .then((values) => {
          if (!Array.isArray(values) || values.length !== batch.keys.length) {
            throw new TypeError(
              `DataLoader batch function did not return an array of same length as keys (${batch.keys.length})`
            );
          }
          batch.callbacks.forEach((cb, idx) => {
            const val = values[idx];
            if (val instanceof Error) {
              cb.reject(val);
            } else {
              cb.resolve(val);
            }
          });
        })
        .catch((err) => {
          batch.callbacks.forEach((cb) => cb.reject(err));
        });
    } catch (err) {
      batch.callbacks.forEach((cb) => cb.reject(err));
    }
  }
}

// Performance monitoring state
const globalMetrics = {
  batchCount: 0,
  totalKeysBatched: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  executionTimesMs: [],
};

/**
 * Reset or get DataLoader performance metrics
 */
export function getPerformanceMetrics() {
  const times = globalMetrics.executionTimesMs;
  const avgExecutionTimeMs = times.length > 0
    ? times.reduce((a, b) => a + b, 0) / times.length
    : 0;

  return {
    ...globalMetrics,
    avgExecutionTimeMs: Math.round(avgExecutionTimeMs * 100) / 100,
  };
}

export function resetPerformanceMetrics() {
  globalMetrics.batchCount = 0;
  globalMetrics.totalKeysBatched = 0;
  globalMetrics.cacheHits = 0;
  globalMetrics.cacheMisses = 0;
  globalMetrics.errors = 0;
  globalMetrics.executionTimesMs = [];
}

/**
 * Batch loading function for Assets by contractId
 */
async function batchAssets(contractIds, dataLayer, cache) {
  const startTime = Date.now();
  globalMetrics.batchCount += 1;
  globalMetrics.totalKeysBatched += contractIds.length;

  try {
    const results = new Array(contractIds.length);
    const missingIndices = [];
    const missingKeys = [];

    if (cache && typeof cache.get === 'function') {
      for (let i = 0; i < contractIds.length; i += 1) {
        const cached = await cache.get(`asset:${contractIds[i]}`);
        if (cached) {
          globalMetrics.cacheHits += 1;
          results[i] = JSON.parse(cached);
        } else {
          globalMetrics.cacheMisses += 1;
          missingIndices.push(i);
          missingKeys.push(contractIds[i]);
        }
      }
    } else {
      contractIds.forEach((key, idx) => {
        missingIndices.push(idx);
        missingKeys.push(key);
      });
    }

    if (missingKeys.length > 0) {
      const data = dataLayer.loadData();
      missingKeys.forEach((contractId, i) => {
        const targetIndex = missingIndices[i];
        const asset = data[contractId];
        if (!asset) {
          results[targetIndex] = null;
        } else {
          const item = {
            contractId,
            ...asset,
            isPaused: asset.paused || false,
            createdAt: asset.createdAt || new Date().toISOString(),
            updatedAt: asset.updatedAt || new Date().toISOString(),
          };
          results[targetIndex] = item;
          if (cache && typeof cache.set === 'function') {
            cache.set(`asset:${contractId}`, JSON.stringify(item), 60);
          }
        }
      });
    }

    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return results;
  } catch (err) {
    globalMetrics.errors += 1;
    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return contractIds.map(() => err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Batch loading function for Documents by asset contractId
 */
async function batchDocuments(contractIds, dataLayer) {
  const startTime = Date.now();
  globalMetrics.batchCount += 1;
  globalMetrics.totalKeysBatched += contractIds.length;

  try {
    const data = dataLayer.loadData();
    const results = contractIds.map((contractId) => {
      const asset = data[contractId];
      if (!asset || !asset.documents) return [];
      return asset.documents;
    });

    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return results;
  } catch (err) {
    globalMetrics.errors += 1;
    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return contractIds.map(() => err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Batch loading function for Price History by contractId
 */
import { getPriceHistory, invalidatePriceHistoryCache } from './services/priceHistoryCache.js';

async function batchPriceHistory(contractIds, dataLayer) {
  const startTime = Date.now();
  globalMetrics.batchCount += 1;
  globalMetrics.totalKeysBatched += contractIds.length;

  try {
    const data = dataLayer.loadData();

    // For each contractId, try Redis cache first, then fall back to in-memory data
    const results = await Promise.all(contractIds.map(async (contractId) => {
      const asset = data[contractId];
      if (!asset) return [];

      // Use 1D as the default interval for DataLoader batch calls
      const fetchFn = () => {
        if (asset.priceHistory) return Promise.resolve(asset.priceHistory);
        return Promise.resolve([{
          price: asset.pricePerShare || 0,
          timestamp: asset.updatedAt || asset.createdAt || new Date().toISOString(),
        }]);
      };

      return getPriceHistory(contractId, '1D', fetchFn);
    }));

    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return results;
  } catch (err) {
    globalMetrics.errors += 1;
    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return contractIds.map(() => err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Batch loading function for Transactions by contractId or walletAddress
 */
async function batchTransactions(keys, dataLayer) {
  const startTime = Date.now();
  globalMetrics.batchCount += 1;
  globalMetrics.totalKeysBatched += keys.length;

  try {
    const data = dataLayer.loadData();
    const allTxs = [];
    Object.entries(data).forEach(([contractId, asset]) => {
      if (Array.isArray(asset.transactions)) {
        asset.transactions.forEach((tx) => {
          allTxs.push({ contractId, ...tx });
        });
      }
    });

    const results = keys.map((key) => {
      return allTxs.filter(tx => tx.contractId === key || tx.buyer === key || tx.seller === key);
    });

    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return results;
  } catch (err) {
    globalMetrics.errors += 1;
    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return keys.map(() => err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Batch loading function for External API calls
 */
async function batchExternalApi(urls, externalFetcher, cache) {
  const startTime = Date.now();
  globalMetrics.batchCount += 1;
  globalMetrics.totalKeysBatched += urls.length;

  try {
    const results = await Promise.all(urls.map(async (url) => {
      try {
        if (cache && typeof cache.get === 'function') {
          const cached = await cache.get(`ext:${url}`);
          if (cached) {
            globalMetrics.cacheHits += 1;
            return JSON.parse(cached);
          }
          globalMetrics.cacheMisses += 1;
        }
        const data = externalFetcher ? await externalFetcher(url) : { url, status: 'ok', timestamp: new Date().toISOString() };
        if (cache && typeof cache.set === 'function') {
          cache.set(`ext:${url}`, JSON.stringify(data), 300);
        }
        return data;
      } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
      }
    }));

    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return results;
  } catch (err) {
    globalMetrics.errors += 1;
    globalMetrics.executionTimesMs.push(Date.now() - startTime);
    return urls.map(() => err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Factory function creating per-request DataLoader instances
 * 
 * @param {Object} options
 * @param {Object} options.dataLayer - Database / data access layer
 * @param {Object} [options.cache] - Optional L2 caching layer
 * @param {number} [options.maxBatchSize=100] - Batch size optimization limit
 * @param {Function} [options.externalFetcher] - Custom fetcher for external API loader
 * @returns {Object} Scoped DataLoaders for GraphQL request context
 */
export function createDataLoaders(options = {}) {
  const {
    dataLayer,
    cache = null,
    maxBatchSize = 100,
    externalFetcher = null,
  } = options;

  if (!dataLayer) {
    throw new Error('createDataLoaders requires a valid dataLayer instance');
  }

  const loaderOptions = {
    maxBatchSize,
    cache: true,
  };

  const assetLoader = new DataLoader(
    (keys) => batchAssets(keys, dataLayer, cache),
    loaderOptions
  );

  const documentsLoader = new DataLoader(
    (keys) => batchDocuments(keys, dataLayer),
    loaderOptions
  );

  const priceHistoryLoader = new DataLoader(
    (keys) => batchPriceHistory(keys, dataLayer),
    loaderOptions
  );

  const transactionsLoader = new DataLoader(
    (keys) => batchTransactions(keys, dataLayer),
    loaderOptions
  );

  const externalApiLoader = new DataLoader(
    (keys) => batchExternalApi(keys, externalFetcher, cache),
    loaderOptions
  );

  return {
    assetLoader,
    documentsLoader,
    priceHistoryLoader,
    transactionsLoader,
    externalApiLoader,

    clearAll() {
      assetLoader.clearAll();
      documentsLoader.clearAll();
      priceHistoryLoader.clearAll();
      transactionsLoader.clearAll();
      externalApiLoader.clearAll();
    },
    primeAll(assetMap = {}) {
      Object.entries(assetMap).forEach(([contractId, asset]) => {
        assetLoader.prime(contractId, { contractId, ...asset });
      });
    },
    getMetrics: getPerformanceMetrics,
  };
}

export default DataLoader;
