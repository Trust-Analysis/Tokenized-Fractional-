// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Migration: Add legal_hold flag and audit fields to transactions table.
 * Exempts transactions subject to active disputes, investigations, or legal holds
 * from automated retention archiving (Issue #912).
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('transactions', 'legal_hold');
  if (!hasColumn) {
    await knex.schema.alterTable('transactions', (table) => {
      table.boolean('legal_hold').defaultTo(false).notNullable();
      table.string('legal_hold_reason').nullable();
      table.timestamp('legal_hold_placed_at').nullable();
      table.string('legal_hold_placed_by').nullable();
      table.index(['legal_hold']);
    });
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('transactions', 'legal_hold');
  if (hasColumn) {
    await knex.schema.alterTable('transactions', (table) => {
      table.dropIndex(['legal_hold']);
      table.dropColumn('legal_hold_placed_by');
      table.dropColumn('legal_hold_placed_at');
      table.dropColumn('legal_hold_reason');
      table.dropColumn('legal_hold');
    });
  }
}
