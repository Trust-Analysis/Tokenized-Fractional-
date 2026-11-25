import React from 'react';
import { useNftCertificates } from '../../hooks/useNftCertificates';

/**
 * "My NFT Share Certificates" gallery (Issue #788). Shows a wallet prompt when
 * disconnected and the owned certificates when connected.
 */
export default function CertificateGallery({ walletAddress }) {
  const { certificates, loading, error, refetch } = useNftCertificates(walletAddress);

  return (
    <div
      className="nft-certificates-gallery"
      style={{
        margin: '30px auto',
        padding: '24px',
        background: '#ffffff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        maxWidth: '900px',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '20px' }}>
          🎨 My NFT Share Certificates
        </h3>
        <button
          type="button"
          onClick={refetch}
          disabled={loading || !walletAddress}
          style={{
            padding: '6px 14px',
            background: '#f1f5f9',
            color: '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          {loading ? '🔄 Refreshing...' : '🔄 Refresh Gallery'}
        </button>
      </div>

      {!walletAddress ? (
        <div
          style={{
            padding: '20px',
            background: '#f8fafc',
            borderRadius: '8px',
            color: '#64748b',
            textAlign: 'center',
            fontSize: '14px',
          }}
        >
          🔒 Connect your Freighter wallet to view your owned NFT certificates.
        </div>
      ) : loading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#2563eb', fontWeight: '600' }}>
          ⏳ Querying Soroban NFT contract for certificates...
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: '16px',
            background: '#fef2f2',
            color: '#991b1b',
            borderRadius: '8px',
            fontSize: '14px',
          }}
        >
          ⚠️ {error}
        </div>
      ) : certificates.length === 0 ? (
        <div
          style={{
            padding: '30px',
            background: '#f8fafc',
            borderRadius: '8px',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
            No NFT Certificates Found
          </p>
          <p style={{ margin: 0, fontSize: '14px' }}>
            Purchase fractional shares to mint ownership certificates directly to your wallet.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '20px',
          }}
        >
          {certificates.map((cert) => (
            <div
              key={cert.id}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <img
                src={cert.imageUrl}
                alt={cert.assetTitle}
                loading="lazy"
                style={{ width: '100%', height: '150px', objectFit: 'cover' }}
              />
              <div style={{ padding: '14px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#2563eb',
                    background: '#dbeafe',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    textTransform: 'uppercase',
                  }}
                >
                  {cert.id}
                </span>
                <h4 style={{ margin: '8px 0 6px 0', fontSize: '15px', color: '#1e293b' }}>
                  {cert.assetTitle}
                </h4>
                <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#475569' }}>
                  <strong>Shares Held:</strong> {cert.sharesOwned}
                </p>
                <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#64748b' }}>
                  Minted: {cert.mintDate}
                </p>
                <code
                  style={{
                    fontSize: '10px',
                    color: '#94a3b8',
                    display: 'block',
                    wordBreak: 'break-all',
                    background: '#f8fafc',
                    padding: '4px',
                    borderRadius: '4px',
                  }}
                >
                  {cert.contractId.substring(0, 16)}...
                </code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
