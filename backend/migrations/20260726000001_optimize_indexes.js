/**
 * Migration: Optimize database indexes for common query patterns (Issue #315)
 *
 * Adds composite indexes, partial indexes, and expression indexes
 * to accelerate the most common query patterns identified from
 * slow query analysis.
 *
 * Index strategy:
 * - Composite indexes for multi-column WHERE clauses
 * - Partial indexes for filtered queries (e.g., active records only)
 * - Covering indexes to avoid table lookups
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // ── Assets table indexes ────────────────────────────────────────────
  // Composite index for listing assets by type with sorting
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_assets_type_created ON assets (asset_type, created_at DESC)'
  );

  // Index for asset search by name (case-insensitive prefix matching)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_assets_name_lower ON assets (LOWER(name))'
  );

  // Covering index for marketplace listing (avoids table lookup for common queries)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_assets_listing ON assets (contract_id, name, symbol, image_url, asset_type, total_value)'
  );

  // ── Transactions table indexes ──────────────────────────────────────
  // Composite index for buyer transaction history with date ordering
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_transactions_buyer_date ON transactions (buyer_address, created_at DESC)'
  );

  // Composite index for contract transaction history
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_transactions_contract_date ON transactions (contract_id, created_at DESC)'
  );

  // Composite index for status-based queries with date range
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_transactions_status_date ON transactions (status, created_at DESC)'
  );

  // Partial index for pending transactions only (high-frequency query)
  await knex.schema.raw(
    "CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions (created_at) WHERE status = 'pending'"
  );

  // Index for blockchain hash lookups
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_transactions_blockchain_hash ON transactions (blockchain_hash) WHERE blockchain_hash IS NOT NULL'
  );

  // ── User activity indexes ───────────────────────────────────────────
  // Index for top users by purchase count
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_user_activity_purchases ON user_activity (total_purchases DESC, wallet_address)'
  );

  // Index for recently active users
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_user_activity_recent ON user_activity (last_purchase_at DESC) WHERE last_purchase_at IS NOT NULL'
  );

  // ── Daily analytics indexes ─────────────────────────────────────────
  // Index for date range queries on analytics
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_daily_analytics_date_volume ON daily_analytics (date DESC, total_volume DESC)'
  );

  // ── API keys indexes ────────────────────────────────────────────────
  // Partial index for active (non-revoked) API keys
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (key_hash) WHERE revoked_at IS NULL'
  );

  // Index for expired key cleanup
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys (expires_at) WHERE expires_at IS NOT NULL AND revoked_at IS NULL'
  );
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  // Drop all indexes created in this migration
  const indexes = [
    'idx_assets_type_created',
    'idx_assets_name_lower',
    'idx_assets_listing',
    'idx_transactions_buyer_date',
    'idx_transactions_contract_date',
    'idx_transactions_status_date',
    'idx_transactions_pending',
    'idx_transactions_blockchain_hash',
    'idx_user_activity_purchases',
    'idx_user_activity_recent',
    'idx_daily_analytics_date_volume',
    'idx_api_keys_active',
    'idx_api_keys_expires',
  ];

  for (const index of indexes) {
    await knex.schema.raw(`DROP INDEX IF EXISTS ${index}`);
  }
}
