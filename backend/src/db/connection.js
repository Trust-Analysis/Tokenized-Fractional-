const { Pool } = require('pg');

// Primary (Write) connection pool for mutations and transactional writes
const primaryPool = new Pool({
  connectionString: process.env.PRIMARY_DB_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/rwa_primary',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Read Replica connection pool for read-heavy GraphQL queries
// Falls back to primaryPool if REPLICA_DB_URL is not set
const replicaPool = process.env.REPLICA_DB_URL 
  ? new Pool({
      connectionString: process.env.REPLICA_DB_URL,
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  : primaryPool;

/**
 * Execute a database query routed to either the read replica or primary writer.
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 * @param {boolean} isRead - true for read queries (replicas), false for mutations (primary)
 */
const query = async (text, params, isRead = true) => {
  const pool = isRead ? replicaPool : primaryPool;
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[DB] Target: ${isRead ? 'REPLICA (Read)' : 'PRIMARY (Write)'} | Time: ${duration}ms | Rows: ${res.rowCount}`);
    }
    return res;
  } catch (error) {
    console.error(`[DB Error] Target: ${isRead ? 'REPLICA' : 'PRIMARY'} | Msg:`, error.message);
    // Automatic fallback to primary if replica read fails
    if (isRead && pool !== primaryPool) {
      console.warn('[DB Warning] Read replica query failed. Falling back to primary pool...');
      return await primaryPool.query(text, params);
    }
    throw error;
  }
};

module.exports = {
  query,
  primaryPool,
  replicaPool
};
