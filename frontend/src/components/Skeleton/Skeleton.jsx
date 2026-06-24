import React from 'react';
import styles from './Skeleton.module.css';

/**
 * Skeleton placeholder component for async content loading.
 *
 * @param {'text'|'rect'|'circle'} variant - Shape preset.
 * @param {string} width  - CSS width (default '100%').
 * @param {string} height - CSS height (default '1em' for text, '48px' for rect/circle).
 * @param {string} className - Additional class names.
 * @param {number} lines  - Render multiple stacked text lines (text variant only).
 */
export default function Skeleton({
  variant = 'rect',
  width,
  height,
  className = '',
  lines = 1,
  style = {},
  ...rest
}) {
  if (variant === 'text' && lines > 1) {
    return (
      <div className={`${styles.group} ${className}`} {...rest}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={`${styles.skeleton} ${styles.text}`}
            style={{
              width: i === lines - 1 ? '70%' : width || '100%',
              height: height || '1em',
              ...style,
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  const computedStyle = {
    width: width || (variant === 'circle' ? '48px' : '100%'),
    height: height || (variant === 'circle' ? '48px' : variant === 'text' ? '1em' : '1rem'),
    ...style,
  };

  return (
    <span
      className={`${styles.skeleton} ${styles[variant]} ${className}`}
      style={computedStyle}
      aria-hidden="true"
      {...rest}
    />
  );
}
