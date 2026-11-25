import React from 'react';

export default function MockModeBanner() {
  if (import.meta.env.VITE_MOCK_WALLET !== 'true') return null;

  return (
    <div
      role="alert"
      data-testid="mock-mode-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        padding: '0.6rem 1rem',
        textAlign: 'center',
        background: '#f5c518',
        color: '#111',
        borderBottom: '3px solid #7a5c00',
        fontFamily: 'monospace',
        fontSize: '1rem',
        fontWeight: 800,
        letterSpacing: '0.08em',
      }}
    >
      MOCK MODE — wallet and transactions are simulated. No assets are purchased and nothing is written to the chain.
    </div>
  );
}
