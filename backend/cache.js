import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 60;

let client = null;

function connect() {
  const c = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  c.on('error', () => {}); // suppress unhandled error events
  c.connect().catch(() => {});
  return c;
}

// Called once at startup (non-test environments)
export function initClient() {
  if (!client) client = connect();
}

// Allow tests to inject a mock or null (disabled)
export function setClient(mock) {
  client = mock;
}

export async function cacheGet(key) {
  if (!client) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', CACHE_TTL);
  } catch {
    // silent fallback
  }
}

export async function cacheDel(...keys) {
  if (!client) return;
  try {
    await client.del(...keys);
  } catch {
    // silent fallback
  }
}
