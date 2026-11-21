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

// Issue #317: Read replica configuration
const readReplicaConfig = {
  // Primary connection (writes)
  primary: {
    ...base,
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
  },
  // Replica connections (reads) - comma-separated URLs
  replicas: (process.env.READ_REPLICA_URLS || '')
    .split(',')
    .filter(Boolean)
    .map((url) => ({
      ...base,
      client: 'pg',
      connection: url.trim(),
      pool: { min: 1, max: 15 },
    })),
};

export { readReplicaConfig };

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

  // Issue #314: Optimized production connection pooling
  // Tuned for high concurrency with health checks and leak detection
  production: {
    ...base,
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
      acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT, 10) || 30000,
      createTimeoutMillis: parseInt(process.env.DB_CREATE_TIMEOUT, 10) || 5000,
      destroyTimeoutMillis: parseInt(process.env.DB_DESTROY_TIMEOUT, 10) || 5000,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 60000,
      reapIntervalMillis: parseInt(process.env.DB_REAP_INTERVAL, 10) || 1000,
      createRetryIntervalMillis: parseInt(process.env.DB_CREATE_RETRY_INTERVAL, 10) || 100,
      propagateCreateError: false,
      afterCreate: (conn, done) => {
        // Validate connection on creation
        conn.query('SELECT 1', (err) => {
          if (err) {
            done(err, conn);
          } else {
            done(null, conn);
          }
        });
      },
    },
  },
};
