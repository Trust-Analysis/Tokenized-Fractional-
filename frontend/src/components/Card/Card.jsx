import React, { memo } from 'react';
import styles from './Card.module.css';

function Card({ children, className = '', hoverable = false, ...rest }) {
  const cardClass = `${styles.card} ${hoverable ? styles.hoverable : ''} ${className}`;

  return (
    <div className={cardClass} {...rest}>
      {children}
    </div>
  );
}

export default memo(Card);
