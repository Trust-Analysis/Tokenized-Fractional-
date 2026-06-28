// Knex configuration for database migrations.
// Uses SQLite in development/test and PostgreSQL in production.
// Set DATABASE_URL in your .env to override the default SQLite path.

/** @type {import('knex').Knex.Config} */
const base = {
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
};

export default {
  development: {
    ...base,
    client: 'better-sqlite3',
    connection: { filename: process.env.DATABASE_URL || './dev.db' },
    useNullAsDefault: true,
  },

  test: {
    ...base,
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  },

  production: {
    ...base,
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 10 },
  },
};
