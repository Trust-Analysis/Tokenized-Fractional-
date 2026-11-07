import React, { memo } from 'react';
import styles from './PulsingDot.module.css';

/**
 * PulsingDot - Animated dot indicator for real-time updates
 *
 * @param {string}  color           - Dot color: 'success' | 'warning' | 'error' | 'info' | 'primary'
 * @param {string}  size            - Dot size: 'sm' | 'md' | 'lg'
 * @param {boolean} animated        - Whether to show pulsing animation
 * @param {string}  className       - Additional CSS classes
 * @param {string}  ariaLabel       - Custom ARIA label for accessibility
 * @param {string}  tooltip         - Tooltip text
 */
function PulsingDot({
  color = 'success',
  size = 'md',
  animated = true,
  className = '',
  ariaLabel,
  tooltip = 'Updating',
}) {
  const getColorConfig = () => {
    switch (color) {
      case 'success':
        return {
          color: 'var(--success-text)',
          ariaLabel: ariaLabel || 'Update successful',
        };
      case 'warning':
        return {
          color: 'var(--warning-text)',
          ariaLabel: ariaLabel || 'Update pending',
        };
      case 'error':
        return {
          color: 'var(--error-text)',
          ariaLabel: ariaLabel || 'Update error',
        };
      case 'info':
        return {
          color: 'var(--info-text)',
          ariaLabel: ariaLabel || 'Information update',
        };
      case 'primary':
      default:
        return {
          color: 'var(--primary-text)',
          ariaLabel: ariaLabel || 'Updating',
        };
    }
  };

  const getSizeConfig = () => {
    switch (size) {
      case 'sm':
        return '8px';
      case 'lg':
        return '16px';
      case 'md':
      default:
        return '12px';
    }
  };

  const colorConfig = getColorConfig();
  const sizeValue = getSizeConfig();

  return (
    <span
      className={`${styles.dot} ${styles[color]} ${styles[size]} ${animated ? styles.animated : ''} ${className}`}
      style={
        {
          '--dot-color': colorConfig.color,
          '--dot-size': sizeValue,
        }
      }
      role="status"
      aria-live="polite"
      aria-label={colorConfig.ariaLabel}
      title={tooltip}
      aria-hidden="false"
    >
      <span className={styles.innerDot} aria-hidden="true" />
      {animated && <span className={styles.ripple} aria-hidden="true" />}
    </span>
  );
}

export default memo(PulsingDot);
