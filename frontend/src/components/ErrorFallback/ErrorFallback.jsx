import React from 'react';
import styles from './ErrorFallback.module.css';
import { UNEXPECTED_ERROR, ERROR_REPORTED, TRY_AGAIN } from '../../constants/errors';

/**
 * ErrorFallback — displays a user-friendly error message with recovery options.
 *
 * Props:
 *   - error: the Error object
 *   - errorInfo: error info from getDerivedStateFromError
 *   - componentStack: component stack trace
 *   - errorId: unique error identifier (for support reference)
 *   - timestamp: when the error occurred
 *   - severity: error severity ('error', 'warning', 'critical')
 *   - routeName: name of the route where error occurred
 *   - resetError: callback to reset error and retry
 */
export default function ErrorFallback({
  error,
  errorInfo,
  componentStack,
  errorId,
  timestamp,
  severity = 'error',
  routeName = 'this page',
  resetError,
}) {
  const isDev = import.meta.env.DEV;

  // Determine icon and styling based on severity
  const severityConfig = {
    critical: { icon: '⚠️', title: 'Critical Error', color: 'var(--color-danger, #d32f2f)' },
    error: { icon: '❌', title: 'Something Went Wrong', color: 'var(--color-danger, #d32f2f)' },
    warning: { icon: '⚡', title: 'Temporary Issue', color: 'var(--color-warning, #f57c00)' },
  };

  const config = severityConfig[severity] || severityConfig.error;

  // Extract user-friendly error message
  const errorMessage = error?.message || 'An unexpected error occurred';
  const isNetworkError = errorMessage.includes('Network') || errorMessage.includes('timeout');
  const isContractError = errorMessage.includes('contract') || errorMessage.includes('transaction');

  let helpText = ERROR_REPORTED;
  if (isNetworkError) {
    helpText = 'Network error detected. Check your connection and try again.';
  } else if (isContractError) {
    helpText = 'There was an issue with the blockchain interaction. Try again or contact support.';
  } else if (severity === 'warning') {
    helpText = 'A temporary issue occurred. This usually resolves on its own.';
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className={styles.title}>{UNEXPECTED_ERROR}</h2>
        <p className={styles.subtitle}>{ERROR_REPORTED}</p>
        <button onClick={resetError} className={styles.button}>
          {TRY_AGAIN}
        </button>
      </div>
    </div>
  );
}
