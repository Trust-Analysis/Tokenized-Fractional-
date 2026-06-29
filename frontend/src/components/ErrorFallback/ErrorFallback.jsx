import React from 'react';
import styles from './ErrorFallback.module.css';
import { UNEXPECTED_ERROR, ERROR_REPORTED, TRY_AGAIN } from '../../constants/errors';

export default function ErrorFallback({ error, componentStack, resetError }) {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h2 className={styles.title}>{UNEXPECTED_ERROR}</h2>
        <p className={styles.subtitle}>
          {ERROR_REPORTED}
        </p>
        <button onClick={resetError} className={styles.button}>
          {TRY_AGAIN}
        </button>
      </div>
    </div>
  );
}
