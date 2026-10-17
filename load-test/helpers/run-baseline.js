#!/usr/bin/env node
/**
 * Baseline load-test runner (Issue #524)
 *
 * Runs the Artillery scenarios against a running backend and captures the
 * baseline latency / throughput metrics into a machine-readable report that can
 * be committed to the repository and used as a comparison target for later runs.
 *
 * The baseline is derived from the HTTP "trade-order" scenario plus the
 * WebSocket scenario. Results are written to:
 *   - load-test/reports/baseline-<scenario>.json  (full Artillery raw output)
 *   - load-test/reports/baseline-metrics.json     (curated latency/throughput)
 *
 * Usage:
 *   node load-test/helpers/run-baseline.js
 *   node load-test/helpers/run-baseline.js --scenario trade-orders --out baseline-v2
 *
 * Prerequisites:
 *   - Backend must be running (npm --prefix backend run start, port 3001).
 *   - Artillery dependencies installed (npm --prefix load-test install).
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');
mkdirSync(REPORTS_DIR, { recursive: true });

const DEFAULT_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const DATE_STAMP = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

function parseArgs(argv) {
  const args = { scenario: 'trade-orders', out: null, baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scenario') args.scenario = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--base-url') args.baseUrl = argv[++i];
  }
  return args;
}

function runScenario(scenario, baseUrl) {
  const yml = join(ROOT, 'artillery', `${scenario}.yml`);
  if (!existsSync(yml)) {
    throw new Error(`Scenario not found: ${yml}`);
  }
  const targetFlag = scenario === 'websocket'
    ? ` -t ${baseUrl.replace(/^http/, 'ws')}/ws`
    : ` -t ${baseUrl}`;
  return execSync(
    `npx artillery run ${yml}${targetFlag} --output ${REPORTS_DIR}/baseline-${scenario}.json`,
    {
      cwd: ROOT,
      env: { ...process.env, API_BASE_URL: baseUrl },
      stdio: 'inherit',
    }
  );
}

function extractMetrics(rawPath) {
  if (!existsSync(rawPath)) {
    throw new Error(`Raw output missing: ${rawPath}`);
  }
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));

  const httpAggregates = raw?.aggregate;
  const wsAggregates = raw?.scenarios?.[0]?.aggregate;

  return {
    id: DATE_STAMP,
    baseUrl: DEFAULT_BASE_URL,
    generatedAt: new Date().toISOString(),
    http: extractHttp(httpAggregates),
    websocket: extractWs(wsAggregates),
    rawOutputFile: rawPath,
  };
}

function extractHttp(agg) {
  if (!agg) return null;
  const latencies = agg.latency?.p99 ?? [];
  return {
    requestsCompleted: agg.requestsCompleted ?? 0,
    requestRatePerSecond: agg.requestsPerSecond ?? agg.rps,
    totalCodes: agg.codes,
    latency: {
      meanMs: meanMs(agg.latency),
      p50: percentileMs(agg.latency, 50),
      p95: percentileMs(agg.latency, 95),
      p99: percentileMs(agg.latency, 99),
      maxMs: agg.latency?.max ?? null,
    },
    throughput: {
      bytesPerSecond: agg.throughput?.bytesPerSecond ?? null,
      totalBytes: agg.throughput?.totalBytes ?? null,
      scenariosCompleted: agg.scenariosCompleted ?? null,
      scenariosCreated: agg.scenariosCreated ?? null,
    },
    errors: {
      count: sumErrors(agg.errors),
      types: agg.errors,
    },
  };
}

function extractWs(agg) {
  if (!agg) return null;
  return {
    scenariosCreated: agg.scenariosCreated ?? null,
    scenariosCompleted: agg.scenariosCompleted ?? null,
    connectionDurationMs: agg.connectionDuration
      ? { mean: agg.connectionDuration.mean, p99: agg.connectionDuration.p99 }
      : null,
  };
}

function percentileMs(dist, pct) {
  // dist is [{count, min?, max?, mean}...] or a histogram with ordinal buckets.
  if (Array.isArray(dist)) {
    const total = dist.reduce((s, d) => s + (d.count ?? 0), 0);
    if (total === 0) return null;
    const target = (pct / 100) * total;
    let acc = 0;
    for (const d of dist) {
      acc += d.count ?? 0;
      if (acc >= target) return d.mean ?? medianBucket(d);
    }
  }
  return null;
}

function medianBucket(d) {
  return d && typeof d.mean === 'number' ? d.mean : null;
}

function meanMs(dist) {
  if (Array.isArray(dist) && dist.length) {
    const total = dist.reduce((s, d) => s + (d.count ?? 0), 0);
    if (total === 0) return null;
    const sum = dist.reduce((s, d) => s + (d.count ?? 0) * (d.mean ?? 0), 0);
    return sum / total;
  }
  return null;
}

function sumErrors(errors) {
  if (!errors || typeof errors !== 'object') return 0;
  return Object.values(errors).reduce((s, v) => s + (typeof v === 'number' ? v : 1), 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n=== Tokenized Fractional Load-Test Baseline ===`);
  console.log(`Scenario : ${args.scenario}`);
  console.log(`Base URL : ${args.baseUrl}`);

  const scenarios = args.scenario === 'all' ? ['trade-orders', 'websocket'] : [args.scenario];
  const metrics = { generatedAt: new Date().toISOString(), baseUrl: args.baseUrl, runs: [] };

  for (const scenario of scenarios) {
    console.log(`\n--- Running: ${scenario} ---`);
    try {
      runScenario(scenario, args.baseUrl);
      const rawPath = join(REPORTS_DIR, `baseline-${scenario}.json`);
      const extracted = extractMetrics(rawPath);
      metrics.runs.push({ scenario, ...extracted });
      console.log(`Finished ${scenario}: requests=${extracted.http?.requestsCompleted ?? 'n/a'}, ` +
        `req/s=${extracted.http?.requestRatePerSecond?.toFixed?.(1) ?? 'n/a'}`);
    } catch (error) {
      console.error(`Failed to run ${scenario}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  const outName = args.out || `baseline-${DATE_STAMP}`;
  const outFile = join(REPORTS_DIR, `${outName}.json`);
  writeFileSync(outFile, JSON.stringify(metrics, null, 2));
  console.log(`\nBaseline metrics written to: ${outFile}`);
  console.log(JSON.stringify(metrics, null, 2));
}

main();
