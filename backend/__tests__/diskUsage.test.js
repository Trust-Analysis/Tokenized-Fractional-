// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for issue #801 — disk-usage monitoring and alerting.
 *
 * Covers the shared probe (src/utils/diskUsage.js) and the cron-facing CLI
 * (scripts/check-disk-usage.js). The exit codes are the actual alerting
 * contract, so they are asserted directly rather than inferred.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_CRITICAL_PERCENT,
  DEFAULT_WARN_PERCENT,
  STATUS_CRITICAL,
  STATUS_OK,
  STATUS_UNKNOWN,
  STATUS_WARN,
  classifyUsage,
  formatBytes,
  parsePercent,
  readDiskUsage,
  readDiskUsageSync,
  resolveDataDirectory,
  resolveThresholds,
} from '../src/utils/diskUsage.js';
import { EXIT_CODES, main, parseArgs, resolveTargetPath } from '../scripts/check-disk-usage.js';

describe('parsePercent', () => {
  test('accepts an integer percentage', () => {
    expect(parsePercent('75')).toBe(75);
  });

  test('accepts a fractional percentage', () => {
    expect(parsePercent('82.5')).toBe(82.5);
  });

  test.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['zero', '0'],
    ['negative', '-5'],
    ['above 100', '101'],
    ['not a number', 'eighty'],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s so a typo cannot silently disable alerting', (_label, raw) => {
    expect(parsePercent(raw)).toBeUndefined();
  });
});

describe('resolveThresholds', () => {
  test('falls back to the documented defaults when nothing is configured', () => {
    expect(resolveThresholds({})).toEqual({
      warnPercent: DEFAULT_WARN_PERCENT,
      criticalPercent: DEFAULT_CRITICAL_PERCENT,
    });
  });

  test('honours configured thresholds', () => {
    expect(
      resolveThresholds({
        DISK_USAGE_WARN_PERCENT: '70',
        DISK_USAGE_CRITICAL_PERCENT: '85',
      }),
    ).toEqual({ warnPercent: 70, criticalPercent: 85 });
  });

  test('ignores an unparseable value and keeps the default for that bound only', () => {
    expect(resolveThresholds({ DISK_USAGE_WARN_PERCENT: 'oops' })).toEqual({
      warnPercent: DEFAULT_WARN_PERCENT,
      criticalPercent: DEFAULT_CRITICAL_PERCENT,
    });
  });

  test('rejects a critical threshold that is not above the warn threshold', () => {
    // Otherwise the warn band would be empty and nothing would ever report warn.
    expect(
      resolveThresholds({
        DISK_USAGE_WARN_PERCENT: '90',
        DISK_USAGE_CRITICAL_PERCENT: '80',
      }),
    ).toEqual({ warnPercent: DEFAULT_WARN_PERCENT, criticalPercent: DEFAULT_CRITICAL_PERCENT });
  });

  test('treats equal warn and critical thresholds as misconfiguration', () => {
    expect(
      resolveThresholds({
        DISK_USAGE_WARN_PERCENT: '80',
        DISK_USAGE_CRITICAL_PERCENT: '80',
      }),
    ).toEqual({ warnPercent: DEFAULT_WARN_PERCENT, criticalPercent: DEFAULT_CRITICAL_PERCENT });
  });
});

describe('classifyUsage', () => {
  const thresholds = { warnPercent: 80, criticalPercent: 90 };

  test('reports ok below the warn threshold', () => {
    expect(classifyUsage(0, thresholds)).toBe(STATUS_OK);
    expect(classifyUsage(79.99, thresholds)).toBe(STATUS_OK);
  });

  test('reports warn at and above the warn threshold', () => {
    expect(classifyUsage(80, thresholds)).toBe(STATUS_WARN);
    expect(classifyUsage(89.99, thresholds)).toBe(STATUS_WARN);
  });

  test('reports critical at and above the critical threshold', () => {
    expect(classifyUsage(90, thresholds)).toBe(STATUS_CRITICAL);
    expect(classifyUsage(100, thresholds)).toBe(STATUS_CRITICAL);
  });

  test('reports unknown rather than ok for a non-finite value', () => {
    expect(classifyUsage(Number.NaN, thresholds)).toBe(STATUS_UNKNOWN);
  });
});

describe('formatBytes', () => {
  test('formats each unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MiB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
  });

  test('does not pretend to know a value it does not have', () => {
    expect(formatBytes(Number.NaN)).toBe('unknown');
    expect(formatBytes(-1)).toBe('unknown');
  });
});

describe('resolveDataDirectory', () => {
  test('resolves the directory holding the default DATA_FILE', () => {
    expect(resolveDataDirectory('/srv/backend', {})).toBe('/srv/backend');
  });

  test('follows a nested DATA_FILE into its directory', () => {
    expect(resolveDataDirectory('/srv/backend', { DATA_FILE: 'var/data.json' })).toBe(
      '/srv/backend/var',
    );
  });
});

describe('readDiskUsage', () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'disk-usage-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('measures a real filesystem and reports a coherent snapshot', async () => {
    const usage = await readDiskUsage(dir);

    expect(usage.status).not.toBe(STATUS_UNKNOWN);
    expect(usage.status).toBe(classifyUsage(usage.usedPercent, usage.thresholds));
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.usedBytes).toBeGreaterThanOrEqual(0);
    expect(usage.usedBytes + usage.freeBytes).toBe(usage.totalBytes);
    expect(usage.availableBytes).toBeLessThanOrEqual(usage.freeBytes);
    expect(typeof usage.total).toBe('string');
    expect(usage.path).toBe(dir);
  });

  test('keeps usedPercent within 0..100', async () => {
    const usage = await readDiskUsage(dir);
    expect(usage.usedPercent).toBeGreaterThanOrEqual(0);
    expect(usage.usedPercent).toBeLessThanOrEqual(100);
  });

  test('honours env thresholds when classifying', async () => {
    // A warn threshold of 0.5% is below any real filesystem's usage, so this
    // must never come back "ok".
    const usage = await readDiskUsage(dir, {
      env: { DISK_USAGE_WARN_PERCENT: '1', DISK_USAGE_CRITICAL_PERCENT: '99' },
    });
    expect([STATUS_WARN, STATUS_CRITICAL]).toContain(usage.status);
  });

  test('reports unknown instead of throwing for an unreadable path', async () => {
    const usage = await readDiskUsage('/definitely/not/a/real/path-801');
    expect(usage.status).toBe(STATUS_UNKNOWN);
    expect(usage.message).toMatch(/could not read filesystem stats/);
    expect(usage.thresholds).toEqual({
      warnPercent: DEFAULT_WARN_PERCENT,
      criticalPercent: DEFAULT_CRITICAL_PERCENT,
    });
  });

  test('the sync probe agrees with the async one', async () => {
    const [asyncUsage, syncUsage] = [await readDiskUsage(dir), readDiskUsageSync(dir)];
    expect(syncUsage.status).toBe(asyncUsage.status);
    expect(syncUsage.totalBytes).toBe(asyncUsage.totalBytes);
    expect(syncUsage.usedBytes).toBe(asyncUsage.usedBytes);
  });
});

describe('check-disk-usage CLI', () => {
  const collect = () => {
    const lines = { out: [], err: [] };
    return {
      lines,
      io: {
        stdout: (line) => lines.out.push(line),
        stderr: (line) => lines.err.push(line),
      },
    };
  };

  test('parseArgs reads every supported flag', () => {
    expect(parseArgs(['--json', '--path', '/tmp', '--warn', '70', '--critical', '85'])).toEqual({
      json: true,
      path: '/tmp',
      warn: '70',
      critical: '85',
    });
  });

  test('parseArgs rejects an unknown flag rather than silently ignoring it', () => {
    expect(() => parseArgs(['--pathh', '/tmp'])).toThrow(/unknown argument/);
  });

  test('parseArgs rejects a flag without a value', () => {
    expect(() => parseArgs(['--path'])).toThrow(/requires a value/);
    expect(() => parseArgs(['--warn', '--json'])).toThrow(/requires a value/);
  });

  test('resolveTargetPath prefers the flag, then DISK_USAGE_PATH, then DATA_FILE', () => {
    expect(resolveTargetPath({ path: '/tmp' }, {})).toBe('/tmp');
    expect(resolveTargetPath({}, { DISK_USAGE_PATH: '/var/data' })).toBe('/var/data');
    expect(resolveTargetPath({}, {})).toMatch(/backend$/);
  });

  test('exit codes encode severity', () => {
    expect(EXIT_CODES).toEqual({
      [STATUS_OK]: 0,
      [STATUS_WARN]: 1,
      [STATUS_CRITICAL]: 2,
      [STATUS_UNKNOWN]: 3,
    });
  });

  test('exits 3 when the filesystem cannot be measured', async () => {
    const { lines, io } = collect();
    const code = await main(['--path', '/definitely/not/a/real/path-801'], io);
    expect(code).toBe(3);
    expect(lines.err.join('\n')).toMatch(/UNKNOWN/);
  });

  test('exits 3 on an unknown argument and prints usage', async () => {
    const { lines, io } = collect();
    const code = await main(['--nope'], io);
    expect(code).toBe(3);
    expect(lines.err.join('\n')).toMatch(/unknown argument/);
    expect(lines.err.join('\n')).toMatch(/Usage: node scripts\/check-disk-usage\.js/);
  });

  test('--help exits 0 without measuring anything', async () => {
    const { lines, io } = collect();
    const code = await main(['--help'], io);
    expect(code).toBe(0);
    expect(lines.out.join('\n')).toMatch(
      /Exit codes: 0 ok, 1 warn, 2 critical, 3 could not measure\./,
    );
  });

  test('--json prints one parseable object carrying the same verdict as the probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-cli-'));
    try {
      const { lines, io } = collect();
      const code = await main(['--json', '--path', dir], { ...io, env: {} });

      const payload = JSON.parse(lines.out.join('\n'));
      expect(payload.path).toBe(dir);
      expect(code).toBe(EXIT_CODES[payload.status]);
      expect(payload.thresholds).toEqual({
        warnPercent: DEFAULT_WARN_PERCENT,
        criticalPercent: DEFAULT_CRITICAL_PERCENT,
      });
      expect(payload.totalBytes).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--warn/--critical flags override the environment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-cli-env-'));
    try {
      const { lines, io } = collect();
      // Env would classify as critical; the flags pull it back to ok.
      await main(['--json', '--path', dir, '--warn', '99', '--critical', '100'], {
        ...io,
        env: { DISK_USAGE_WARN_PERCENT: '1', DISK_USAGE_CRITICAL_PERCENT: '2' },
      });

      const payload = JSON.parse(lines.out.join('\n'));
      expect(payload.thresholds).toEqual({ warnPercent: 99, criticalPercent: 100 });
      expect(payload.status).toBe(STATUS_OK);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('alerts go to stderr and healthy output to stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-cli-stream-'));
    try {
      const healthy = collect();
      await main(['--path', dir, '--warn', '99', '--critical', '100'], { ...healthy.io, env: {} });
      expect(healthy.lines.out.join('\n')).toMatch(/disk usage OK/);
      expect(healthy.lines.err.join('\n')).toBe('');

      const alerted = collect();
      await main(['--path', dir, '--warn', '1', '--critical', '2'], { ...alerted.io, env: {} });
      expect(alerted.lines.out.join('\n')).toBe('');
      // WARN or CRITICAL depending on how full the runner's disk happens to be —
      // what matters is that it is not silent and not on stdout.
      expect(alerted.lines.err.join('\n')).toMatch(/disk usage (WARN|CRITICAL)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
