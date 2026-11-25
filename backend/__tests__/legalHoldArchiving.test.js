// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/legalHoldArchiving.test.js — Issue #912: Legal Hold Exclusion from Archiving
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import knexModule from 'knex';
import fs from 'fs/promises';
import {
  archiveOldTransactions,
  placeLegalHold,
  releaseLegalHold,
} from '../src/services/archiveService.js';
import * as databaseModule from '../src/services/database.js';

describe('Issue #912: Legal Hold Retention Exception', () => {
  let db;

  beforeEach(async () => {
    db = knexModule({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Mock getDatabase to return our test db
    jest.spyOn(databaseModule, 'getDatabase').mockReturnValue(db);

    await db.schema.createTable('transactions', (table) => {
      table.increments('id').primary();
      table.string('transaction_id').unique().notNullable();
      table.string('contract_id').notNullable();
      table.string('buyer_address').notNullable();
      table.decimal('shares_purchased', 20, 2).notNullable();
      table.decimal('price_per_share', 20, 8).notNullable();
      table.decimal('total_amount', 20, 8).notNullable();
      table.string('payment_token').notNullable();
      table.string('status').defaultTo('completed');
      table.boolean('legal_hold').defaultTo(false).notNullable();
      table.string('legal_hold_reason').nullable();
      table.timestamp('legal_hold_placed_at').nullable();
      table.string('legal_hold_placed_by').nullable();
      table.timestamps(true, true);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (db) await db.destroy();
    try {
      await fs.rm('./archives', { recursive: true, force: true });
    } catch {}
  });

  test('confirms legal-hold-flagged transaction is skipped by archiving job even after exceeding retention window', async () => {
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 400); // 400 days old (retention is 365)

    // Insert two expired transactions: one normal, one under legal hold
    await db('transactions').insert([
      {
        transaction_id: 'tx_normal_old',
        contract_id: 'C_ASSET_1',
        buyer_address: 'G_BUYER_1',
        shares_purchased: 10,
        price_per_share: 10,
        total_amount: 100,
        payment_token: 'XLM',
        created_at: expiredDate,
        legal_hold: false,
      },
      {
        transaction_id: 'tx_disputed_old',
        contract_id: 'C_ASSET_2',
        buyer_address: 'G_BUYER_2',
        shares_purchased: 50,
        price_per_share: 20,
        total_amount: 1000,
        payment_token: 'XLM',
        created_at: expiredDate,
        legal_hold: true,
        legal_hold_reason: 'Active fraud investigation',
        legal_hold_placed_by: 'compliance_officer',
        legal_hold_placed_at: new Date(),
      },
    ]);

    // Run transaction archiving job
    const result = await archiveOldTransactions();

    // The normal transaction should be archived and deleted from primary DB
    expect(result.archived).toBe(1);

    const remaining = await db('transactions').select('*');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].transaction_id).toBe('tx_disputed_old');
    expect(remaining[0].legal_hold).toBeTruthy();
  });

  test('can place and release legal hold using service methods', async () => {
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 400);

    await db('transactions').insert({
      transaction_id: 'tx_to_hold',
      contract_id: 'C_ASSET_3',
      buyer_address: 'G_BUYER_3',
      shares_purchased: 5,
      price_per_share: 10,
      total_amount: 50,
      payment_token: 'XLM',
      created_at: expiredDate,
      legal_hold: false,
    });

    // Place legal hold
    const placed = await placeLegalHold('tx_to_hold', {
      reason: 'SEC Inquiry #4892',
      placedBy: 'admin_user',
    });
    expect(placed.legal_hold).toBeTruthy();
    expect(placed.legal_hold_reason).toBe('SEC Inquiry #4892');

    // Archiving runs: should skip it
    let res = await archiveOldTransactions();
    expect(res.archived).toBe(0);

    // Release legal hold
    const released = await releaseLegalHold('tx_to_hold', { releasedBy: 'admin_user' });
    expect(released.legal_hold).toBeFalsy();

    // Archiving runs again: now it archives
    res = await archiveOldTransactions();
    expect(res.archived).toBe(1);

    const remaining = await db('transactions').select('*');
    expect(remaining).toHaveLength(0);
  });
});
