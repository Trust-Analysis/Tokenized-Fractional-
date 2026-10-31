/**
 * Migration: Create materialized view for historical vault metrics
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      CREATE MATERIALIZED VIEW mv_historical_vault_metrics AS
      SELECT 
        contract_id,
        SUM(total_amount) as historical_volume,
        SUM(shares_purchased) as historical_shares,
        COUNT(DISTINCT buyer_address) as historical_unique_buyers,
        COUNT(id) as historical_tx_count
      FROM transactions
      WHERE created_at < NOW() - INTERVAL '24 hours'
        AND status = 'completed'
      GROUP BY contract_id
    `);

    // Create a unique index to allow CONCURRENTLY refreshes
    await knex.raw(`
      CREATE UNIQUE INDEX idx_mv_historical_vault_metrics_contract_id 
      ON mv_historical_vault_metrics (contract_id)
    `);
  } else {
    // For SQLite, create a standard view
    await knex.raw(`
      CREATE VIEW mv_historical_vault_metrics AS
      SELECT 
        contract_id,
        SUM(total_amount) as historical_volume,
        SUM(shares_purchased) as historical_shares,
        COUNT(DISTINCT buyer_address) as historical_unique_buyers,
        COUNT(id) as historical_tx_count
      FROM transactions
      WHERE created_at < datetime('now', '-1 day')
        AND status = 'completed'
      GROUP BY contract_id
    `);
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  if (knex.client.config.client === 'pg') {
    await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_historical_vault_metrics');
  } else {
    await knex.raw('DROP VIEW IF EXISTS mv_historical_vault_metrics');
  }
}
