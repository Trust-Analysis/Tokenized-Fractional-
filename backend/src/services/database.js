// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/database.js — Database initialization and connection management
 */

import knex from 'knex';
import knexConfig from '../../knexfile.js';

let dbInstance = null;

/**
 * Initialize database connection
 * @param {string} environment - Environment name (development, test, production)
 * @returns {Promise<import('knex').Knex>}
 */
export async function initDatabase(environment = 'development') {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = knex(knexConfig[environment]);

  // Run migrations
  try {
    await dbInstance.migrate.latest();
  } catch (error) {
    console.error('Database migration failed:', error);
    throw error;
  }

  return dbInstance;
}

/**
 * Get database instance (must call initDatabase first)
 * @returns {import('knex').Knex}
 */
export function getDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Close database connection
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
