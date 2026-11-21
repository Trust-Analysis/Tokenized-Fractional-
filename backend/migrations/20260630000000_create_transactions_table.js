/**
 * Migration: Create transactions and analytics tables for purchase tracking
 *
 * Tables:
 * - transactions: Records each purchase/share purchase event
 * - user_activity: Tracks active users and engagement
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Transactions table — logs every share purchase
  await knex.schema.createTable('transactions', (table) => {
    table.increments('id').primary();
    table.string('transaction_id').unique().notNullable(); // Soroban tx hash or unique ID
    table.string('contract_id').notNullable(); // RWA contract being purchased
    table.string('buyer_address').notNullable(); // Stellar wallet address
    table.decimal('shares_purchased', 20, 2).notNullable();
    table.decimal('price_per_share', 20, 8).notNullable();
    table.decimal('total_amount', 20, 8).notNullable(); // Total USD/token value
    table.string('payment_token').notNullable(); // Token used for payment
    table.string('status').defaultTo('completed'); // completed, pending, failed
    table.string('blockchain_hash'); // Soroban transaction hash
    table.jsonb('metadata'); // Additional data like market conditions, etc
    table.timestamps(true, true); // created_at / updated_at

    table.index('contract_id');
    table.index('buyer_address');
    table.index('created_at');
    table.index('status');
  });

  // User activity table — track active users over time
  await knex.schema.createTable('user_activity', (table) => {
    table.increments('id').primary();
    table.string('wallet_address').notNullable();
    table.integer('total_purchases').defaultTo(0);
    table.decimal('total_spent', 20, 8).defaultTo(0);
    table.decimal('shares_owned', 20, 2).defaultTo(0);
    table.timestamp('last_purchase_at');
    table.timestamp('first_seen_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);

    table.unique('wallet_address');
    table.index('total_purchases');
    table.index('last_purchase_at');
    table.index('created_at');
  });

  // Daily analytics snapshots — pre-computed daily metrics
  await knex.schema.createTable('daily_analytics', (table) => {
    table.increments('id').primary();
    table.date('date').notNullable().unique(); // YYYY-MM-DD
    table.integer('transactions_count').defaultTo(0);
    table.decimal('total_volume', 20, 8).defaultTo(0); // Total USD volume
    table.integer('unique_buyers').defaultTo(0); // Number of unique buyers
    table.integer('unique_assets_traded').defaultTo(0);
    table.decimal('average_transaction_size', 20, 8).defaultTo(0);
    table.jsonb('metadata'); // Top assets, asset types, etc
    table.timestamps(true, true);

    table.index('date');
    table.index('created_at');
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('daily_analytics');
  await knex.schema.dropTableIfExists('user_activity');
  await knex.schema.dropTableIfExists('transactions');
}
