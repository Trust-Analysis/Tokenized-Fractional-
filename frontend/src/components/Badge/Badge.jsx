import React from 'react';
import styles from './Badge.module.css';

export default function Badge({ children, variant = 'success', className = '', ...rest }) {
  const badgeClass = `${styles.badge} ${styles[variant]} ${className}`;

  return (
    <span className={badgeClass} {...rest}>
      {children}
    </span>
  );
}
