import React, { useEffect, useRef, useState } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import { useToastStore } from '../../store/useToastStore';
import styles from './Toast.module.css';

const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const EXPLORER_NETWORK = NETWORK_PASSPHRASE === Networks.PUBLIC ? 'public' : 'testnet';

function explorerUrl(hash) {
  return `https://stellar.expert/explorer/${EXPLORER_NETWORK}/tx/${hash}`;
}

const AUTO_DISMISS_MS = {
  success: 5000,
  error: 8000,
  warning: 6000,
  info: 4000,
};

function ToastItem({ toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef(null);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => removeToast(toast.id), 200);
  };

  useEffect(() => {
    const ms = toast.duration ?? AUTO_DISMISS_MS[toast.type] ?? 5000;
    if (ms > 0 && toast.type !== 'pending') {
      timerRef.current = setTimeout(dismiss, ms);
    }
    return () => clearTimeout(timerRef.current);
  }, [toast.id]);

  const classNames = [styles.toast, styles[toast.type], exiting ? styles.toastExiting : ''].filter(Boolean).join(' ');

  const renderIcon = () => {
    if (toast.type === 'pending') {
      return <div className={styles.spinner} />;
    }
    if (toast.type === 'success') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    }
    if (toast.type === 'error') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    }
    if (toast.type === 'warning') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    }
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  };

  return (
    <div className={classNames} role="alert">
      {renderIcon()}
      <div className={styles.body}>
        <p className={styles.message}>{toast.message}</p>
        {toast.txHash && (
          <p className={styles.txHash}>
            <a
              href={explorerUrl(toast.txHash)}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.txHashLink}
              title={toast.txHash}
            >
              Tx: {toast.txHash.slice(0, 8)}…{toast.txHash.slice(-6)}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3, verticalAlign: 'middle' }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </p>
        )}
      </div>
      <button className={styles.closeBtn} onClick={dismiss} aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
