# PR Description — Redis Caching Layer

## Summary

Adds a Redis caching layer to the backend using `ioredis`. GET responses are cached with a configurable TTL. The cache is invalidated on every POST and DELETE. When Redis is unavailable the API falls back to direct file reads transparently — no errors surface to clients.

---

## Motivation

Every GET request previously read and parsed the JSON data file from disk on every call. Under any meaningful load this becomes a bottleneck. A Redis cache reduces per-request I/O to a single network round-trip for cache hits, and eliminates it entirely for warm in-process scenarios.

---

## What Changed

### New file: `backend/cache.js`

A thin module that owns the ioredis client and exposes three async helpers:

| Function | Description |
|---|---|
| `cacheGet(key)` | Returns parsed JSON from Redis, or `null` on miss / error |
| `cacheSet(key, value)` | Stores JSON-serialised value with TTL |
| `cacheDel(...keys)` | Deletes one or more keys (used for invalidation) |
| `initClient()` | Connects to Redis — called at startup in non-test envs |
| `setClient(mock)` | Injects a mock or `null` for testing |

All three async helpers are wrapped in `try/catch`. If Redis is down or throws, the function returns `null` / resolves silently. The API continues serving from the data file.

### Modified: `backend/index.js`

| Route | Change |
|---|---|
| `GET /api/rwa` | Check `rwa:all` cache first; populate on miss |
| `GET /api/rwa/:contractId` | Check `rwa:<contractId>` cache first; populate on miss |
| `POST /api/rwa` | Invalidate `rwa:all` and `rwa:<contractId>` after write |
| `DELETE /api/rwa/:contractId` | Invalidate `rwa:all` and `rwa:<contractId>` after delete |

### New file: `backend/__tests__/cache.test.js`

Tests use an in-memory mock Redis client (a plain object with a `Map` store) injected via `setClient()`. No real Redis instance is required to run the test suite.

Covers:
- `cacheSet` / `cacheGet` round-trip
- `cacheDel` removes keys
- Graceful fallback when client is `null`
- `GET /api/rwa` populates `rwa:all` cache
- `POST /api/rwa` invalidates `rwa:all`
- `DELETE /api/rwa/:contractId` invalidates both `rwa:all` and the per-asset key
- `GET /api/rwa/:contractId` populates and serves from per-asset cache

---

## Configuration

Add to `backend/.env`:

```env
# Redis connection (optional — API works without Redis)
REDIS_URL=redis://localhost:6379

# Cache TTL in seconds (default: 60)
CACHE_TTL_SECONDS=60
```

If `REDIS_URL` is not set, defaults to `redis://localhost:6379`. If Redis is not reachable the API operates in pass-through mode (no caching, no errors).

---

## Cache Key Design

| Key | Scope | Invalidated by |
|---|---|---|
| `rwa:all` | Full asset list | POST, DELETE |
| `rwa:<contractId>` | Single asset | POST (upsert), DELETE |

---

## Graceful Fallback

The `ioredis` client is created with:
- `lazyConnect: true` — no immediate connection attempt at import time
- `maxRetriesPerRequest: 0` — fail fast, don't retry individual commands
- `enableOfflineQueue: false` — reject commands immediately when disconnected
- `connectTimeout: 2000` — 2 s connection timeout

All `cacheGet` / `cacheSet` / `cacheDel` calls are wrapped in `try/catch`. Any Redis error is silently swallowed and the request falls through to the data file. Clients never see a Redis error.

---

## Testing

```
npm test   # 30/30 tests pass
```

No real Redis instance required. The mock client is injected via `setClient()`.

---

Closes #17
