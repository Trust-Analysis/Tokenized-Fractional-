import React from 'react';
import styles from './Input.module.css';

export default function Input({
  label,
  id,
  type = 'text',
  className = '',
  wrapperClassName = '',
  ...rest
}) {
  return (
    <div className={`${styles.inputWrapper} ${wrapperClassName}`}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      <input
        id={id}
        type={type}
        className={`${styles.input} ${className}`}
        {...rest}
      />
    </div>
  );
}
