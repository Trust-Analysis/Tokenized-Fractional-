/**
 * Migration: Create time_window_events table for Issue #271
 *
 * Tracks all lifecycle events for time-locked purchase windows:
 * - window.created, window.updated, window.cancelled
 * - window.purchased (when a buyer purchases within a window)
 * - window.expired, window.recurring.started
 * - window.metadata.created, window.metadata.updated, window.metadata.deleted
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('time_window_events', (table) => {
    table.increments('id').primary();
    table.string('event_id').unique().notNullable(); // twe_<hex>
    table.string('event_type').notNullable(); // e.g. window.created, window.purchased
    table.string('contract_id').notNullable(); // RWA contract ID
    table.string('window_id').notNullable(); // Time window identifier
    table.string('admin_address'); // Admin who performed the action
    table.string('buyer_address'); // Buyer (for purchase events)
    table.jsonb('details'); // Event-specific details (shares, amount, etc.)
    table.timestamps(true, true); // created_at / updated_at

    table.index('contract_id');
    table.index('window_id');
    table.index('event_type');
    table.index('created_at');
    table.index(['contract_id', 'window_id']);
    table.index(['contract_id', 'event_type']);
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('time_window_events');
}
