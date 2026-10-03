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

## Usage
When making API requests on behalf of a tenant, ensure the authentication token contains the `tenantId` claim, or pass the header:
```http
X-Tenant-ID: tnt_1234567890
```
