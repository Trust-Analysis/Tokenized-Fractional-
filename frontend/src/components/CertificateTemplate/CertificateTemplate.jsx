/**
 * CertificateTemplate — renders an off-screen branded share certificate
 * and triggers a PDF download via html2canvas + jsPDF.
 *
 * Issue #372 additions:
 *  - Accepts optional `txHash` prop; renders a "Transaction Hash" row when present.
 *  - Shows a loading indicator (spinner overlay) while the PDF is being generated.
 *  - Passes `txHash` through to the caller-supplied `onComplete` callback so the
 *    parent can clear the pending state.
 */
import React, { useRef, useEffect, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const CERT_WIDTH = 1123;
const CERT_HEIGHT = 794;

const CertificateTemplate = React.memo(
  ({ assetName, shares, ownerAddress, issueDate, txHash, onComplete }) => {
    const certRef = useRef(null);
    const [generating, setGenerating] = useState(true);

    useEffect(() => {
      if (!certRef.current || typeof onComplete !== 'function') return;

      let cancelled = false;
      setGenerating(true);

      html2canvas(certRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      })
        .then((canvas) => {
          if (cancelled) return;
          try {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
              orientation: 'landscape',
              unit: 'px',
              format: [CERT_WIDTH, CERT_HEIGHT],
            });
            pdf.addImage(imgData, 'PNG', 0, 0, CERT_WIDTH, CERT_HEIGHT);
            pdf.save(`certificate-${assetName.replace(/\s+/g, '-').toLowerCase()}.pdf`);
          } catch (err) {
            console.error('Failed to generate certificate PDF:', err);
          } finally {
            setGenerating(false);
            onComplete();
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.error('Failed to generate certificate PDF:', err);
            setGenerating(false);
            onComplete();
          }
        });

      return () => {
        cancelled = true;
      };
    }, [assetName, shares, ownerAddress, issueDate, txHash, onComplete]);

    return (
      <>
        {/* ── Loading overlay shown while the PDF renders ─────────────────── */}
        {generating && (
          <div
            aria-live="polite"
            aria-label="Generating PDF certificate…"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              gap: '1rem',
              color: '#f8fafc',
              fontFamily: "'Outfit', 'Inter', sans-serif",
            }}
          >
            {/* Simple CSS spinner — no extra dependency */}
            <span
              aria-hidden="true"
              style={{
                width: 48,
                height: 48,
                border: '4px solid rgba(255,255,255,0.2)',
                borderTopColor: '#3b82f6',
                borderRadius: '50%',
                animation: 'certSpin 0.75s linear infinite',
                display: 'inline-block',
              }}
            />
            <style>{`@keyframes certSpin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ fontSize: '1rem', fontWeight: 500 }}>
              Generating certificate PDF…
            </span>
          </div>
        )}

        {/* ── Off-screen certificate canvas ───────────────────────────────── */}
        <div
          ref={certRef}
          data-testid="certificate-template"
          style={{
            position: 'absolute',
            left: '-9999px',
            top: 0,
            width: CERT_WIDTH,
            height: CERT_HEIGHT,
            fontFamily:
              "'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            background: '#ffffff',
            color: '#0f172a',
            padding: '48px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              border: '6px solid #0f172a',
              borderRadius: '8px',
              padding: '48px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'relative',
              background: '#ffffff',
            }}
          >
            {/* Inner border decoration */}
            <div
              style={{
                position: 'absolute',
                top: '16px',
                left: '16px',
                right: '16px',
                bottom: '16px',
                border: '2px solid #0f172a',
                borderRadius: '4px',
                pointerEvents: 'none',
              }}
            />

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: '#64748b',
                  marginBottom: '12px',
                }}
              >
                Certificate of Ownership
              </div>
              <div
                style={{
                  width: '120px',
                  height: '3px',
                  background: '#0f172a',
                  margin: '0 auto',
                }}
              />
            </div>

            {/* ── Owner ──────────────────────────────────────────────────── */}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <div style={{ fontSize: '18px', color: '#64748b', marginBottom: '8px' }}>
                This certifies that
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#0f172a',
                  wordBreak: 'break-all',
                  padding: '0 48px',
                }}
              >
                {ownerAddress}
              </div>
            </div>

            {/* ── Share count + asset name ───────────────────────────────── */}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <div style={{ fontSize: '18px', color: '#64748b', marginBottom: '8px' }}>
                is the proud owner of
              </div>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#2563eb' }}>{shares}</div>
              <div style={{ fontSize: '18px', color: '#64748b', marginTop: '4px' }}>
                {shares === 1 ? 'share' : 'shares'} of
              </div>
              <div
                style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}
              >
                {assetName}
              </div>
            </div>

            {/* ── Transaction hash (Issue #372) ─────────────────────────── */}
            {txHash && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: '24px',
                  padding: '12px 48px',
                  background: '#f8fafc',
                  borderRadius: '4px',
                  maxWidth: '900px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                  Transaction Hash
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#0f172a',
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                  }}
                >
                  {txHash}
                </div>
              </div>
            )}

            {/* ── Footer signatures ─────────────────────────────────────── */}
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                padding: '0 48px',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '200px',
                    height: '1px',
                    background: '#0f172a',
                    margin: '0 auto 8px',
                  }}
                />
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                  RWA Marketplace
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Stellar Network</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '200px',
                    height: '1px',
                    background: '#0f172a',
                    margin: '0 auto 8px',
                  }}
                />
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                  Date Issued
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {new Date(issueDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  },
);

export default CertificateTemplate;
