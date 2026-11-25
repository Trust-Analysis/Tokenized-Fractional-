import React from 'react';

/**
 * Lightweight Freighter connection bar (Issue #785). It reflects the direct
 * extension session used by the certificate gallery.
 */
export default function WalletConnectionBar({
  walletAddress,
  isReconnecting,
  onConnect,
  onDisconnect,
}) {
  const shortAddress = walletAddress
    ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`
    : '';

  return (
    <div
      className="wallet-bar"
      style={{
        padding: '12px 20px',
        background: '#f3f4f6',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
        {isReconnecting
          ? '🔄 Reconnecting Wallet...'
          : walletAddress
            ? `Connected: ${shortAddress}`
            : 'Wallet Not Connected'}
      </span>
      {walletAddress ? (
        <button
          type="button"
          onClick={onDisconnect}
          style={{
            padding: '6px 12px',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          style={{
            padding: '6px 12px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Connect Freighter Wallet
        </button>
      )}
    </div>
  );
}
