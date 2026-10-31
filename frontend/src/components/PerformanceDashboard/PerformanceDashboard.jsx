// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * PerformanceDashboard
 *
 * Visualises real-time Core Web Vitals and custom application metrics.
 * Designed for developer/admin use: shows the live metric buffer collected
 * by performanceMonitoring.js and renders rating indicators and trend bars.
 *
 * This component is lazily imported so it never appears in the main bundle.
 *
 * @module PerformanceDashboard
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCollectedMetrics, PERFORMANCE_BUDGETS } from '../../services/performanceMonitoring';

// ─── Styles (inline — no extra CSS file to avoid blocking the Critical CSS pipeline) ──
const styles = {
  overlay: {
    position: 'fixed',
    bottom: '1rem',
    left: '1rem',
    zIndex: 9990,
    background: 'rgba(10, 14, 23, 0.95)',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    borderRadius: '0.75rem',
    padding: '1rem',
    width: '360px',
    maxHeight: '80vh',
    overflowY: 'auto',
    color: '#e0e6ef',
    fontSize: '0.8rem',
    fontFamily: 'ui-monospace, monospace',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem',
    borderBottom: '1px solid rgba(74,158,255,0.2)',
    paddingBottom: '0.5rem',
  },
  title: {
    color: '#4a9eff',
    fontWeight: 700,
    fontSize: '0.9rem',
    letterSpacing: '0.05em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8899aa',
    cursor: 'pointer',
    fontSize: '1.1rem',
    lineHeight: 1,
    padding: '0 0.25rem',
  },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.3rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  metricName: { fontWeight: 600, flex: '0 0 80px' },
  metricValue: { flex: '0 0 90px', textAlign: 'right' },
  bar: {
    height: '6px',
    borderRadius: '3px',
    flex: 1,
    margin: '0 0.5rem',
    background: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: '3px', transition: 'width 0.5s ease' },
  sectionTitle: {
    color: '#8899aa',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginTop: '0.75rem',
    marginBottom: '0.25rem',
  },
  badge: {
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '0.25rem',
    fontSize: '0.7rem',
    fontWeight: 700,
  },
  refreshBtn: {
    marginTop: '0.75rem',
    width: '100%',
    padding: '0.4rem',
    background: 'rgba(74,158,255,0.15)',
    border: '1px solid rgba(74,158,255,0.3)',
    borderRadius: '0.4rem',
    color: '#4a9eff',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
};

const RATING_COLORS = {
  good: '#00b894',
  'needs-improvement': '#fdcb6e',
  poor: '#e17055',
  unknown: '#8899aa',
};

/** Core Web Vitals to feature prominently in the dashboard */
const CORE_VITALS = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP'];

/**
 * Formats a metric value for display.
 *
 * @param {string} name - Metric name
 * @param {number} value - Raw value
 * @returns {string}
 */
function formatValue(name, value) {
  if (name === 'CLS') return value.toFixed(4);
  return `${Math.round(value)}ms`;
}

/**
 * Computes the fill width percentage for the rating bar.
 *
 * @param {string} name - Metric name
 * @param {number} value - Raw value
 * @returns {number} Percentage 0–100
 */
function barWidth(name, value) {
  const budget = PERFORMANCE_BUDGETS[name];
  if (!budget) return 0;
  const max = budget.needsImprovement * 2;
  return Math.min((value / max) * 100, 100);
}

/**
 * Returns the latest metric value for the named metric from the buffer.
 *
 * @param {Object[]} metrics - Flat array of all collected metrics
 * @param {string} name - Metric name
 * @returns {Object|null}
 */
function getLatest(metrics, name) {
  const filtered = metrics.filter((m) => m.name === name);
  if (!filtered.length) return null;
  return filtered.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PerformanceDashboard component.
 *
 * @param {Object} props
 * @param {Function} props.onClose - Callback to hide the dashboard
 */
export default function PerformanceDashboard({ onClose }) {
  const [metrics, setMetrics] = useState([]);
  const intervalRef = useRef(null);

  const refresh = useCallback(() => {
    setMetrics(getCollectedMetrics());
  }, []);

  // Poll the in-memory buffer every 2 seconds for live updates
  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 2000);
    return () => clearInterval(intervalRef.current);
  }, [refresh]);

  // ── Device / RUM context snapshot ────────────────────────────────────────
  const latestLcp = getLatest(metrics, 'LCP');
  const rumContext = latestLcp
    ? {
        deviceType: latestLcp.deviceType,
        connection: latestLcp.connectionType,
        viewport: latestLcp.viewport,
      }
    : null;

  return (
    <div style={styles.overlay} role="complementary" aria-label="Performance Dashboard">
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>⚡ Performance Dashboard</span>
        <button
          style={styles.closeBtn}
          onClick={onClose}
          aria-label="Close performance dashboard"
        >
          ✕
        </button>
      </div>

      {/* Core Web Vitals */}
      <div style={styles.sectionTitle}>Core Web Vitals</div>
      {CORE_VITALS.map((name) => {
        const entry = getLatest(metrics, name);
        if (!entry) {
          return (
            <div key={name} style={styles.metricRow}>
              <span style={styles.metricName}>{name}</span>
              <span style={{ color: '#8899aa', flex: 1 }}>—</span>
            </div>
          );
        }
        const color = RATING_COLORS[entry.rating] || RATING_COLORS.unknown;
        const width = barWidth(name, entry.rawValue ?? entry.value);
        return (
          <div key={name} style={styles.metricRow}>
            <span style={styles.metricName}>{name}</span>
            <div style={styles.bar}>
              <div style={{ ...styles.fill, width: `${width}%`, background: color }} />
            </div>
            <span style={{ ...styles.metricValue, color }}>
              {formatValue(name, entry.rawValue ?? entry.value)}
            </span>
            <span
              style={{
                ...styles.badge,
                background: `${color}22`,
                color,
                marginLeft: '0.25rem',
              }}
            >
              {entry.rating}
            </span>
          </div>
        );
      })}

      {/* JS / App Metrics */}
      <div style={styles.sectionTitle}>App Metrics</div>
      {(() => {
        const appMetrics = metrics
          .filter((m) => m.name === 'APP_METRIC' || m.name === 'JS_EXECUTION')
          .slice(-5) // show last 5
          .reverse();

        if (!appMetrics.length) {
          return <div style={{ color: '#8899aa', padding: '0.25rem 0' }}>No data yet</div>;
        }
        return appMetrics.map((m, i) => (
          <div key={i} style={styles.metricRow}>
            <span style={{ ...styles.metricName, flex: 1, fontSize: '0.7rem' }}>
              {m.label || m.name}
            </span>
            <span style={{ ...styles.metricValue, color: '#e0e6ef' }}>
              {Math.round(m.rawValue ?? m.value)}ms
            </span>
          </div>
        ));
      })()}

      {/* Long Tasks */}
      {(() => {
        const longTasks = metrics.filter((m) => m.name === 'LONG_TASK');
        if (!longTasks.length) return null;
        return (
          <>
            <div style={styles.sectionTitle}>Long Tasks ({longTasks.length})</div>
            {longTasks.slice(-3).map((t, i) => (
              <div key={i} style={styles.metricRow}>
                <span style={styles.metricName}>Task #{longTasks.length - i}</span>
                <span style={{ ...styles.metricValue, color: RATING_COLORS[t.rating] }}>
                  {Math.round(t.value)}ms
                </span>
              </div>
            ))}
          </>
        );
      })()}

      {/* RUM Context */}
      {rumContext && (
        <>
          <div style={styles.sectionTitle}>RUM Context</div>
          <div style={styles.metricRow}>
            <span style={styles.metricName}>Device</span>
            <span style={styles.metricValue}>{rumContext.deviceType}</span>
          </div>
          <div style={styles.metricRow}>
            <span style={styles.metricName}>Connection</span>
            <span style={styles.metricValue}>{rumContext.connection}</span>
          </div>
          <div style={styles.metricRow}>
            <span style={styles.metricName}>Viewport</span>
            <span style={styles.metricValue}>{rumContext.viewport}</span>
          </div>
        </>
      )}

      <button style={styles.refreshBtn} onClick={refresh}>
        ↻ Refresh
      </button>
    </div>
  );
}
