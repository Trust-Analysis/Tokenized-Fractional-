// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import React from 'react';
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

// Global unhandled error handlers
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Global Error]', { message, source, lineno, colno, error });
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason);
});

// Initialize Sentry for error tracking and performance monitoring
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
    tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE
      ? parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={ErrorFallback}>
      <Sentry.ErrorBoundary fallback={ErrorFallback}>
        <BrowserRouter>
          <ThemeProvider>
            <OfflineIndicator />
            <SWUpdateBanner />
            <App />
          </ThemeProvider>
        </BrowserRouter>
      </Sentry.ErrorBoundary>
    </ErrorBoundary>
  </React.StrictMode>,
);

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
