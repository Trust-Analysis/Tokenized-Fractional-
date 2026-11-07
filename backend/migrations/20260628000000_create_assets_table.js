/**
 * Initial migration: create the assets table.
 *
 * Each row represents one tokenized real-world asset, keyed by its
 * Soroban contract ID.  The `metadata` column stores any extra JSON
 * fields that don't warrant their own column.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('assets', (table) => {
    table.string('contract_id').primary();
    table.string('name').notNullable();
    table.string('symbol').notNullable();
    table.text('description');
    table.string('image_url');
    table.string('asset_type');
    table.decimal('total_value', 20, 2);
    table.string('currency', 10).defaultTo('USD');
    table.jsonb('metadata');
    table.timestamps(true, true); // created_at / updated_at
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('assets');
}
