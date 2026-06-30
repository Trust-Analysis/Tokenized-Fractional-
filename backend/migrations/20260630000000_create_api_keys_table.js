/**
 * Migration: create api_keys table for API key management
 * 
 * Stores hashed API keys with metadata, expiration, revocation status,
 * and usage tracking for the multi-key authentication system.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('api_keys', (table) => {
    table.string('id').primary(); // key_<12 random hex chars>
    table.string('name').notNullable(); // Human-readable name
    table.string('key_hash', 64).notNullable().unique(); // SHA256 hash of the actual key
    table.text('description').nullable(); // Optional description
    table.datetime('expires_at').nullable(); // Optional expiration date
    table.datetime('revoked_at').nullable(); // Null if active, timestamp if revoked
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();
    table.datetime('last_used_at').nullable(); // Track last usage
    table.integer('usage_count').unsigned().defaultTo(0); // Track total usages
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('api_keys');
}
