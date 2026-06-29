import React from 'react';
import styles from './Button.module.css';

export default function Button({
  children,
  variant = 'primary',
  disabled = false,
  loading = false,
  onClick,
  className = '',
  type = 'button',
  size,
  ...rest
}) {
  const buttonClass = `${styles.button} ${styles[variant]} ${size ? styles[size] : ''} ${className}`;

  return (
    <button
      type={type}
      className={buttonClass}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}
