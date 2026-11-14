#!/usr/bin/env node
/**
 * Cross-instance WebSocket load-test runner (Issue #894)
 *
 * Simulates the multi-replica backend topology that
 * backend/websocketRedisAdapter.js exists to serve, without needing the full
 * backend or Redis:
 *
 *   instance-b (:3001)  <- WebSocket clients under test (Artillery target)
 *   instance-a (:3002)  <- receives the broadcast trigger HTTP requests
 *                          and forwards them to instance-b via PEER_URL,
 *                          emulating the Redis pub/sub bridge
 *
 * It then runs artillery/websocket.yml against them. The run FAILS if any
 * broadcast triggered on instance A is never delivered to instance B's clients
 * (asserted by the `after` hook in helpers/processor.js), and records the
 * websocket.cross_instance_broadcast_latency histogram (p95 threshold).
 *
 * Run:
 *   npm run test:websocket:cross-instance
 *   INSTANCE_B_PORT=4001 INSTANCE_A_PORT=4002 npm run test:websocket:cross-instance
 */

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOAD_TEST_ROOT = path.resolve(__dirname, '..');

const INSTANCE_B_PORT = Number(process.env.INSTANCE_B_PORT || 3001);
const INSTANCE_A_PORT = Number(process.env.INSTANCE_A_PORT || 3002);
// Optional Artillery config override (e.g. a trimmed-phases variant for CI).
const ARTILLERY_CONFIG = process.env.ARTILLERY_CONFIG || 'artillery/websocket.yml';

const children = [];
let shuttingDown = false;

function startInstance(name, port, extraEnv) {
  const child = spawn(process.execPath, ['mock-server.js'], {
    cwd: LOAD_TEST_ROOT,
    env: { ...process.env, PORT: String(port), INSTANCE_ID: name, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  child.on('exit', () => {
    if (!shuttingDown) shutdown(1);
  });
  return child;
}

async function waitForHealth(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Instance on :${port} did not become healthy within ${timeoutMs}ms`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

/**
 * Delivery assertion (Issue #894).
 *
 * Artillery runs VUs in worker processes, so delivery state cannot be
 * asserted in-process; instead we assert on the aggregated report counters:
 *  - `..._sent`     : broadcasts triggered on instance A
 *  - `..._received` : receipts by clients connected to instance B
 *  - `..._failed`   : trigger POSTs that never reached instance A
 *
 * Every broadcast fans out to all subscribed clients, so a healthy cross-
 * instance bridge yields received >= sent. XB_DELIVERY_MIN_RATIO (default 1)
 * sets the minimum required receipts per triggered broadcast.
 *
 * @param {string} reportPath - Path to the Artillery JSON report
 * @returns {number} 0 when the assertion passes, 1 otherwise
 */
function assertCrossInstanceDelivery(reportPath) {
  if (!existsSync(reportPath)) {
    console.error(`[cross-instance] Artillery report not found at ${reportPath}; cannot assert delivery.`);
    return 1;
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const counters = (report.aggregate && report.aggregate.counters) || {};
  const sent = counters['websocket.cross_instance_broadcast_sent'] || 0;
  const received = counters['websocket.cross_instance_broadcast_received'] || 0;
  const failed = counters['websocket.cross_instance_broadcast_failed'] || 0;
  const minRatio = Number(process.env.XB_DELIVERY_MIN_RATIO || '1');
  const required = sent * minRatio;

  console.log(
    `[cross-instance] delivery check: sent=${sent} received=${received} failed=${failed} ` +
      `(required >= ${required} client receipts)`
  );

  if (sent === 0) {
    console.error(
      '[cross-instance] DELIVERY ASSERTION FAILED: no cross-instance broadcasts were triggered — ' +
        'the scenario did not exercise the cross-instance path at all.'
    );
    return 1;
  }
  if (failed > 0) {
    console.error(
      `[cross-instance] DELIVERY ASSERTION FAILED: ${failed} broadcast trigger(s) never reached ` +
        'instance A over HTTP.'
    );
    return 1;
  }
  if (received < required) {
    console.error(
      `[cross-instance] DELIVERY ASSERTION FAILED: ${received} client receipt(s) for ${sent} ` +
        'broadcast(s) triggered on instance A. Broadcasts were not fanned out to clients on ' +
        'instance B — the cross-instance (Redis pub/sub) broadcast path is broken.'
    );
    return 1;
  }

  console.log('[cross-instance] ✓ every broadcast triggered on instance A reached clients on instance B.');
  return 0;
}

// Instance B: the WebSocket endpoint the load-test clients connect to.
startInstance('instance-b', INSTANCE_B_PORT, {});
// Instance A: receives broadcast triggers and bridges them to instance B
// (emulating the Redis pub/sub cross-instance fan-out).
startInstance('instance-a', INSTANCE_A_PORT, {
  PEER_URL: `http://localhost:${INSTANCE_B_PORT}`,
});

async function main() {
  try {
    await waitForHealth(INSTANCE_B_PORT);
    await waitForHealth(INSTANCE_A_PORT);
  } catch (err) {
    console.error(`[cross-instance] ${err.message}`);
    return shutdown(1);
  }

  const artilleryBin = path.join(LOAD_TEST_ROOT, 'node_modules', '.bin', 'artillery');
  if (!existsSync(artilleryBin)) {
    console.error('[cross-instance] Artillery is not installed. Run `npm install` in load-test/ first.');
    return shutdown(1);
  }

  mkdirSync(path.join(LOAD_TEST_ROOT, 'reports'), { recursive: true });
  console.log(
    `[cross-instance] instance-b ws://localhost:${INSTANCE_B_PORT}/ws <- clients, ` +
      `instance-a http://localhost:${INSTANCE_A_PORT} <- triggers`
  );
  const artillery = spawn(
    artilleryBin,
    ['run', ARTILLERY_CONFIG, '--output', 'reports/websocket-cross-instance.json'],
    {
      cwd: LOAD_TEST_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Broadcast triggers must hit instance A; WS clients stay on instance B.
        INSTANCE_A_API_URL: `http://localhost:${INSTANCE_A_PORT}`,
        INSTANCE_A_API: `http://localhost:${INSTANCE_A_PORT}`,
      },
    }
  );
  artillery.on('exit', (code) => {
    if (code === 0) {
      const reportPath = path.join(LOAD_TEST_ROOT, 'reports', 'websocket-cross-instance.json');
      shutdown(assertCrossInstanceDelivery(reportPath));
    } else {
      shutdown(code ?? 1);
    }
  });
}

await main();
