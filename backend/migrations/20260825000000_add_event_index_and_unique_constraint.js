/**
 * Migration: Add event_index and composite unique constraint for idempotency
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.integer('event_index').defaultTo(0);
    // Add unique constraint for idempotency
    table.unique(['blockchain_hash', 'event_index']);
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.dropUnique(['blockchain_hash', 'event_index']);
    table.dropColumn('event_index');
  });
}
