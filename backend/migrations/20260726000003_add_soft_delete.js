/**
 * Soft Delete Migration
 * Adds deleted_at timestamp columns to core tables and creates partial indexes
 * to ensure high query performance when excluding soft-deleted records.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const tables = ['assets', 'api_keys', 'transactions'];

  for (const table of tables) {
    await knex.schema.alterTable(table, (t) => {
      t.timestamp('deleted_at').nullable().defaultTo(null);
      t.index(['deleted_at']);
    });

    // Create partial index for high performance queries excluding soft-deleted records
    if (knex.client.config.client === 'pg') {
      await knex.raw(`CREATE INDEX idx_${table}_active ON ${table} (deleted_at) WHERE deleted_at IS NULL;`);
    }
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  const tables = ['assets', 'api_keys', 'transactions'];

  if (knex.client.config.client === 'pg') {
    for (const table of tables) {
      await knex.raw(`DROP INDEX IF EXISTS idx_${table}_active;`);
    }
  }

  for (const table of tables) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('deleted_at');
    });
  }
}
