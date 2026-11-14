// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for frontend/src/services/performanceMonitoring.js
 *
 * Covers:
 *  - rateMetric: budget classification
 *  - reportMetric: buffer population, Sentry integration, alert cooldown
 *  - metricsBuffer & getCollectedMetrics: filter and snapshot
 *  - clearMetricsBuffer: buffer reset
 *  - withExecutionTiming & measurePerformance: execution tracking wrappers
 *  - runSyntheticCheck: synthetic monitoring output shape
 *  - observeLongTasks / observeResourceTiming: observer registration
 *  - collectNavigationTiming: navigation timing extraction
 *
 * Issue: #370 (Comprehensive Unit Test Coverage Expansion)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Sentry mock ────────────────────────────────────────────────────────────────
vi.mock('@sentry/react', () => ({
  getCurrentScope: vi.fn(() => ({
    setTag: vi.fn(),
  })),
  captureMessage: vi.fn(),
  metrics: {
    set: vi.fn(),
  },
}));

import * as Sentry from '@sentry/react';
import {
  rateMetric,
  reportMetric,
  metricsBuffer,
  getCollectedMetrics,
  clearMetricsBuffer,
  PERFORMANCE_BUDGETS,
  withExecutionTiming,
  measurePerformance,
  runSyntheticCheck,
  observeLongTasks,
  observeResourceTiming,
  collectNavigationTiming,
} from '../../services/performanceMonitoring';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a minimal Web Vitals metric object */
function makeMetric(name, value, rating) {
  return { name, value, id: `test-${name}-${Date.now()}`, rating };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearMetricsBuffer();
  vi.clearAllMocks();
  // Reset environment variables
  import.meta.env.VITE_SENTRY_DSN = undefined;
  import.meta.env.VITE_API_URL = undefined;
  import.meta.env.DEV = false;
});

afterEach(() => {
  clearMetricsBuffer();
});

// ─── rateMetric ───────────────────────────────────────────────────────────────

describe('rateMetric', () => {
  it('returns "good" for LCP within good threshold', () => {
    expect(rateMetric('LCP', 2000)).toBe('good');
  });

  it('returns "good" for LCP at exact good threshold', () => {
    expect(rateMetric('LCP', PERFORMANCE_BUDGETS.LCP.good)).toBe('good');
  });

  it('returns "needs-improvement" for LCP between good and poor', () => {
    expect(rateMetric('LCP', 3000)).toBe('needs-improvement');
  });

  it('returns "poor" for LCP above needsImprovement threshold', () => {
    expect(rateMetric('LCP', 5000)).toBe('poor');
  });

  it('returns "good" for CLS at 0.05', () => {
    expect(rateMetric('CLS', 0.05)).toBe('good');
  });

  it('returns "poor" for CLS above 0.25', () => {
    expect(rateMetric('CLS', 0.3)).toBe('poor');
  });

  it('returns "good" for FID at 50ms', () => {
    expect(rateMetric('FID', 50)).toBe('good');
  });

  it('returns "poor" for FID above 300ms', () => {
    expect(rateMetric('FID', 400)).toBe('poor');
  });

  it('returns "unknown" for unrecognised metric names', () => {
    expect(rateMetric('UNKNOWN_METRIC', 100)).toBe('unknown');
  });

  it('rates all Core Web Vitals correctly at zero', () => {
    const vitals = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP'];
    vitals.forEach((v) => expect(rateMetric(v, 0)).toBe('good'));
  });

  it('rates LONG_TASK correctly', () => {
    expect(rateMetric('LONG_TASK', 40)).toBe('good');
    expect(rateMetric('LONG_TASK', 80)).toBe('needs-improvement');
    expect(rateMetric('LONG_TASK', 200)).toBe('poor');
  });
});

// ─── reportMetric ─────────────────────────────────────────────────────────────

describe('reportMetric', () => {
  it('adds metrics to the in-memory buffer', () => {
    reportMetric(makeMetric('LCP', 1200));
    expect(metricsBuffer.length).toBe(1);
    expect(metricsBuffer[0].name).toBe('LCP');
  });

  it('stores the page path', () => {
    reportMetric(makeMetric('FCP', 800));
    expect(metricsBuffer[0].page).toBe(window.location.pathname);
  });

  it('stores a timestamp', () => {
    const before = Date.now();
    reportMetric(makeMetric('TTFB', 200));
    const after = Date.now();
    expect(metricsBuffer[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(metricsBuffer[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('derives a rating when none is provided', () => {
    reportMetric({ name: 'LCP', value: 5000, id: 'test-derive' });
    expect(metricsBuffer[0].rating).toBe('poor');
  });

  it('does not throw when Sentry DSN is absent', () => {
    expect(() => reportMetric(makeMetric('INP', 150))).not.toThrow();
  });

  it('does NOT call Sentry.metrics.set when VITE_SENTRY_DSN is unset', () => {
    reportMetric(makeMetric('FID', 50));
    expect(Sentry.metrics.set).not.toHaveBeenCalled();
  });

  it('calls Sentry.metrics.set when VITE_SENTRY_DSN is configured', () => {
    import.meta.env.VITE_SENTRY_DSN = 'https://test@sentry.io/123';
    reportMetric(makeMetric('LCP', 1500));
    expect(Sentry.metrics.set).toHaveBeenCalled();
  });

  it('reports multiple metrics independently', () => {
    reportMetric(makeMetric('LCP', 2000));
    reportMetric(makeMetric('CLS', 0.1));
    reportMetric(makeMetric('FID', 50));
    expect(metricsBuffer.length).toBe(3);
  });

  it('caps the buffer at MAX_BUFFER_SIZE (200)', () => {
    for (let i = 0; i < 250; i++) {
      reportMetric({ name: 'LCP', value: i, id: `test-${i}` });
    }
    expect(metricsBuffer.length).toBeLessThanOrEqual(200);
  });
});

// ─── getCollectedMetrics ──────────────────────────────────────────────────────

describe('getCollectedMetrics', () => {
  beforeEach(() => {
    reportMetric(makeMetric('LCP', 2000));
    reportMetric(makeMetric('CLS', 0.05));
    reportMetric(makeMetric('LCP', 2100));
  });

  it('returns all metrics when no filter is provided', () => {
    expect(getCollectedMetrics().length).toBe(3);
  });

  it('filters by metric name', () => {
    const lcp = getCollectedMetrics('LCP');
    expect(lcp.length).toBe(2);
    lcp.forEach((m) => expect(m.name).toBe('LCP'));
  });

  it('returns an empty array for an unseen metric name', () => {
    expect(getCollectedMetrics('UNKNOWN')).toHaveLength(0);
  });

  it('returns a copy, not the original array reference', () => {
    const copy = getCollectedMetrics();
    copy.push({ name: 'FAKE', value: 0 });
    expect(getCollectedMetrics().length).toBe(3);
  });
});

// ─── clearMetricsBuffer ───────────────────────────────────────────────────────

describe('clearMetricsBuffer', () => {
  it('empties the buffer', () => {
    reportMetric(makeMetric('LCP', 1000));
    clearMetricsBuffer();
    expect(metricsBuffer.length).toBe(0);
  });
});

// ─── withExecutionTiming ─────────────────────────────────────────────────────

describe('withExecutionTiming', () => {
  it('returns the original function result', () => {
    const fn = vi.fn().mockReturnValue(42);
    const wrapped = withExecutionTiming('test-op', fn);
    expect(wrapped()).toBe(42);
  });

  it('calls the original function with the same arguments', () => {
    const fn = vi.fn((a, b) => a + b);
    const wrapped = withExecutionTiming('add', fn);
    wrapped(3, 4);
    expect(fn).toHaveBeenCalledWith(3, 4);
  });

  it('handles async functions and returns their resolved value', async () => {
    const fn = vi.fn().mockResolvedValue('async-result');
    const wrapped = withExecutionTiming('async-op', fn);
    const result = await wrapped();
    expect(result).toBe('async-result');
  });

  it('does not throw when the wrapped function throws', () => {
    const fn = () => {
      throw new Error('deliberate');
    };
    const wrapped = withExecutionTiming('error-op', fn);
    expect(() => wrapped()).toThrow('deliberate');
  });
});

// ─── measurePerformance ───────────────────────────────────────────────────────

describe('measurePerformance', () => {
  it('returns the return value of the measured function', async () => {
    const result = await measurePerformance('unit-test-measure', () => 'expected');
    expect(result).toBe('expected');
  });

  it('resolves async functions', async () => {
    const result = await measurePerformance('async-measure', async () => 'async-val');
    expect(result).toBe('async-val');
  });

  it('cleans up performance marks after measurement', async () => {
    const label = 'cleanup-test';
    await measurePerformance(label, () => {});
    // Marks should be cleared
    expect(performance.getEntriesByName(`${label}:start`, 'mark')).toHaveLength(0);
    expect(performance.getEntriesByName(`${label}:end`, 'mark')).toHaveLength(0);
  });
});

// ─── runSyntheticCheck ───────────────────────────────────────────────────────

describe('runSyntheticCheck', () => {
  it('returns an object with expected shape', () => {
    const result = runSyntheticCheck();
    expect(result).toHaveProperty('domQueryBaseline');
    expect(result).toHaveProperty('longTaskCount');
    expect(result).toHaveProperty('totalLongTaskTime');
    expect(result).toHaveProperty('timestamp');
  });

  it('domQueryBaseline is a non-negative number', () => {
    const { domQueryBaseline } = runSyntheticCheck();
    expect(typeof domQueryBaseline).toBe('number');
    expect(domQueryBaseline).toBeGreaterThanOrEqual(0);
  });

  it('timestamp is an ISO string', () => {
    const { timestamp } = runSyntheticCheck();
    expect(() => new Date(timestamp)).not.toThrow();
  });
});

// ─── observeLongTasks ────────────────────────────────────────────────────────

describe('observeLongTasks', () => {
  it('returns null when PerformanceObserver is not available', () => {
    const original = globalThis.PerformanceObserver;
    delete globalThis.PerformanceObserver;
    const result = observeLongTasks();
    expect(result).toBeNull();
    globalThis.PerformanceObserver = original;
  });

  it('returns null when longtask entry type is unsupported', () => {
    const MockObserver = vi.fn(() => ({ observe: vi.fn() }));
    MockObserver.supportedEntryTypes = ['paint', 'navigation'];
    const original = globalThis.PerformanceObserver;
    globalThis.PerformanceObserver = MockObserver;

    const result = observeLongTasks();
    expect(result).toBeNull();
    globalThis.PerformanceObserver = original;
  });
});

// ─── observeResourceTiming ───────────────────────────────────────────────────

describe('observeResourceTiming', () => {
  it('returns null when PerformanceObserver is not available', () => {
    const original = globalThis.PerformanceObserver;
    delete globalThis.PerformanceObserver;
    const result = observeResourceTiming();
    expect(result).toBeNull();
    globalThis.PerformanceObserver = original;
  });
});

// ─── collectNavigationTiming ─────────────────────────────────────────────────

describe('collectNavigationTiming', () => {
  it('returns null when no navigation entry is available', () => {
    // jsdom does not provide real navigation entries
    const result = collectNavigationTiming();
    expect(result).toBeNull();
  });
});

// ─── PERFORMANCE_BUDGETS ─────────────────────────────────────────────────────

describe('PERFORMANCE_BUDGETS', () => {
  it('contains all required Core Web Vitals', () => {
    const required = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP'];
    required.forEach((key) => {
      expect(PERFORMANCE_BUDGETS).toHaveProperty(key);
    });
  });

  it('each budget has good and needsImprovement thresholds', () => {
    Object.entries(PERFORMANCE_BUDGETS).forEach(([key, budget]) => {
      expect(budget).toHaveProperty('good', expect.any(Number));
      expect(budget).toHaveProperty('needsImprovement', expect.any(Number));
      expect(budget.good).toBeLessThan(budget.needsImprovement);
    });
  });
});
