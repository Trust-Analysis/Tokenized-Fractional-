const cacheStore = new Map();

const subscribers = new Map();

export function deepMerge(target, source) {
  if (typeof target !== 'object' || target === null) return source ?? target;
  if (typeof source !== 'object' || source === null) return source ?? target;
  if (Array.isArray(target) && Array.isArray(source)) {
    const merged = [...target];
    for (const item of source) {
      const existingIndex = merged.findIndex((e) => e?.id != null && e.id === item.id);
      if (existingIndex >= 0) {
        merged[existingIndex] = deepMerge(merged[existingIndex], item);
      } else {
        merged.push(item);
      }
    }
    return merged;
  }
  if (Array.isArray(target) || Array.isArray(source)) return source;

  const result = { ...target };
  for (const key of Object.keys(source)) {
    result[key] = deepMerge(target[key], source[key]);
  }
  return result;
}

export function setQueryData(key, data) {
  cacheStore.set(key, {
    data: structuredClone(data),
    timestamp: Date.now(),
  });
  notifySubscribers(key, data);
}

export function getQueryData(key) {
  const entry = cacheStore.get(key);
  return entry ? structuredClone(entry.data) : null;
}

export function invalidateQuery(key) {
  cacheStore.delete(key);
  notifySubscribers(key, null);
}

export function subscribeToQuery(key, callback) {
  if (!subscribers.has(key)) {
    subscribers.set(key, new Set());
  }
  subscribers.get(key).add(callback);

  const cached = getQueryData(key);
  if (cached !== null) {
    callback(cached);
  }

  return () => {
    const subs = subscribers.get(key);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(key);
    }
  };
}

function notifySubscribers(key, data) {
  const subs = subscribers.get(key);
  if (subs) {
    subs.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[QueryCache] Subscriber error:', err);
      }
    });
  }
}

export function applySubscriptionDelta(cacheKey, deltaPayload, mergeKey = 'id') {
  const current = cacheStore.get(cacheKey);
  if (!current) return false;

  const merged = deepMerge(current.data, deltaPayload);
  cacheStore.set(cacheKey, {
    data: merged,
    timestamp: Date.now(),
  });
  notifySubscribers(cacheKey, merged);
  return true;
}

export function clearAllCaches() {
  cacheStore.clear();
  subscribers.clear();
}
