import React from 'react';
import Skeleton from '../Skeleton/Skeleton';

/**
 * Placeholder shown while a lazily loaded route or feature chunk downloads.
 */
export default function LazyFallback() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        width: '100%',
      }}
    >
      <Skeleton
        variant="rect"
        height="200px"
        width="100%"
        style={{ borderRadius: 'var(--radius-sm)' }}
      />
    </div>
  );
}
