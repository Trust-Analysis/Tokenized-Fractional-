import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './styles/theme.css';
import App from './App';

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
    <Sentry.ErrorBoundary
      fallback={({ error, componentStack, resetError }) => (
        <div style={{
          maxWidth: 500,
          margin: '80px auto',
          padding: 32,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#f8fafc',
          background: '#121824',
          borderRadius: 10,
        }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 24px' }}>
            An unexpected error occurred. The error has been reported to our team.
          </p>
          <button
            onClick={resetError}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
