import React from 'react';
import { useRpcRetry } from '../../hooks/useRpcRetry';

/**
 * Distinct network-outage and contract-error banner with a manual retry
 * (Issue #790).
 */
export default function RpcResilienceBanner() {
  const { rpcError, isRpcRetrying, retryRpc } = useRpcRetry();

  return (
    <>
      {rpcError && (
        <div
          className="rpc-error-banner"
          role="alert"
          style={{
            margin: '16px auto',
            padding: '14px 18px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            maxWidth: '600px',
            textAlign: 'left',
          }}
        >
          <h4
            style={{
              margin: '0 0 6px 0',
              color: '#991b1b',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            ⚠️{' '}
            {rpcError.startsWith('NETWORK_OUTAGE')
              ? 'RPC Connectivity Issue'
              : 'Smart Contract Exception'}
          </h4>
          <p style={{ margin: 0, color: '#7f1d1d', fontSize: '13px' }}>
            {rpcError.replace('NETWORK_OUTAGE: ', '').replace('CONTRACT_ERROR: ', '')}
          </p>
          <button
            type="button"
            onClick={retryRpc}
            style={{
              marginTop: '10px',
              padding: '6px 12px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
            }}
          >
            🔄 Retry Network Call
          </button>
        </div>
      )}
      {isRpcRetrying && (
        <div
          className="rpc-retrying-indicator"
          style={{ margin: '10px auto', color: '#d97706', fontSize: '13px', fontWeight: '600' }}
        >
          ⏳ Retrying connection to Soroban RPC endpoint (exponential backoff)...
        </div>
      )}
    </>
  );
}
