#!/usr/bin/env node
// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * check-disk-usage.js — issue #801
 *
 * Cron-friendly wrapper around src/utils/diskUsage.js. Render (and any other
 * scheduler) alerts on a non-zero exit status, so this script deliberately
 * encodes severity in its exit code:
 *
 *   0  usage below the warn threshold            (healthy)
 *   1  usage at/above DISK_USAGE_WARN_PERCENT      (investigate)
 *   2  usage at/above DISK_USAGE_CRITICAL_PERCENT  (writes at risk, act now)
 *   3  usage could not be measured                 (do not assume healthy)
 *
 * Usage:
 *   node scripts/check-disk-usage.js
 *   node scripts/check-disk-usage.js --json
 *   node scripts/check-disk-usage.js --path /var/data
 *   node scripts/check-disk-usage.js --warn 75 --critical 85
 *
 * The default target is the directory that holds DATA_FILE, because that is the
 * volume whose exhaustion would actually break the API.
 *
 * See docs/disk-usage-monitoring.md for the response procedure and for how to
 * wire this into the hosting platform.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STATUS_CRITICAL,
  STATUS_OK,
  STATUS_UNKNOWN,
  STATUS_WARN,
  readDiskUsage,
  resolveDataDirectory,
  resolveThresholds,
} from '../src/utils/diskUsage.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Exit code per status — the contract schedulers depend on. */
export const EXIT_CODES = {
  [STATUS_OK]: 0,
  [STATUS_WARN]: 1,
  [STATUS_CRITICAL]: 2,
  [STATUS_UNKNOWN]: 3,
};

/**
 * Parse argv into options.
 *
 * Unknown flags are rejected rather than ignored: a typo in a cron command
 * should fail loudly instead of silently monitoring the default path.
 *
 * @param {string[]} argv
 * @returns {{ path?: string, json: boolean, warn?: string, critical?: string }}
 */
export function parseArgs(argv) {
  const options = { json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--path' || arg === '--warn' || arg === '--critical') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

/**
 * Resolve the directory to measure.
 *
 * @param {{ path?: string }} options
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveTargetPath(options, env = process.env) {
  if (options.path) return resolve(options.path);
  if (env.DISK_USAGE_PATH) return resolve(env.DISK_USAGE_PATH);
  return resolveDataDirectory(BACKEND_ROOT, env);
}

const HELP = `Usage: node scripts/check-disk-usage.js [options]

Options:
  --path <dir>       directory whose filesystem to measure
                     (default: the directory holding DATA_FILE)
  --warn <percent>   override DISK_USAGE_WARN_PERCENT
  --critical <pct>   override DISK_USAGE_CRITICAL_PERCENT
  --json             emit a single JSON object instead of a log line
  -h, --help         show this message

Exit codes: 0 ok, 1 warn, 2 critical, 3 could not measure.
`;

/**
 * Run the check.
 *
 * @param {string[]} argv
 * @param {{ env?: Record<string, string|undefined>, stdout?: (line: string) => void, stderr?: (line: string) => void }} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr(`check-disk-usage: ${error.message}`);
    stderr(HELP);
    return EXIT_CODES[STATUS_UNKNOWN];
  }

  if (options.help) {
    stdout(HELP);
    return EXIT_CODES[STATUS_OK];
  }

  // CLI flags win over the environment; both are consumed by resolveThresholds
  // through a merged view so there is exactly one place that validates them.
  const effectiveEnv = {
    ...env,
    ...(options.warn !== undefined && { DISK_USAGE_WARN_PERCENT: options.warn }),
    ...(options.critical !== undefined && { DISK_USAGE_CRITICAL_PERCENT: options.critical }),
  };

  const targetPath = resolveTargetPath(options, env);
  const usage = await readDiskUsage(targetPath, { env: effectiveEnv });

  if (options.json) {
    stdout(JSON.stringify({ ...usage, thresholds: resolveThresholds(effectiveEnv) }));
  } else if (usage.status === STATUS_UNKNOWN) {
    stderr(
      `check-disk-usage: ${usage.message} (target: ${usage.path}) — treating as UNKNOWN, exit ${EXIT_CODES[STATUS_UNKNOWN]}`,
    );
  } else {
    const line = [
      `disk usage ${usage.status.toUpperCase()}`,
      `${usage.usedPercent}% of ${usage.total} used`,
      `${usage.available} available`,
      `target ${usage.path}`,
      `warn ${usage.thresholds.warnPercent}% / critical ${usage.thresholds.criticalPercent}%`,
    ].join(' | ');

    // Warn/critical go to stderr so a scheduler that only captures stderr still
    // surfaces the alert.
    (usage.status === STATUS_OK ? stdout : stderr)(line);
  }

  return EXIT_CODES[usage.status] ?? EXIT_CODES[STATUS_UNKNOWN];
}

// Only run when invoked directly, so the module stays importable from tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`check-disk-usage: unexpected failure: ${error?.stack || error}\n`);
      process.exitCode = EXIT_CODES[STATUS_UNKNOWN];
    });
}
