// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import React, { lazy, Suspense, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './styles/theme.css';
import './i18n';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import ErrorFallback from './components/ErrorFallback/ErrorFallback';
import { ThemeProvider } from './context/ThemeContext';
import OfflineIndicator from './components/OfflineIndicator/OfflineIndicator';
import { useServiceWorker } from './hooks/useServiceWorker';
import { initPerformanceMonitoring } from './services/performanceMonitoring';

// Lazily import the dashboard so it is never included in the main bundle
const PerformanceDashboard = lazy(
  () => import('./components/PerformanceDashboard/PerformanceDashboard'),
);

// Global unhandled error handlers
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Global Error]', { message, source, lineno, colno, error });
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason);
});

// ─── Sentry Initialisation ────────────────────────────────────────────────────
// Integrates with the existing Sentry setup and adds performance tracing.
// Web Vitals are reported as custom measurements on each transaction.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE || 'development',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Sample 10 % of transactions for performance tracing in production;
    // override via VITE_SENTRY_TRACES_SAMPLE_RATE env var.
    tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE
      ? parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Attach the current URL path as a transaction name for easier grouping
    beforeSend(event) {
      event.transaction = window.location.pathname;
      return event;
    },
  });
}

// ─── Performance Monitoring Initialisation (Issue #369) ──────────────────────
// Runs after the page loads to avoid blocking the critical render path.
// Registers Web Vitals observers, Long Task observer, and Resource Timing.
window.addEventListener('load', () => {
  initPerformanceMonitoring();
}, { once: true });

// ─── React Root ───────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={ErrorFallback}>
      <Sentry.ErrorBoundary fallback={ErrorFallback}>
        <BrowserRouter>
          <ThemeProvider>
            <OfflineIndicator />
            <SWUpdateBanner />
            <App />
            {/* Performance dashboard — dev/admin only, toggled by keyboard shortcut */}
            <PerfDashboardToggle />
          </ThemeProvider>
        </BrowserRouter>
      </Sentry.ErrorBoundary>
    </ErrorBoundary>
  </React.StrictMode>,
);

// ─── SW Update Banner ─────────────────────────────────────────────────────────
/**
 * SWUpdateBanner — shown when a new service worker is waiting to activate.
 * Prompts the user to reload so they get the latest version.
 */
function SWUpdateBanner() {
  const { needsUpdate, updateSW } = useServiceWorker();
  if (!needsUpdate) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 9998,
        background: 'var(--color-primary, #4a9eff)',
        color: '#fff',
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.875rem',
        maxWidth: '320px',
      }}
    >
      <span>A new version is available.</span>
      <button
        onClick={() => updateSW(true)}
        style={{
          background: 'rgba(255,255,255,0.25)',
          border: 'none',
          borderRadius: '0.25rem',
          color: '#fff',
          cursor: 'pointer',
          padding: '0.3rem 0.6rem',
          fontWeight: 600,
          fontSize: '0.8rem',
          whiteSpace: 'nowrap',
        }}
      >
        Reload
      </button>
    </div>
  );
}

// ─── Performance Dashboard Toggle (Issue #369 / #368) ────────────────────────
/**
 * PerfDashboardToggle
 *
 * Renders the floating performance dashboard overlay.
 * In development mode the dashboard starts visible; in production it is
 * toggled by pressing Shift+Alt+P so it never impacts end-user experience.
 *
 * The dashboard is code-split (lazy + Suspense) so it adds zero bytes to
 * the main bundle — aligning with the Critical CSS goal of keeping the
 * initial payload minimal (Issue #368).
 */
function PerfDashboardToggle() {
  const [visible, setVisible] = useState(
    // Auto-show in dev mode for immediate feedback
    import.meta.env.DEV && import.meta.env.VITE_PERF_DASHBOARD !== 'false',
  );

  // Keyboard shortcut: Shift+Alt+P
  React.useEffect(() => {
    const handler = (e) => {
      if (e.shiftKey && e.altKey && e.key === 'P') {
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!visible) return null;

  return (
    <Suspense fallback={null}>
      <PerformanceDashboard onClose={() => setVisible(false)} />
    </Suspense>
  );
}
