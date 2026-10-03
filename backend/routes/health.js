const express = require('express');
const router = express.Router();

// You'll need access to your existing DB/Redis/RPC clients.
// Adjust these imports to match how they're set up elsewhere in backend/index.js
const { pool } = require('../db');           // PostgreSQL pool
const redisClient = require('../redisClient'); // Redis client
const { rpcUrl } = require('../config');       // Blockchain RPC endpoint

const TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

// GET /healthz — basic process status, no dependency checks
router.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// GET /livez — liveness probe (is the process alive at all)
router.get('/livez', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// GET /readyz — readiness probe (are dependencies reachable)
router.get('/readyz', async (req, res) => {
  const checks = {};
  let allHealthy = true;

  // Postgres
  try {
    await withTimeout(pool.query('SELECT 1'), TIMEOUT_MS);
    checks.postgres = 'ok';
  } catch (err) {
    checks.postgres = `unreachable: ${err.message}`;
    allHealthy = false;
  }

  // Redis
  try {
    await withTimeout(redisClient.ping(), TIMEOUT_MS);
    checks.redis = 'ok';
  } catch (err) {
    checks.redis = `unreachable: ${err.message}`;
    allHealthy = false;
  }

  // Blockchain RPC node
  try {
    const response = await withTimeout(
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      }),
      TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`status ${response.status}`);
    checks.blockchainRpc = 'ok';
  } catch (err) {
    checks.blockchainRpc = `unreachable: ${err.message}`;
    allHealthy = false;
  }

  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: allHealthy ? 'ready' : 'not ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;