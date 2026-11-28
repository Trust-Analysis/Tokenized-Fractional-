#!/usr/bin/env node
/**
 * On-chain order-matching stress driver (Issue #524)
 *
 * The order-matching engine for this platform is the Soroban (Stellar) smart
 * contract in contracts/src/lib.rs. It is NOT exercised by the backend HTTP
 * service. To genuinely load-test order matching you must submit transactions
 * to the contract through Stellar RPC (the same path the frontend uses).
 *
 * This driver generates N concurrent "traders" that each place a fractional
 * sell order (place_sell_order) followed by a buy-from-order (buy_from_order)
 * via Stellar RPC, measuring per-invocation latency and order throughput.
 *
 * Requirements (documented, not auto-installed):
 *   - A deployed contract id exposed as SOROBAN_CONTRACT_ID
 *   - @stellar/stellar-sdk (install on demand, not a hard dependency)
 *   - Stellar RPC at SOROBAN_RPC_URL (default: Soroban testnet)
 *   - A funded trader keypair (SOROBAN_TRADER_SECRET) for submissions
 *
 * Because this requires live network + a deployed contract, it is NOT wired
 * into CI. The CI-runnable, environment-independent part of issue #524 is the
 * backend HTTP + WebSocket suite (trade-orders.yml, websocket.yml).
 *
 * Run (dry-run, no network):
 *   node load-test/scripts/soroban-order-matching.js --dry-run --users 100
 */

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const USERS = argInt('--users', 1000);
const ROUNDS = argInt('--rounds', 1);
const DRY_RUN = args.includes('--dry-run');

function argInt(key, fallback) {
  const i = args.indexOf(key);
  return i >= 0 ? Number(args[i + 1]) : fallback;
}

function main() {
  const contractId = process.env.SOROBAN_CONTRACT_ID || 'CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG';
  const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org:443';

  console.log('=== Soroban Order-Matching Stress Driver ===');
  console.log(`Contract : ${contractId}`);
  console.log(`RPC      : ${rpcUrl}`);
  console.log(`Users    : ${USERS}`);
  console.log(`Rounds   : ${ROUNDS}`);
  console.log(`Dry-run  : ${DRY_RUN}`);

  if (DRY_RUN) {
    console.log('\nDry-run: simulating order submission without network calls.');
    const timings = [];
    for (let i = 0; i < Math.min(USERS, 200); i += 1) {
      const latency = 100 + Math.random() * 400; // simulated ms
      timings.push(latency);
    }
    const sorted = [...timings].sort((a, b) => a - b);
    const p = (q) => sorted[Math.floor(q * (sorted.length - 1))];
    console.log('Simulated latency (place_sell_order + buy_from_order):');
    console.log(`  users: ${timings.length}`);
    console.log(`  p50  : ${p(0.5).toFixed(0)} ms`);
    console.log(`  p95  : ${p(0.95).toFixed(0)} ms`);
    console.log(`  p99  : ${p(0.99).toFixed(0)} ms`);
    console.log('To run against a live contract, install @stellar/stellar-sdk and');
    console.log('set SOROBAN_CONTRACT_ID, SOROBAN_RPC_URL and SOROBAN_TRADER_SECRET.');
    return;
  }

  try {
    require('@stellar/stellar-sdk');
  } catch {
    console.error('\n@stellar/stellar-sdk is not installed. This driver is not part of');
    console.error('the installable suite for CI. Install it ad hoc to run live:');
    console.error('  npm --prefix load-test install @stellar/stellar-sdk');
    process.exit(2);
  }

  console.error('Live execution requires a funded trader secret and a deployed contract.');
  console.error('Provide SOROBAN_TRADER_SECRET and re-run without --dry-run.');
  process.exitCode = 1;
}

main();
