# Backend API Versioning & Deprecation Policy

This document defines how the off-chain RWA Marketplace backend evolves its HTTP
API without breaking existing clients. It covers the path scheme, the
compatibility guarantees each version makes, how a version is deprecated, and
how to introduce a breaking change.

## 1. Path scheme

All asset, news, webhook and notification routes live on a **versioned router**:

```
/api/v1/rwa
/api/v1/rwa/:contractId
/api/v1/rwa/search
/api/v1/rwa/pending
/api/v1/rwa/export
/api/v1/webhooks
/api/v1/news
/api/v1/notify/*
```

The router is mounted twice:

| Mount        | Status                                    | Headers                                                   |
| ------------ | ----------------------------------------- | --------------------------------------------------------- |
| `/api/v1/*`  | **Supported.** Use this for new clients.  | `X-API-Version: 1`                                        |
| `/api/*`     | **Legacy alias.** Backward compatible.    | `X-API-Version: 1`, `Deprecation: true`, `Link: </api/v1>; rel="successor-version"` |

Both mounts are served by the same handlers, so the legacy alias never drifts
from `v1`. It exists only so that clients written before versioning was
introduced keep working while they migrate.

Infrastructure endpoints are intentionally **not** versioned because they
describe the process rather than a business resource whose shape changes:

- `GET /health` — liveness/readiness probe
- `GET /metrics` — Prometheus scrape endpoint
- `GET /api-docs`, `GET /api-docs.json` — OpenAPI/Swagger UI
- `POST /api/batch` — request multiplexer (also available at `/api/v1/batch`)

### Detecting the version

Every `/api/*` response carries `X-API-Version: 1`. Clients should treat a
missing header as an unknown/older deployment and fall back to the unversioned
behaviour. The unversioned paths additionally return the standard RFC 8594
`Deprecation` and `Link: rel="successor-version"` headers so tooling can surface
the migration.

## 2. Compatibility guarantees

Within a major version (`v1`) the following are **non-breaking** and may ship at
any time:

- Adding new optional request fields or query parameters
- Adding new response fields
- Adding new endpoints or new enum members where the client is expected to
  ignore unknown values
- Relaxing validation or fixing a bug that made a documented request fail

The following are **breaking** and require a new major version:

- Removing or renaming a field, endpoint, or query parameter
- Changing the type or format of an existing field
- Making an optional request field required
- Changing the meaning of an existing value or a status code
- Changing pagination semantics or default ordering

## 3. Deprecation process

When an endpoint or field is scheduled for removal in the next major version:

1. **Announce in `v1`.** Keep the endpoint working, add the RFC 8594
   `Deprecation` header, and document the replacement in this repository and the
   OpenAPI spec. Operations that are scheduled for removal are marked
   `deprecated: true` in `backend/docs.js` so they render struck-through in
   Swagger UI.
2. **Monitor.** Use the `X-API-Version` / `Deprecation` headers and request logs
   to observe remaining traffic before removing anything.
3. **Remove only in the next major.** Legacy paths are removed when `v2` is
   introduced, never inside `v1`.

The current `v1` alias at `/api/*` is in step 2: it is fully functional and
carries a `Deprecation` header pointing at `/api/v1`.

## 4. Introducing `v2`

1. Mount a new router at `/api/v2` (`app.use('/api/v2', v2)`), leaving `v1`
   untouched.
2. Serve breaking changes only on `v2`; keep shared, unchanged handlers on `v1`.
3. Add the new paths to `backend/docs.js` (or the JSDoc `@openapi` annotations)
   and regenerate `docs/api/` via `npm run docs:generate`.
4. Point the legacy `/api/*` alias at `v2` only after the deprecation window for
   `v1` has elapsed; until then `/api/*` stays an alias of `/api/v1`.
5. Update this document with the `v2` compatibility matrix and the `v1` sunset
   date.

## 5. Testing

`backend/__tests__/apiVersioning.test.js` asserts that:

- every supported resource is reachable under `/api/v1`,
- the legacy `/api` alias serves the same handlers and advertises deprecation,
- the OpenAPI spec documents the versioned paths,
- `/api/v1` responses carry `X-API-Version`.

Any change that alters the versioning contract must update that test alongside
this document.
