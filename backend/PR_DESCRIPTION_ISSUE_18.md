# PR Description — Health Check with Dependency Status

## Summary

Extends the existing `GET /health` endpoint from a simple liveness ping to a full dependency health check that reports the status of each external component individually.

---

## What Changed

### `GET /health` — new response shape

**Before:**
```json
{ "status": "ok", "timestamp": "2026-06-24T15:00:00.000Z" }
```

**After:**
```json
{
  "status": "ok",
  "timestamp": "2026-06-24T15:00:00.000Z",
  "dependencies": {
    "storage": { "status": "ok", "path": "/app/backend/data.json" },
    "redis":   { "status": "not_configured" }
  }
}
```

The top-level `status` is `"ok"` (HTTP 200) when all dependencies are healthy or not configured, and `"degraded"` (HTTP 503) when any required dependency is failing.

---

## Dependency Checks

### Storage (data file / filesystem)

The backend stores asset metadata in a local JSON file. The check verifies that the directory containing the data file is **readable and writable** using `fs.accessSync`. This covers:
- Disk full / permission errors
- Missing mount points in containerised environments

Returns `{ status: "ok", path: "<file>" }` on success, or `{ status: "error", message: "..." }` on failure.

### Redis

Only checked when `REDIS_URL` is set. If the env var is absent, returns `{ status: "not_configured" }` and does **not** affect the top-level status.

When configured, opens a short-lived ioredis connection, sends a `PING`, then disconnects. Connection options are tight to keep the health check fast and non-blocking:
- `connectTimeout: 2000` — 2 s max
- `maxRetriesPerRequest: 0` — fail immediately, no retries
- `enableOfflineQueue: false` — reject if not connected

Returns `{ status: "ok" }` on a successful `PING`, or `{ status: "error", message: "..." }` on failure.

---

## HTTP Status Codes

| Scenario | HTTP status | `status` field |
|---|---|---|
| All dependencies healthy | `200` | `"ok"` |
| Redis not configured | `200` | `"ok"` |
| Redis configured but unreachable | `503` | `"degraded"` |
| Storage directory inaccessible | `503` | `"degraded"` |

Returning `503` when degraded allows load balancers and uptime monitors to automatically route around unhealthy instances.

---

## Dependency Added

| Package | Version | Purpose |
|---|---|---|
| `ioredis` | `^5` | Redis connectivity check |

---

## Testing

```
npm test   # 22/22 tests pass
```

New tests:
- `GET /health` returns `200` with structured `dependencies` when Redis is not configured
- `GET /health` returns `503 degraded` with `redis.status = "error"` when `REDIS_URL` points to an unreachable host

---

Closes #18
