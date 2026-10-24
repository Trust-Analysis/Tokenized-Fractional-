# Multi-Tenancy Architecture Guide

The RWA Marketplace supports multi-tenancy, allowing a single application instance to serve multiple isolated customers (tenants).

## Data Isolation (Row-Level Security)
We utilize **PostgreSQL Row-Level Security (RLS)** to guarantee strict data segregation.
- The `tenantContextMiddleware` intercepts every incoming request.
- It extracts the `tenant_id` from the JWT token or the `X-Tenant-ID` HTTP header.
- A dedicated Postgres transaction is spawned using `SET LOCAL app.current_tenant_id = '...'`.
- Postgres RLS policies automatically filter all queries (`SELECT`, `UPDATE`, `DELETE`) ensuring Tenant A can never read Tenant B's data.

## Database-per-Tenant vs. Pooled (RLS)
This architecture implements a **Pooled Strategy with RLS**. All tenants share the same physical tables, but are logically isolated by the database engine. This provides the best balance of operational simplicity and high security. If a customer requires extreme isolation (Database-per-Tenant), the application is fully compatible by simply deploying a separate database connection string per customer environment.

## Tenant Onboarding & Management
The `TenantService` handles automated onboarding, config management, and analytics.
- **Performance Isolation:** Tenants on the `standard` plan are limited to 100 API requests per minute. `enterprise` tenants receive higher quotas.
- **Tenant Analytics:** Aggregated usage reports are generated securely using the tenant's execution context.

## Pool-Safety Audit (Issue #898)
RLS policies are only as strong as the session context that feeds them. Because knex connections are **pooled and reused across tenants**, the tenant context must be scoped per *query*, never per *connection*. Audit results:

| Component | Finding |
|---|---|
| `backend/src/middleware/tenantContext.js` | ✅ Correct: sets the context with `SET LOCAL` inside a per-request transaction. `SET LOCAL` reverts at `COMMIT`/`ROLLBACK`, so a pooled connection returned to the pool carries no tenant context. |
| `backend/src/services/database.js` | ⚠️ Carries no tenant context of its own; safety depends on all tenant-scoped queries running through the middleware transaction (or `withTenantContext`). Plain queries on RLS tables **fail closed** (zero rows). |
| `backend/src/services/readReplica.js` | ⚠️ Fixed in #898: plain `readQuery()`/`writeQuery()` carry no tenant context (fail-closed on RLS tables). New `readQueryForTenant()`/`writeQueryForTenant()`/`withTenantContext()` helpers set the context with `SET LOCAL` per transaction, and connections are defensively reset (`SET app.current_tenant_id = ''`) at acquisition time. |

**Rules of thumb**
- Always use `SET LOCAL` inside a transaction — never a session-level `SET` — for `app.current_tenant_id`.
- Never cache a tenant-scoped connection; scope every query/transaction independently.
- `current_setting('app.current_tenant_id', true)` returning an empty string matches no rows, so missing context fails closed rather than leaking.

### Security regression test
`backend/__tests__/rlsTenantIsolation.security.test.js` (Issue #898) proves isolation against a real PostgreSQL: it applies the **actual** RLS migration, forces RLS on the table owner, then issues interleaved queries for two tenants through a deliberately small shared pool (max 2 connections) and asserts each tenant only ever sees its own rows — including after connection reuse. It also covers the fail-closed no-context case, the middleware path, and the `system_admin` bypass.

Run it with Docker available (it boots an ephemeral `postgres:16-alpine` container), or point it at an existing database:
```bash
cd backend
npm test -- rlsTenantIsolation
# or against a specific server:
TEST_POSTGRES_URL=postgresql://user:pass@host:5432/db npm test -- rlsTenantIsolation
```
Without Docker or a `TEST_POSTGRES_URL`/`DATABASE_URL`, the live assertions are skipped with a warning (same convention as `postgresTriggers.test.js`).

## Usage
When making API requests on behalf of a tenant, ensure the authentication token contains the `tenantId` claim, or pass the header:
```http
X-Tenant-ID: tnt_1234567890
```
