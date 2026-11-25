# Entrypoint consolidation (issue #1068)

The deployed backend is `backend/src/server.js`, which boots the single Express
application in `backend/src/app.js`. `backend/index.js` is now a compatibility
re-export only: it defines no routes, no middleware and never calls `listen()`.

`backend/package.json` (`start`, `dev`, `main`), `backend/Dockerfile`,
`docker-compose.yml`, `k8s/backend-deployment.yaml`, `render.yaml` (via
`npm start`) and the Jenkins integration stage (`BACKEND_ENTRYPOINT`) all use
this same entrypoint.

## Route-by-route diff recorded at consolidation

The old `index.js` built its own app (2,227 lines) with an inline `v1` router,
while `src/app.js` builds a modular app (696 lines). Both mounted `v1` at
`/api/v1` and `/api` (legacy alias), so every `v1.*` route below existed at both
prefixes. `src/app.js` is the surviving route table.

### Routes that existed only in the old `index.js` (now removed)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sitemap.xml` | static sitemap |
| GET | `/api-docs.yaml` | YAML OpenAPI download (`/api-docs` + `.json` exist in both) |
| GET | `/api/admin/verify` | old inline admin verification handler |
| GET/POST/PATCH/DELETE | `/api/admin/rate-limits/*` | `src/routes/rateLimitAdmin.js` (new app mounts the equivalent at `/api/v1/rate-limit-admin` and `/api/rate-limit-admin`) |
| GET/POST/PATCH/DELETE | `/api/admin/tenants/*` | `src/routes/tenantAdmin.js` (no equivalent is mounted in the surviving app) |
| GET/POST/PATCH/DELETE | `/api/v1/rwa/*`, `/api/rwa/*` | inline RWA handlers (superseded by `src/routes/rwa.js`, which has a different implementation and a larger route set) |
| GET | `/api/v1/news`, `/api/news` | news feed |
| GET/POST/GET-by-id/PATCH/DELETE | `/api/v1/webhooks`, `/api/webhooks` | inline CRUD (new app uses `src/routes/webhooks.js`, but its service is not initialised) |
| POST | `/api/v1/notify/{share-purchased,price-updated,availability-changed,asset-updated,marketplace-status}` | inline notification webhooks |
| GET | `/api/v1/ws/stats` | WebSocket stats |
| POST | `/api/batch`, `/api/v1/batch` | batch handler (`src/middleware/batchHandler.js`) |
| (mount) | `/api/graphql` | Yoga server from `backend/graphql/index.js` |
| (dead code) | `/graphql` | `initializeApolloServer()` was never called in `index.js` |

### Routes that existed only in `src/app.js` (now the live table)

| Mount path | Module / handler |
| --- | --- |
| `/api/v1/sql-injection-guard`, `/api/sql-injection-guard` | `src/services/sqlInjectionGuard.js` |
| `/api/v1/api-keys`, `/api/api-keys` | `src/routes/apiKeys.js` |
| `/api/v1/analytics`, `/api/analytics` | `src/routes/analytics.js` |
| `/api/v1/purchases`, `/api/purchases` | `src/routes/purchases.js` |
| `/api/v1/rate-limiting`, `/api/rate-limiting` | `src/routes/rateLimiting.js` |
| `/api/v1/flash-loan-protection`, `/api/flash-loan-protection` | `src/routes/flashLoanProtection.js` |
| `/api/v1/api-monitor`, `/api/api-monitor` | `src/routes/apiMonitoring.js` |
| `/api/v1/statements`, `/api/statements` | `src/routes/statements.js` |
| `/api/v1/ip-access`, `/api/ip-access` | `src/routes/ipAccess.js` |
| `/api/v1/admin`, `/api/admin` | `src/routes/adminConfig.js` |
| `/api/v1/backups`, `/api/backups` | `src/routes/backups.js` |
| `/api/v1/auth`, `/api/auth` | `src/routes/oauthRoutes.js` |
| `/api/v1/rate-limit-admin`, `/api/rate-limit-admin` | `src/routes/rateLimitAdmin.js` |
| `/api/v1/time-windows`, `/api/time-windows` | `src/routes/timeWindows.js` |
| `/graphql` | federated gateway (`src/federation/gateway.js`), initialized in `initializeApp()` |
| `/graphql/docs` | GraphQL docs |
| `/graphql/stitching/{health,metrics,info}` | federation stitching diagnostics |

### Behavioural differences in shared paths / middleware

| Concern | Old `index.js` | Surviving `src/app.js` |
| --- | --- | --- |
| JSON body limit | 10kb | 1mb |
| Security headers | `helmet()` | `createSecurityHeadersMiddleware()` |
| CORS | same origins/methods/headers | same origins/methods/headers |
| Sanitization | none | `requireSanitization` on every request |
| Partial response | none | `partialResponseMiddleware()` |
| Rate limiting | `/api/` write limiter from inline service | tiered read + write limiters, IP access control, endpoint limiter on `/api/` and `/graphql` |
| GraphQL rate limiter | on `/api/graphql` | on `/graphql` |
| Wallet extraction | none | `extractWalletMiddleware` |
| SQL injection guard | none | middleware + admin routes |
| Web server | `app.listen()` inside `index.js` (twice; one path dead under ESM) | `src/server.js` only |
| Swagger | `/api-docs`, `/api-docs.json`, `/api-docs.yaml` | `/api-docs`, `/api-docs.json` |
| Health | `/health` inline | `/health` inline (identical probe path) |
