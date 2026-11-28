const cacheStore = new Map();

const DEFAULT_TTL = 5 * 60 * 1000;
const STALE_TTL = 30 * 60 * 1000;

function getCacheKey(url, params) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return `${url}${search}`;
}

export const apiCacheService = {
  get(url, params) {
    const key = getCacheKey(url, params);
    const entry = cacheStore.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now < entry.expiresAt) {
      return { data: entry.data, stale: false };
    }
    if (now < entry.staleAt) {
      return { data: entry.data, stale: true };
    }
    cacheStore.delete(key);
    return null;
  },

  set(url, data, params, ttl = DEFAULT_TTL) {
    const key = getCacheKey(url, params);
    cacheStore.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      staleAt: Date.now() + STALE_TTL,
    });
  },

  invalidate(pattern) {
    for (const [key] of cacheStore.entries()) {
      if (key.includes(pattern)) {
        cacheStore.delete(key);
      }
    }
  },

  clear() {
    cacheStore.clear();
  },

  getSize() {
    return cacheStore.size;
  },

  async fetchWithCache(url, options = {}) {
    const { params, ttl, forceRefresh, onStale } = options;

    if (!forceRefresh) {
      const cached = this.get(url, params);
      if (cached) {
        if (cached.stale && onStale) {
          this._refreshInBackground(url, params, ttl);
        }
        return cached.data;
      }
    }

    const search = params ? '?' + new URLSearchParams(params).toString() : '';
    const fullUrl = `${url}${search}`;

    const res = await fetch(fullUrl, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: options.signal,
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const data = await res.json();
    this.set(url, data, params, ttl);
    return data;
  },

  async _refreshInBackground(url, params, ttl) {
    try {
      const search = params ? '?' + new URLSearchParams(params).toString() : '';
      const res = await fetch(`${url}${search}`);
      if (res.ok) {
        const data = await res.json();
        this.set(url, data, params, ttl);
      }
    } catch {
      // Background refresh failed, stale data remains
    }
  },

  createCacheMiddleware(originalFn) {
    const cache = this;
    return async function (...args) {
      const context = args[0];
      const url = typeof context === 'string' ? context : context?.url;
      if (!url) return originalFn.apply(this, args);

      const cached = cache.get(url);
      if (cached) {
        return cached.data;
      }

      const result = await originalFn.apply(this, args);
      cache.set(url, result);
      return result;
    };
  },
};

export function withCache(fetchFn, options = {}) {
  const { ttl, key } = options;
  return async (...args) => {
    const cacheKey = key || JSON.stringify(args);
    const cached = apiCacheService.get(cacheKey);
    if (cached) {
      if (cached.stale) {
        apiCacheService._refreshInBackground(cacheKey, null, ttl);
      }
      return cached.data;
    }
    const result = await fetchFn(...args);
    apiCacheService.set(cacheKey, result, null, ttl);
    return result;
  };
}