import React from 'react';
import styles from './Card.module.css';

export default function Card({ children, className = '', hoverable = false, ...rest }) {
  const cardClass = `${styles.card} ${hoverable ? styles.hoverable : ''} ${className}`;

  return (
    <div className={cardClass} {...rest}>
      {children}
    </div>
  );
}
