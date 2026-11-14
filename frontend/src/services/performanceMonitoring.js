// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Performance Monitoring Service
 *
 * Implements comprehensive performance monitoring using the Web Vitals API
 * (Issue #369). Tracks Core Web Vitals (LCP, FID, CLS, FCP, TTFB, INP),
 * integrates with Sentry for centralized reporting, and sends metrics to
 * the analytics backend for dashboard visualisation and RUM.
 *
 * @module performanceMonitoring
 */

import * as Sentry from '@sentry/react';

// ─── Performance Budgets (Issue #367 / CI enforcement) ───────────────────────
/**
 * Performance budgets define the maximum acceptable values for each metric.
 * These thresholds align with Google's "Good" Core Web Vitals targets.
 * CI will fail when any metric consistently exceeds its budget.
 */
export const PERFORMANCE_BUDGETS = {
  /** Largest Contentful Paint — measures loading performance (ms) */
  LCP: { good: 2500, needsImprovement: 4000 },
  /** First Input Delay — measures interactivity (ms) */
  FID: { good: 100, needsImprovement: 300 },
  /** Cumulative Layout Shift — measures visual stability (unitless score) */
  CLS: { good: 0.1, needsImprovement: 0.25 },
  /** First Contentful Paint — measures perceived load speed (ms) */
  FCP: { good: 1800, needsImprovement: 3000 },
  /** Time to First Byte — measures server responsiveness (ms) */
  TTFB: { good: 800, needsImprovement: 1800 },
  /** Interaction to Next Paint — measures overall responsiveness (ms) */
  INP: { good: 200, needsImprovement: 500 },
  /** Total JavaScript execution time budget (ms) — Issue #367 */
  JS_EXECUTION: { good: 50, needsImprovement: 150 },
  /** Long Task threshold (ms) — any task blocking the main thread */
  LONG_TASK: { good: 50, needsImprovement: 100 },
};

// ─── Metric Rating Helper ─────────────────────────────────────────────────────
/**
 * Determines a metric's rating against its performance budget.
 *
 * @param {string} metricName - Name of the metric (key of PERFORMANCE_BUDGETS)
 * @param {number} value - Measured value
 * @returns {'good'|'needs-improvement'|'poor'} Rating string
 */
export function rateMetric(metricName, value) {
  const budget = PERFORMANCE_BUDGETS[metricName];
  if (!budget) return 'unknown';
  if (value <= budget.good) return 'good';
  if (value <= budget.needsImprovement) return 'needs-improvement';
  return 'poor';
}

// ─── User Context Segmentation (RUM) ─────────────────────────────────────────
/**
 * Collects user context data for segmenting RUM metrics by device, connection,
 * and viewport. Used to identify performance patterns across different users.
 *
 * @returns {Object} User context metadata
 */
function getUserContext() {
  const nav = navigator;
  const connection =
    nav.connection || nav.mozConnection || nav.webkitConnection;

  return {
    deviceType: getDeviceType(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
    connectionType: connection?.effectiveType || 'unknown',
    downlink: connection?.downlink || null,
    rtt: connection?.rtt || null,
    hardwareConcurrency: nav.hardwareConcurrency || null,
    deviceMemory: nav.deviceMemory || null,
    language: nav.language || 'unknown',
    platform: nav.userAgentData?.platform || nav.platform || 'unknown',
  };
}

/**
 * Classifies the device type based on viewport width and user agent.
 *
 * @returns {'mobile'|'tablet'|'desktop'} Device type
 */
function getDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod/.test(ua)) return 'mobile';
  if (/ipad|tablet/.test(ua) || (window.innerWidth >= 768 && window.innerWidth < 1024))
    return 'tablet';
  return 'desktop';
}

// ─── Metric Reporter ──────────────────────────────────────────────────────────
/**
 * Central metric reporting function. Reports to:
 * 1. Sentry (if configured) as a custom measurement attached to a transaction
 * 2. The analytics backend (fire-and-forget)
 * 3. The browser console in development mode
 * 4. An in-memory buffer for the PerformanceDashboard component
 *
 * @param {Object} metric - Web Vitals metric object
 * @param {string} metric.name - Metric name (e.g. 'LCP')
 * @param {number} metric.value - Metric value
 * @param {string} metric.id - Unique metric instance ID
 * @param {string} [metric.rating] - 'good'|'needs-improvement'|'poor'
 * @param {string} [source='web-vitals'] - Where this metric originated
 */
export function reportMetric(metric, source = 'web-vitals') {
  const { name, value, id, rating } = metric;
  const context = getUserContext();
  const timestamp = Date.now();
  const derivedRating = rating || rateMetric(name, value);

  const payload = {
    name,
    value: Math.round(name === 'CLS' ? value * 1000 : value), // CLS as milli-units for int storage
    rawValue: value,
    id,
    rating: derivedRating,
    source,
    timestamp,
    page: window.location.pathname,
    ...context,
  };

  // 1. Sentry — attach to the active transaction / span
  try {
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.getCurrentScope().setTag(`web_vital.${name.toLowerCase()}`, derivedRating);
      Sentry.metrics.set(`web_vital.${name.toLowerCase()}`, value, {
        unit: name === 'CLS' ? 'none' : 'millisecond',
        tags: { rating: derivedRating, page: window.location.pathname },
      });
    }
  } catch {
    // Sentry may not be initialised in all environments — fail silently
  }

  // 2. Analytics backend (non-blocking)
  sendToAnalyticsBackend(payload);

  // 3. Development console
  if (import.meta.env.DEV) {
    const emoji = derivedRating === 'good' ? '✅' : derivedRating === 'needs-improvement' ? '⚠️' : '❌';
    console.group(`[Perf] ${emoji} ${name}`);
    console.log('Value:', name === 'CLS' ? value.toFixed(4) : `${Math.round(value)}ms`);
    console.log('Rating:', derivedRating);
    console.log('Context:', context);
    console.groupEnd();
  }

  // 4. In-memory store for the dashboard
  metricsBuffer.push(payload);
  if (metricsBuffer.length > MAX_BUFFER_SIZE) {
    metricsBuffer.shift(); // drop oldest entry
  }

  // 5. Alert if metric exceeds budget
  checkPerformanceAlert(name, value, derivedRating);
}

// ─── In-Memory Buffer ─────────────────────────────────────────────────────────
const MAX_BUFFER_SIZE = 200;

/** @type {Object[]} */
export const metricsBuffer = [];

/**
 * Returns a snapshot of collected metrics, optionally filtered by name.
 *
 * @param {string} [metricName] - Filter to a specific metric
 * @returns {Object[]} Array of metric payloads
 */
export function getCollectedMetrics(metricName) {
  if (!metricName) return [...metricsBuffer];
  return metricsBuffer.filter((m) => m.name === metricName);
}

/**
 * Clears the in-memory buffer. Useful in tests.
 */
export function clearMetricsBuffer() {
  metricsBuffer.length = 0;
}

// ─── Analytics Backend Reporter ──────────────────────────────────────────────
/**
 * Sends a metric payload to the backend analytics endpoint.
 * Uses `sendBeacon` when available (safe during page unload), falling back
 * to `fetch`. Failures are logged in development but never thrown.
 *
 * @param {Object} payload - Metric payload
 */
function sendToAnalyticsBackend(payload) {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) return;

  const endpoint = `${apiUrl}/api/analytics/web-vitals`;
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {
        // Network errors are non-fatal for analytics
      });
    }
  } catch {
    // Never let analytics errors surface to the user
  }
}

// ─── Performance Alerts ───────────────────────────────────────────────────────
const alertCooldownMs = 60_000; // 1 minute between repeated alerts for the same metric
const lastAlertTime = new Map();

/**
 * Emits an alert (Sentry event + console warning) when a metric is 'poor'.
 * Implements a cooldown to avoid alert storms on a single session.
 *
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 * @param {string} rating - Derived rating
 */
function checkPerformanceAlert(name, value, rating) {
  if (rating !== 'poor') return;

  const now = Date.now();
  const last = lastAlertTime.get(name) || 0;
  if (now - last < alertCooldownMs) return;

  lastAlertTime.set(name, now);

  const message = `Performance degradation detected: ${name} = ${
    name === 'CLS' ? value.toFixed(4) : `${Math.round(value)}ms`
  } (budget: ${PERFORMANCE_BUDGETS[name]?.needsImprovement}${name === 'CLS' ? '' : 'ms'})`;

  console.warn(`[Perf Alert] ${message}`);

  try {
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureMessage(message, {
        level: 'warning',
        tags: {
          'perf.metric': name,
          'perf.rating': rating,
          page: window.location.pathname,
        },
        extra: {
          value,
          budget: PERFORMANCE_BUDGETS[name],
          userContext: getUserContext(),
        },
      });
    }
  } catch {
    // Sentry not available — already logged to console
  }
}

// ─── Web Vitals Initialisation ────────────────────────────────────────────────
/**
 * Initialises Web Vitals collection by dynamically importing the `web-vitals`
 * package (code-split — not included in the main bundle) and registering
 * report callbacks for all Core Web Vitals plus supplemental metrics.
 *
 * Call this once from `main.jsx` after the app has mounted.
 *
 * @returns {Promise<void>}
 */
export async function initWebVitals() {
  try {
    const {
      onCLS,
      onFID,
      onFCP,
      onLCP,
      onTTFB,
      onINP,
    } = await import('web-vitals');

    // Report each metric as it becomes available.
    // Attribution variants provide detailed breakdown data — use them when
    // available to help diagnose the root cause of poor scores.
    onCLS(reportMetric);
    onFID(reportMetric);
    onFCP(reportMetric);
    onLCP(reportMetric);
    onTTFB(reportMetric);
    onINP(reportMetric);
  } catch (err) {
    // web-vitals is a devDependency in environments that pre-bundle differently;
    // fall back gracefully so the app never crashes due to analytics.
    console.warn('[Perf] web-vitals could not be loaded:', err.message);
  }
}

// ─── Long Tasks Observer (Issue #367) ────────────────────────────────────────
/**
 * Observes Long Tasks using the PerformanceObserver API.
 * Long Tasks are JS tasks that block the main thread for > 50 ms,
 * directly impacting FID and INP scores.
 *
 * @returns {PerformanceObserver|null} Observer instance, or null if unsupported
 */
export function observeLongTasks() {
  if (typeof PerformanceObserver === 'undefined') return null;
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return null;

  let observer;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        reportMetric(
          {
            name: 'LONG_TASK',
            value: entry.duration,
            id: `lt-${entry.startTime}`,
            rating: rateMetric('LONG_TASK', entry.duration),
          },
          'longtask-observer',
        );
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // Some browsers restrict longtask observation in certain contexts
  }
  return observer || null;
}

// ─── Resource Timing Observer ─────────────────────────────────────────────────
/**
 * Monitors resource load times to identify slow assets (large JS bundles,
 * unoptimised images, slow API calls). Feeds into the performance dashboard.
 *
 * @returns {PerformanceObserver|null}
 */
export function observeResourceTiming() {
  if (typeof PerformanceObserver === 'undefined') return null;

  let observer;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only report slow resources (> 500 ms) to avoid noise
        if (entry.duration < 500) continue;

        reportMetric(
          {
            name: 'RESOURCE',
            value: Math.round(entry.duration),
            id: `res-${entry.startTime}`,
            resourceName: entry.name,
            resourceType: entry.initiatorType,
            rating: entry.duration > 2000 ? 'poor' : 'needs-improvement',
          },
          'resource-timing',
        );
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    // Not supported
  }
  return observer || null;
}

// ─── Navigation Timing ───────────────────────────────────────────────────────
/**
 * Collects full page-load navigation timing data on DOMContentLoaded.
 * Provides a holistic view of the page load pipeline broken down into
 * DNS, TCP, request, response, and DOM phases.
 *
 * @returns {Object|null} Navigation timing data or null if unsupported
 */
export function collectNavigationTiming() {
  if (typeof PerformanceNavigationTiming === 'undefined') return null;

  const nav = performance.getEntriesByType('navigation')[0];
  if (!nav) return null;

  const timing = {
    dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
    tcp: Math.round(nav.connectEnd - nav.connectStart),
    ssl: nav.secureConnectionStart > 0
      ? Math.round(nav.connectEnd - nav.secureConnectionStart)
      : 0,
    ttfb: Math.round(nav.responseStart - nav.requestStart),
    download: Math.round(nav.responseEnd - nav.responseStart),
    domInteractive: Math.round(nav.domInteractive - nav.startTime),
    domComplete: Math.round(nav.domComplete - nav.startTime),
    loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
  };

  // Report TTFB from navigation timing as a supplemental metric
  reportMetric(
    { name: 'TTFB', value: timing.ttfb, id: 'nav-ttfb' },
    'navigation-timing',
  );

  metricsBuffer.push({ name: 'NAVIGATION', ...timing, timestamp: Date.now() });
  return timing;
}

// ─── JS Execution Time Tracker (Issue #367) ──────────────────────────────────
/**
 * Wraps a function and measures its execution time.
 * Reports the duration as a JS_EXECUTION metric if it exceeds 10 ms.
 *
 * @param {string} label - Human-readable label for the operation
 * @param {Function} fn - Function to profile
 * @returns {Function} Wrapped function with the same signature
 */
export function withExecutionTiming(label, fn) {
  return function trackedFn(...args) {
    const start = performance.now();
    const result = fn.apply(this, args);

    const report = (end) => {
      const duration = end - start;
      if (duration < 10) return; // ignore trivial operations
      reportMetric(
        {
          name: 'JS_EXECUTION',
          value: duration,
          id: `js-${label}-${start}`,
          label,
        },
        'execution-timing',
      );
    };

    // Handle async functions
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        report(performance.now());
        return value;
      });
    }

    report(performance.now());
    return result;
  };
}

/**
 * Measures a block of synchronous or asynchronous code using the
 * User Timing API (performance.measure) for DevTools integration.
 *
 * @param {string} label - Mark/measure name
 * @param {Function} fn - Code block to measure
 * @returns {*} Return value of fn
 */
export async function measurePerformance(label, fn) {
  const markStart = `${label}:start`;
  const markEnd = `${label}:end`;

  performance.mark(markStart);
  let result;
  try {
    result = await fn();
  } finally {
    performance.mark(markEnd);
    performance.measure(label, markStart, markEnd);

    const measure = performance.getEntriesByName(label, 'measure')[0];
    if (measure) {
      reportMetric(
        {
          name: 'JS_EXECUTION',
          value: measure.duration,
          id: `measure-${label}-${Date.now()}`,
          label,
        },
        'user-timing',
      );
      // Clean up marks to prevent memory accumulation
      performance.clearMarks(markStart);
      performance.clearMarks(markEnd);
      performance.clearMeasures(label);
    }
  }
  return result;
}

// ─── Synthetic Monitoring Utilities ──────────────────────────────────────────
/**
 * Runs a lightweight synthetic performance check and returns a summary.
 * Intended for use in CI health-checks and automated monitoring scripts
 * that cannot rely on real user sessions.
 *
 * Reports:
 * - Time to execute a trivial DOM query (baseline JS execution speed)
 * - Number of long tasks observed since page load (via PerformanceObserver)
 *
 * @returns {Object} Synthetic check results
 */
export function runSyntheticCheck() {
  const results = {};

  // Baseline DOM query speed
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    document.querySelectorAll('[data-testid]');
  }
  results.domQueryBaseline = Math.round(performance.now() - start);

  // Snapshot buffered long tasks
  try {
    const longTasks = performance.getEntriesByType('longtask');
    results.longTaskCount = longTasks.length;
    results.totalLongTaskTime = Math.round(
      longTasks.reduce((sum, e) => sum + e.duration, 0),
    );
  } catch {
    results.longTaskCount = 0;
    results.totalLongTaskTime = 0;
  }

  results.timestamp = new Date().toISOString();
  return results;
}

// ─── Initialise All Observers ─────────────────────────────────────────────────
/**
 * Convenience function that initialises all performance observers at once.
 * Call once from `main.jsx` after the React root has been rendered.
 *
 * @returns {Promise<void>}
 */
export async function initPerformanceMonitoring() {
  await initWebVitals();
  observeLongTasks();
  observeResourceTiming();

  // Collect navigation timing after the load event so all values are populated
  if (document.readyState === 'complete') {
    collectNavigationTiming();
  } else {
    window.addEventListener('load', collectNavigationTiming, { once: true });
  }
}
