# feat: Add asset verification workflow — pending/approve/reject lifecycle

## Summary

Implements a full verification workflow for RWA assets as requested in issue #87. New assets are created with `status: "pending"`, an admin reviews them via new pending/review endpoints, and public GET endpoints only return approved assets.

---

## What Changed

### Backend (`backend/index.js`)

- **`POST /api/rwa`**: New assets now include `status: "pending"`, `submittedAt`, and `updatedAt` fields on creation.
- **`GET /api/rwa/pending`** (admin only): Returns all assets with `status === "pending"` that await review.
- **`POST /api/rwa/:contractId/approve`** (admin only): Sets `status → "approved"`, records `reviewedAt` and `reviewedBy` (from `x-reviewer` header, defaults to `"admin"`).
- **`POST /api/rwa/:contractId/reject`** (admin only): Sets `status → "rejected"`, records `reviewedAt` and `reviewedBy`.
- **`GET /api/rwa`**: Now filters to only return approved assets (or assets with no `status` field for backward compatibility with existing data).
- **`GET /api/rwa/:contractId`**: Returns 404 for non-approved assets (pending/rejected), only serves approved or legacy assets.
- All new routes are available under both `/api/v1/rwa/...` and `/api/rwa/...`.

### OpenAPI / Swagger (`backend/docs.js`)

- Added `status`, `submittedAt`, `reviewedAt`, `reviewedBy` properties to the `Asset` schema.
- Added documentation for:
  - `GET /api/v1/rwa/pending`
  - `POST /api/v1/rwa/{contractId}/approve`
  - `POST /api/v1/rwa/{contractId}/reject`
  - Legacy aliases: `GET /api/rwa/pending`

### Tests (`backend/__tests__/api.test.js`)

Added the **Asset Verification Workflow** test suite with 18 new tests:

| Test | Coverage |
|---|---|
| `creates asset with status pending and submittedAt` | POST sets `status: "pending"` |
| `GET /api/rwa/pending requires admin API key` | 401 without key |
| `GET /api/rwa/pending returns pending assets` | Lists pending, excludes approved/rejected |
| `GET /api/v1/rwa/pending` | Versioned route works |
| `GET /api/rwa/pending does not include approved/rejected` | Filtering |
| `POST /api/rwa/:contractId/approve requires admin API key` | 401 without key |
| `POST /api/rwa/:contractId/approve approves a pending asset` | Sets `approved`, records reviewer |
| `approved asset appears in public GET list` | Visibility after approval |
| `returns 404 for non-existent asset` | Approve/reject on missing asset |
| `works on /api/v1/rwa/:contractId/approve` | Versioned approve |
| `POST /api/rwa/:contractId/reject requires admin API key` | 401 without key |
| `POST /api/rwa/:contractId/reject rejects a pending asset` | Sets `rejected`, records reviewer |
| `rejected asset does not appear in public GET list` | Hidden from public |
| `returns 404 for non-existent asset` | Reject on missing asset |
| `works on /api/v1/rwa/:contractId/reject` | Versioned reject |
| `returns 404 for pending asset (single GET)` | Non-approved hidden |
| `returns 404 for pending asset (v1 single GET)` | Non-approved hidden (v1) |

Updated existing tests:
- All test suites that create assets for public GET verification now use `createAndApproveAsset()` helper to approve the asset first.
- Cache integration tests (`cache.test.js`) also approve their test assets so GETs succeed.
- Rate limiter max set to 1000 in test mode (`NODE_ENV === 'test'`) to allow sufficient write operations during test runs.
- `GET /api/v1/rwa/:contractId` now uses a dedicated V1_GET_ID to avoid relying on VALID_ID (which may have been deleted).

**Total: 88 tests passing (3 suites).**

---

## Verification Flow

```
User creates asset via POST /api/rwa
  → status: "pending", submittedAt: now
      ↓
Admin reviews via GET /api/rwa/pending
      ↓
Admin approves (POST /api/rwa/:id/approve)
  → status: "approved", reviewedAt: now, reviewedBy: admin
  → Asset visible in public GET /api/rwa
      OR
Admin rejects (POST /api/rwa/:id/reject)
  → status: "rejected", reviewedAt: now, reviewedBy: admin
  → Asset hidden from public GET /api/rwa
```

## Backward Compatibility

- Legacy assets (created before this change, no `status` field) are treated as `approved` and remain visible in public GET responses.
- All new routes use the existing `adminAuth` middleware (x-api-key header).
- The `x-reviewer` header is optional on approve/reject; defaults to `"admin"`.

---

## Files Changed

| File | Change |
|---|---|
| `backend/index.js` | New fields, pending/approve/reject routes, public GET filtering |
| `backend/docs.js` | Updated OpenAPI spec with new routes and fields |
| `backend/__tests__/api.test.js` | Verification workflow tests, helper, updated existing tests |
| `backend/__tests__/cache.test.js` | Approve cache test assets so GETs succeed |

---

closes #87
