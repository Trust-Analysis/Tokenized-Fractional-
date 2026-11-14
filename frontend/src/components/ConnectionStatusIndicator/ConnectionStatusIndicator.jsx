import React, { memo } from 'react';
import styles from './ConnectionStatusIndicator.module.css';

/**
 * ConnectionStatusIndicator - Visual indicator for WebSocket connection status
 *
 * @param {string}  status          - Connection status: 'connected' | 'connecting' | 'disconnected' | 'error'
 * @param {boolean} showLabel       - Whether to show text label alongside indicator
 * @param {string}  className       - Additional CSS classes
 * @param {string}  ariaLabel       - Custom ARIA label for accessibility
 */
function ConnectionStatusIndicator({
  status = 'disconnected',
  showLabel = false,
  className = '',
  ariaLabel,
}) {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          color: 'var(--success-text)',
          bgColor: 'var(--success-bg)',
          borderColor: 'var(--success-border)',
          label: 'Connected',
          ariaLabel: ariaLabel || 'WebSocket connected',
        };
      case 'connecting':
        return {
          color: 'var(--warning-text)',
          bgColor: 'var(--warning-bg)',
          borderColor: 'var(--warning-border)',
          label: 'Connecting...',
          ariaLabel: ariaLabel || 'WebSocket connecting',
        };
      case 'error':
        return {
          color: 'var(--error-text)',
          bgColor: 'var(--error-bg)',
          borderColor: 'var(--error-border)',
          label: 'Connection Error',
          ariaLabel: ariaLabel || 'WebSocket connection error',
        };
      case 'disconnected':
      default:
        return {
          color: 'var(--text-secondary)',
          bgColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          label: 'Disconnected',
          ariaLabel: ariaLabel || 'WebSocket disconnected',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      className={`${styles.indicator} ${styles[status]} ${className}`}
      style={
        {
          '--status-color': config.color,
          '--status-bg': config.bgColor,
          '--status-border': config.borderColor,
        }
      }
      role="status"
      aria-live="polite"
      aria-label={config.ariaLabel}
      title={config.label}
    >
      <div className={styles.dot} aria-hidden="true">
        {status === 'connecting' && (
          <svg className={styles.spinner} viewBox="0 0 24 24" aria-hidden="true">
            <circle
              className={styles.spinnerCircle}
              cx="12"
              cy="12"
              r="10"
              fill="none"
              strokeWidth="2"
            />
          </svg>
        )}
        {status === 'error' && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2" strokeLinecap="round" />
            <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {status === 'connected' && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {status === 'disconnected' && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" strokeWidth="2" fill="none" />
          </svg>
        )}
      </div>
      {showLabel && <span className={styles.label}>{config.label}</span>}
    </div>
  );
}

export default memo(ConnectionStatusIndicator);
