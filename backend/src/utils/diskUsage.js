// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * diskUsage.js — issue #801
 *
 * The backend persists asset metadata to a file on the instance's local disk
 * (`DATA_FILE`, default `data.json`, resolved next to `backend/index.js`). Until
 * this module existed nothing observed the filesystem that file lives on, so a
 * slow fill-up — unbounded local log files, a retained dump, an oversized
 * upload left behind — would only announce itself as a write failure with no
 * advance warning.
 *
 * This module is the single source of truth for "how full is the volume?".
 * The health endpoint, the `check-disk-usage` CLI and the Prometheus gauge all
 * call in here, so they cannot disagree about the numbers or about which
 * threshold is which.
 *
 * Thresholds
 * ----------
 *   DISK_USAGE_WARN_PERCENT      default 80
 *   DISK_USAGE_CRITICAL_PERCENT  default 90
 *
 * See docs/disk-usage-monitoring.md for the alert response procedure.
 */

import { statfsSync } from 'node:fs';
import { statfs as statfsAsync } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Percentage of the volume used at which an operator should start looking. */
export const DEFAULT_WARN_PERCENT = 80;

/** Percentage of the volume used at which writes are considered at risk. */
export const DEFAULT_CRITICAL_PERCENT = 90;

/** Status returned when usage can be measured and is below the warn threshold. */
export const STATUS_OK = 'ok';
/** Status returned when usage is at or above the warn threshold. */
export const STATUS_WARN = 'warn';
/** Status returned when usage is at or above the critical threshold. */
export const STATUS_CRITICAL = 'critical';
/** Status returned when usage could not be measured at all. */
export const STATUS_UNKNOWN = 'unknown';

/**
 * Resolve the directory that holds `DATA_FILE`.
 *
 * The backend persists `data.json` next to `backend/index.js`, so the volume at
 * risk is the one holding that file's directory. Every caller goes through this
 * helper so the health endpoint, the Prometheus gauge and the CLI cannot end up
 * measuring three different mounts.
 *
 * @param {string} backendRoot absolute path to the backend package root
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function resolveDataDirectory(backendRoot, env = process.env) {
  return dirname(join(backendRoot, env.DATA_FILE || 'data.json'));
}

/**
 * Parse a percentage environment variable.
 *
 * Returns `undefined` for values that are not a finite number in (0, 100] so
 * that a typo cannot silently disable alerting by producing NaN comparisons
 * (every `NaN >= threshold` comparison is false, which would have read as
 * "healthy").
 *
 * @param {string|undefined} raw
 * @returns {number|undefined}
 */
export function parsePercent(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return undefined;
  return value;
}

/**
 * Resolve the warn/critical thresholds, falling back to the defaults.
 *
 * A critical threshold that is not strictly above the warn threshold would make
 * the warn band empty, so that combination is discarded in favour of the
 * defaults rather than accepted silently.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ warnPercent: number, criticalPercent: number }}
 */
export function resolveThresholds(env = process.env) {
  const warnPercent = parsePercent(env.DISK_USAGE_WARN_PERCENT) ?? DEFAULT_WARN_PERCENT;
  const criticalPercent = parsePercent(env.DISK_USAGE_CRITICAL_PERCENT) ?? DEFAULT_CRITICAL_PERCENT;

  if (criticalPercent <= warnPercent) {
    return {
      warnPercent: DEFAULT_WARN_PERCENT,
      criticalPercent: DEFAULT_CRITICAL_PERCENT,
    };
  }

  return { warnPercent, criticalPercent };
}

/**
 * Classify a usage percentage against the thresholds.
 *
 * @param {number} usedPercent
 * @param {{ warnPercent: number, criticalPercent: number }} thresholds
 * @returns {string} one of STATUS_OK | STATUS_WARN | STATUS_CRITICAL
 */
export function classifyUsage(usedPercent, thresholds) {
  if (!Number.isFinite(usedPercent)) return STATUS_UNKNOWN;
  if (usedPercent >= thresholds.criticalPercent) return STATUS_CRITICAL;
  if (usedPercent >= thresholds.warnPercent) return STATUS_WARN;
  return STATUS_OK;
}

/**
 * Human-readable byte formatting for log lines and CLI output.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Turn raw `statfs` numbers into the shared snapshot shape.
 *
 * `statfs` reports the filesystem, not the directory, which is exactly what we
 * want: the volume that `data.json` is written to. `bavail` (available to an
 * unprivileged process) is reported separately from `bfree` (free including the
 * reserved blocks) because a backend running as a non-root user is bounded by
 * the former.
 *
 * @param {object} stats
 * @param {string} targetPath
 * @param {{ warnPercent: number, criticalPercent: number }} thresholds
 * @returns {object}
 */
function summarize(stats, targetPath, thresholds) {
  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const freeBytes = Number(stats.bfree) * blockSize;
  const availableBytes = Number(stats.bavail) * blockSize;

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return {
      path: targetPath,
      status: STATUS_UNKNOWN,
      message: 'filesystem reported a zero-sized volume',
      thresholds,
    };
  }

  const usedBytes = totalBytes - freeBytes;
  // Rounded to 2dp only for reporting; classification uses the raw ratio so a
  // value like 89.999 does not round up into "critical".
  const usedPercent = (usedBytes / totalBytes) * 100;

  return {
    path: targetPath,
    status: classifyUsage(usedPercent, thresholds),
    usedPercent: Number(usedPercent.toFixed(2)),
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    total: formatBytes(totalBytes),
    used: formatBytes(usedBytes),
    available: formatBytes(availableBytes),
    thresholds,
  };
}

/**
 * Failure snapshot for a path whose filesystem could not be read.
 *
 * @param {string} targetPath
 * @param {{ warnPercent: number, criticalPercent: number }} thresholds
 * @param {unknown} error
 * @returns {object}
 */
function unreadable(targetPath, thresholds, error) {
  return {
    path: targetPath,
    status: STATUS_UNKNOWN,
    message: `could not read filesystem stats: ${error?.code || error?.message || 'unknown error'}`,
    thresholds,
  };
}

/**
 * Measure disk usage for the filesystem containing `targetPath`.
 *
 * Never throws on a measurable filesystem, and never throws on a broken one
 * either: a failure to stat the mount is reported as STATUS_UNKNOWN with the
 * reason attached, so a health check cannot be turned into a 500 by the very
 * condition it is supposed to report.
 *
 * @param {string} targetPath
 * @param {{ env?: Record<string, string|undefined> }} [options]
 * @returns {Promise<object>}
 */
export async function readDiskUsage(targetPath, options = {}) {
  const env = options.env ?? process.env;
  const thresholds = resolveThresholds(env);

  try {
    return summarize(await statfsAsync(targetPath), targetPath, thresholds);
  } catch (error) {
    return unreadable(targetPath, thresholds, error);
  }
}

/**
 * Synchronous counterpart used by the Prometheus gauge.
 *
 * `prom-client`'s `collect()` hook is synchronous, and every other gauge in
 * metricsService.js does its work inline there, so this variant keeps the disk
 * gauge consistent with that pattern instead of inventing a background poller.
 * The health endpoint uses the async version.
 *
 * @param {string} targetPath
 * @param {{ env?: Record<string, string|undefined> }} [options]
 * @returns {object}
 */
export function readDiskUsageSync(targetPath, options = {}) {
  const env = options.env ?? process.env;
  const thresholds = resolveThresholds(env);

  try {
    return summarize(statfsSync(targetPath), targetPath, thresholds);
  } catch (error) {
    return unreadable(targetPath, thresholds, error);
  }
}
