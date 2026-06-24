import React from 'react';
import styles from './Spinner.module.css';

/**
 * Standalone Spinner component for async operations.
 *
 * @param {'sm'|'md'|'lg'} size - Spinner size preset.
 * @param {string} label        - Accessible label (default 'Loading…').
 * @param {string} className    - Additional class names.
 */
export default function Spinner({
  size = 'md',
  label = 'Loading…',
  className = '',
  ...rest
}) {
  return (
    <span
      className={`${styles.spinner} ${styles[size]} ${className}`}
      role="status"
      aria-label={label}
      {...rest}
    >
      <span className={styles.srOnly}>{label}</span>
    </span>
  );
}
