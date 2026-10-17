# feat: Add webhook support — CRUD management + event-driven delivery

## Summary

Implements a full webhook system for RWA asset events as requested in issue #88. Admins can register webhook endpoints that receive POST notifications when assets are created, updated, deleted, approved, or rejected. Delivery includes automatic retries with exponential backoff and auto-disabling after repeated failures.

---

## What Changed

### Backend (`backend/index.js`)

**Webhook helpers:**
- `WEBHOOK_EVENTS` — enum of supported event types (`asset.created`, `asset.updated`, `asset.deleted`, `asset.approved`, `asset.rejected`)
- `loadWebhooks()` / `saveWebhooks()` — JSON file-backed persistence (`webhooks.json`, configurable via `WEBHOOK_DATA_FILE` env)
- `validateWebhookBody()` — validates URL, events array, and individual event names
- `deliverToWebhook()` — fires a single POST with `X-Webhook-Event` / `X-Webhook-Delivery` headers, 5s timeout
- `deliverWebhookWithRetry()` — retries up to 3 times with 1s/2s/3s linear backoff
- `fireWebhooks(event, data)` — loads active webhooks matching the event, delivers in parallel, tracks success/failure, auto-disables after 5 consecutive failures

**Webhook CRUD routes (admin only, `x-api-key` auth):**
- `POST /api/v1/webhooks` — register a webhook (url, events, optional secret/active)
- `GET /api/v1/webhooks` — list all registered webhooks
- `GET /api/v1/webhooks/:id` — get single webhook
- `PATCH /api/v1/webhooks/:id` — update webhook fields
- `DELETE /api/v1/webhooks/:id` — delete a webhook
- Legacy aliases: `/api/webhooks` → `/api/v1/webhooks`

**Webhook delivery integration:**
- `POST /api/rwa` → fires `asset.created`
- `PATCH /api/rwa/:id` → fires `asset.updated`
- `DELETE /api/rwa/:id` → fires `asset.deleted`
- `POST /api/rwa/:id/approve` → fires `asset.approved`
- `POST /api/rwa/:id/reject` → fires `asset.rejected`

All deliveries are fire-and-forget (`.catch(() => {})`) to never block the API response.

### OpenAPI / Swagger (`backend/docs.js`)

- Added `Webhook` and `WebhookInput` schemas (url, events, secret, active, failure tracking fields)
- Added documentation for all webhook CRUD endpoints under `/api/v1/webhooks` and `/api/v1/webhooks/{id}`

### Tests (`backend/__tests__/api.test.js`)

Added the **Webhook Management** test suite with 26 new tests:

| Test | Coverage |
|---|---|
| **POST /api/webhooks** | |
| `requires admin API key` | 401 without key |
| `creates a webhook` | Valid creation, field checks |
| `rejects missing url` | 400 validation |
| `rejects invalid url` | 400 validation |
| `rejects missing events` | 400 validation |
| `rejects invalid events` | 400 validation |
| `works on /api/v1/webhooks` | Versioned route |
| `defaults active to true` | active defaults |
| **GET /api/webhooks** | |
| `requires admin API key` | 401 without key |
| `lists registered webhooks` | Returns array with created webhooks |
| `works on /api/v1/webhooks` | Versioned route |
| **GET /api/webhooks/:id** | |
| `requires admin API key` | 401 without key |
| `returns webhook by id` | Valid lookup |
| `returns 404 for unknown id` | Missing ID |
| **PATCH /api/webhooks/:id** | |
| `requires admin API key` | 401 without key |
| `updates webhook fields` | Change url, events, active |
| `returns 404 for unknown id` | Missing ID |
| **DELETE /api/webhooks/:id** | |
| `requires admin API key` | 401 without key |
| `deletes a webhook` | Valid deletion |
| `returns 404 when already deleted` | Idempotent 404 |
| `returns 404 for unknown id` | Missing ID |
| **Webhook delivery on asset changes** | |
| `fires asset.created on POST` | Event fires on asset creation |
| `fires asset.approved on approve` | Event fires on approval |
| `fires asset.updated on PATCH` | Event fires on update |
| `fires asset.deleted on DELETE` | Event fires on deletion |
| `retries on 5xx response` | Retries up to 3 times with backoff |

**Total: 114 tests passing (3 suites).**

### .gitignore

- Added `webhooks.json` and `test-data.json` to ignored files

---

## Delivery Flow

```
Asset event occurs (create/update/delete/approve/reject)
    ↓
fireWebhooks(event, data)
    ↓
loadWebhooks() → filter active + matching event
    ↓
For each matching webhook:
    deliverWebhookWithRetry(webhook, payload)
    ├── attempt 1 → POST with 5s timeout
    ├── failure → wait 1s, attempt 2
    ├── failure → wait 2s, attempt 3
    └── all failed → increment failureCount
                       ↓
              failureCount >= 5? → auto-disable (active: false)
```

## Backward Compatibility

- Webhooks use a separate data file (`webhooks.json`) from assets (`data.json`)
- All webhook routes require admin API key via `x-api-key` header
- Delivery is fire-and-forget — API responses are not blocked by webhook delivery
- Both `/api/webhooks` and `/api/v1/webhooks` prefixes work

---

## Files Changed

| File | Change |
|---|---|
| `backend/index.js` | Webhook helpers, CRUD routes, delivery integration |
| `backend/docs.js` | Webhook OpenAPI schemas and endpoint docs |
| `backend/__tests__/api.test.js` | 26 new webhook tests |
| `.gitignore` | Ignore `webhooks.json`, `test-data.json` |

---

closes #88
