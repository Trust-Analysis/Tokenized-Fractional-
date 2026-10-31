import React, { memo } from 'react';
import styles from './Badge.module.css';

function Badge({ children, variant = 'success', className = '', ...rest }) {
  const badgeClass = `${styles.badge} ${styles[variant]} ${className}`;

  return (
    <span className={badgeClass} {...rest}>
      {children}
    </span>
  );
}

export default memo(Badge);
