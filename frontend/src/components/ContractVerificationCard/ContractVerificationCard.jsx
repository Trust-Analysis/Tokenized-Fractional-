import React, { useState } from 'react';
import { ACTIVE_CONTRACT_ID } from '../../constants/app';

/**
 * Official contract address, copy button, and link to the canonical
 * deployment registry (Issue #787).
 */
export default function ContractVerificationCard() {
  const [copiedContractId, setCopiedContractId] = useState('');

  const handleCopyContractId = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedContractId(id);
      window.setTimeout(() => setCopiedContractId(''), 2500);
    } catch {
      // Clipboard access can be denied; leave the button showing the address.
    }
  };

  return (
    <div
      className="contract-verification-card"
      style={{
        margin: '20px auto',
        padding: '16px 20px',
        background: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        maxWidth: '600px',
        textAlign: 'left',
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', color: '#1e293b', fontSize: '15px' }}>
        🛡️ Official Contract Verification
      </h4>
      <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#475569' }}>
        Active Contract ID:{' '}
        <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
          {ACTIVE_CONTRACT_ID}
        </code>
      </p>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => handleCopyContractId(ACTIVE_CONTRACT_ID)}
          style={{
            padding: '6px 12px',
            background: '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
          }}
        >
          {copiedContractId === ACTIVE_CONTRACT_ID
            ? '✅ Copied to Clipboard!'
            : '📋 Copy Contract Address'}
        </button>
        <a
          href="https://github.com/Code-Paragon/Tokenized-Fractional-/blob/main/docs/official-deployments.md"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '13px', color: '#2563eb', textDecoration: 'underline' }}
        >
          Verify against Official Registry ↗
        </a>
      </div>
    </div>
  );
}
