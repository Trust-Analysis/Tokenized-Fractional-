# feat: Add API versioning — mount `/api/v1/rwa`, keep `/api/rwa` as backward-compatible alias

## Summary

Implements API versioning for the off-chain metadata backend as requested in issue #85. All RWA asset routes are now available under a versioned prefix (`/api/v1/rwa`) while the existing `/api/rwa` paths remain fully functional as backward-compatible aliases. No breaking changes for existing clients.

---

## What Changed

### Backend (`backend/index.js`)

- Extracted all four RWA route handlers (`GET /rwa`, `GET /rwa/:contractId`, `POST /rwa`, `DELETE /rwa/:contractId`) into a dedicated Express `Router` (`v1`).
- Mounted the router at **two prefixes**:
  - `/api/v1` → versioned path (new canonical URL)
  - `/api` → legacy alias (backward-compatible, serves identical handlers)
- The `admin/verify` endpoint is not versioned and remains at `/api/admin/verify`.
- Added `import { Router } from 'express'` to the top-level imports.

**Route mapping summary:**

| Versioned (new) | Legacy (backward-compatible) | Description |
|---|---|---|
| `GET /api/v1/rwa` | `GET /api/rwa` | List all assets |
| `GET /api/v1/rwa/:contractId` | `GET /api/rwa/:contractId` | Get asset by contract ID |
| `POST /api/v1/rwa` | `POST /api/rwa` | Create/update asset |
| `DELETE /api/v1/rwa/:contractId` | `DELETE /api/rwa/:contractId` | Delete asset |

### Frontend

- **`frontend/src/store/useAssetStore.js`**: `fetchMetadata` and `fetchAllAssets` now call `/api/v1/rwa` endpoints.
- **`frontend/src/components/AssetForm/AssetForm.jsx`**: POST (create/update) and DELETE calls updated to `/api/v1/rwa` paths.
- `AdminPage.jsx` required no changes — it only uses `/api/admin/verify`, which is not versioned.

### OpenAPI / Swagger (`backend/docs.js`)

- Updated `info.description` to document the versioning strategy.
- Split asset route documentation into two tag groups visible in Swagger UI:
  - **"Assets — v1 (versioned)"** — documents `/api/v1/rwa` and `/api/v1/rwa/{contractId}`
  - **"Assets — legacy (backward-compatible)"** — documents `/api/rwa` and `/api/rwa/{contractId}` with deprecation notices pointing to v1
- Both tag groups document identical request/response schemas.

### Tests (`backend/__tests__/api.test.js`)

Added dedicated test suites for the versioned paths:

| New Test Suite | Coverage |
|---|---|
| `GET /api/v1/rwa` | Pagination, assetType filter, search filter |
| `POST /api/v1/rwa` | Create, missing key, invalid contractId, missing fields |
| `GET /api/v1/rwa/:contractId` | Found, 404 |
| `DELETE /api/v1/rwa/:contractId` | No key, delete, already deleted |

All original `/api/rwa` test suites remain unchanged. Total: **53 tests passing**.

---

## Versioning Strategy

The chosen approach uses **Express Router aliasing** rather than redirects:

```
app.use('/api/v1', v1);   // canonical versioned path
app.use('/api', v1);       // legacy alias — same handlers, no redirect overhead
```

This means:
- Zero latency overhead for legacy clients (no 301/302 redirect round-trips).
- Both paths return identical responses and status codes.
- Future breaking changes can be introduced by creating a `v2` router and mounting it at `/api/v2` without touching the v1 router or legacy aliases.

---

## Checklist

- [x] Restructure routes as `/api/v1/...`
- [x] Add backward-compatible redirect or alias
- [x] Update frontend to use versioned API
- [x] Document versioning strategy (Swagger UI + this PR description)
- [x] All tests pass (53/53)

---

## Testing

```bash
cd backend
npm install
npm test
# → 53 tests, 3 suites, all passing

# Manual verification
curl http://localhost:3001/api/v1/rwa      # versioned
curl http://localhost:3001/api/rwa         # legacy alias — same response
```

---

## Files Changed

| File | Change |
|---|---|
| `backend/index.js` | v1 Router, mount at `/api/v1` and `/api` |
| `backend/docs.js` | Split Swagger tags for v1 and legacy paths |
| `backend/__tests__/api.test.js` | Added v1 route test suites |
| `frontend/src/store/useAssetStore.js` | Updated API paths to `/api/v1/rwa` |
| `frontend/src/components/AssetForm/AssetForm.jsx` | Updated API paths to `/api/v1/rwa` |

---

closes #85
