/**
 * Vault metrics materialized view refresh (Issue #897)
 *
 * Documents and centralizes the refresh strategy for
 * `mv_historical_vault_metrics` (created by
 * `migrations/20260726000004_create_mv_vault_metrics.js`), which backs the
 * vault metrics served by `transactionService.js`.
 *
 * Refresh strategy: scheduled, trigger-free. A single in-process cron calls
 * `refreshVaultMetrics()` on an interval (default 1 hour, tunable via the
 * MV_REFRESH_INTERVAL_MS environment variable). On PostgreSQL the refresh uses
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which requires the unique index on
 * `contract_id` created by the migration and never blocks readers. On SQLite
 * the migration creates a plain (non-materialized) VIEW, which is always
 * current, so no refresh is needed.
 *
 * Expected staleness bound: at most one refresh interval plus the duration of
 * the refresh itself (see docs/VAULT_METRICS_REFRESH.md).
 */

export const MATERIALIZED_VIEW_NAME = 'mv_historical_vault_metrics';

/** Default refresh cadence: 1 hour. */
export const DEFAULT_MV_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Effective refresh cadence, tunable via MV_REFRESH_INTERVAL_MS.
 * Invalid or non-positive values fall back to the default.
 */
export function getVaultMetricsRefreshIntervalMs(env = process.env) {
  const raw = Number(env.MV_REFRESH_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MV_REFRESH_INTERVAL_MS;
  return raw;
}

/**
 * Refresh the vault metrics materialized view, if the database is PostgreSQL.
 *
 * @param {import('knex').Knex} db
 * @param {Object} [logger]
 * @returns {Promise<{ refreshed: boolean, durationMs: number, view: string }>}
 *          `refreshed: false` when the backend is not PostgreSQL (SQLite
 *          serves a live VIEW instead, so there is nothing to refresh).
 */
export async function refreshVaultMetrics(db, logger = console) {
  const isPostgres = db?.client?.config?.client === 'pg' || db?.client?.config?.client === 'postgresql';
  if (!isPostgres) {
    return { refreshed: false, durationMs: 0, view: MATERIALIZED_VIEW_NAME };
  }

  const startedAt = Date.now();
  await db.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${MATERIALIZED_VIEW_NAME}`);
  const durationMs = Date.now() - startedAt;

  logger.info?.(
    { view: MATERIALIZED_VIEW_NAME, durationMs },
    'Materialized view refreshed in background'
  );

  return { refreshed: true, durationMs, view: MATERIALIZED_VIEW_NAME };
}

/**
 * Start the scheduled refresh cron. Returns the interval handle so callers
 * can stop it (tests, graceful shutdown).
 *
 * @param {() => import('knex').Knex} getDb - Lazy DB accessor
 * @param {Object} [logger]
 * @param {number} [intervalMs] - Defaults to getVaultMetricsRefreshIntervalMs()
 */
export function startVaultMetricsRefreshCron(getDb, logger = console, intervalMs) {
  const interval = intervalMs ?? getVaultMetricsRefreshIntervalMs();

  return setInterval(async () => {
    try {
      await refreshVaultMetrics(getDb(), logger);
    } catch (error) {
      logger.error?.({ message: 'Failed to refresh materialized view', error: error.message });
    }
  }, interval);
}
