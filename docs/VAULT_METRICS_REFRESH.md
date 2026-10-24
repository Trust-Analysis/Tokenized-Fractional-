# Vault Metrics Materialized View — Refresh Strategy & Staleness Bound (Issue #897)

The vault metrics served by `transactionService.js` (historical volume,
shares, unique buyers, and transaction counts per contract) are backed by the
`mv_historical_vault_metrics` materialized view, created in
`backend/migrations/20260726000004_create_mv_vault_metrics.js`.

## Refresh strategy

**Scheduled refresh — no triggers, no on-write hooks.** A single in-process
cron (`startVaultMetricsRefreshCron` in
`backend/src/services/vaultMetricsRefresh.js`, started from `backend/index.js`)
runs:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_historical_vault_metrics
```

| Aspect | Behavior |
|--------|----------|
| Cadence | Every `MV_REFRESH_INTERVAL_MS` ms — **default 1 hour** (3600000 ms), tunable per environment |
| Statement | `REFRESH MATERIALIZED VIEW CONCURRENTLY` — requires the unique index `idx_mv_historical_vault_metrics_contract_id` on `contract_id` created by the migration, and **never blocks readers** while refreshing |
| Row scope | Only `transactions` with `status = 'completed'` and `created_at < NOW() - INTERVAL '24 hours'` (24-hour-old data is considered final) |
| SQLite dev/test | The migration creates a plain (non-materialized) `VIEW`, which is always current; `refreshVaultMetrics()` detects this and no-ops (`refreshed: false`) |
| Failure handling | Refresh errors are reported through the app error tracker and retried on the next tick; a failed refresh leaves the previous snapshot in place (readers never see an empty view) |

## Expected staleness bound

> **A completed transaction older than 24 hours is guaranteed to be reflected
> in vault metrics within one refresh interval plus the duration of one
> refresh** — by default **≤ 1 refresh hour + refresh duration** (refresh of
> this view is sub-second at production scale; the test suite asserts it
> completes well inside the interval).

Tighten the bound per environment by setting:

```bash
MV_REFRESH_INTERVAL_MS=300000   # e.g. 5 minutes for latency-sensitive envs
```

Values must be positive integers (ms); invalid values fall back to the
1-hour default (`getVaultMetricsRefreshIntervalMs`).

## Verification

`backend/__tests__/mvVaultMetricsRefresh.test.js` proves the strategy end to
end against a real PostgreSQL (ephemeral Docker container, or
`TEST_POSTGRES_URL` / `DATABASE_URL` if provided — the suite degrades to
skipping live assertions when no PostgreSQL is reachable, same convention as
`postgresTriggers.test.js`):

1. mutates the underlying `transactions` table,
2. runs the same `REFRESH MATERIALIZED VIEW CONCURRENTLY` statement the cron
   uses (validating the unique-index requirement from the migration),
3. asserts the materialized view reflects the mutation, and that refresh
   duration is far below the documented staleness bound.

Run it:

```bash
cd backend
npm test -- __tests__/mvVaultMetricsRefresh.test.js
```
