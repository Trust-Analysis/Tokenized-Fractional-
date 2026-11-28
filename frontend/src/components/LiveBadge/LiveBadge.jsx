import React, { memo } from 'react';
import styles from './LiveBadge.module.css';

/**
 * LiveBadge - Badge indicating real-time/live data
 *
 * @param {string}  variant         - Badge variant: 'price' | 'transaction' | 'status' | 'default'
 * @param {boolean} animated        - Whether to show pulsing animation
 * @param {string}  className       - Additional CSS classes
 * @param {string}  ariaLabel       - Custom ARIA label for accessibility
 * @param {string}  tooltip         - Tooltip text
 */
function LiveBadge({
  variant = 'default',
  animated = true,
  className = '',
  ariaLabel,
  tooltip = 'Live updates',
}) {
  const getVariantConfig = () => {
    switch (variant) {
      case 'price':
        return {
          color: 'var(--success-text)',
          bgColor: 'var(--success-bg)',
          borderColor: 'var(--success-border)',
          label: 'LIVE',
          ariaLabel: ariaLabel || 'Live price updates',
        };
      case 'transaction':
        return {
          color: 'var(--info-text)',
          bgColor: 'var(--info-bg)',
          borderColor: 'var(--info-border)',
          label: 'LIVE',
          ariaLabel: ariaLabel || 'Live transaction updates',
        };
      case 'status':
        return {
          color: 'var(--warning-text)',
          bgColor: 'var(--warning-bg)',
          borderColor: 'var(--warning-border)',
          label: 'LIVE',
          ariaLabel: ariaLabel || 'Live status updates',
        };
      case 'default':
      default:
        return {
          color: 'var(--primary-text)',
          bgColor: 'var(--primary-bg)',
          borderColor: 'var(--primary-border)',
          label: 'LIVE',
          ariaLabel: ariaLabel || 'Live updates',
        };
    }
  };

  const config = getVariantConfig();

  return (
    <span
      className={`${styles.badge} ${styles[variant]} ${animated ? styles.animated : ''} ${className}`}
      style={
        {
          '--badge-color': config.color,
          '--badge-bg': config.bgColor,
          '--badge-border': config.borderColor,
        }
      }
      role="status"
      aria-live="polite"
      aria-label={config.ariaLabel}
      title={tooltip}
    >
      {animated && <span className={styles.pulseDot} aria-hidden="true" />}
      <span className={styles.text}>{config.label}</span>
    </span>
  );
}

export default memo(LiveBadge);
