import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import { useToastStore } from '../../store/useToastStore';
import { SEE_DETAILS } from '../../constants/errors';
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

function ToastItem({ toast, onDismiss }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef(null);
  const toastRef = useRef(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      removeToast(toast.id);
      onDismiss?.(toast.id);
    }, 250);
  }, [removeToast, toast.id, onDismiss]);

  useEffect(() => {
    const ms = toast.duration ?? AUTO_DISMISS_MS[toast.type] ?? 5000;
    if (ms > 0 && toast.type !== 'pending') {
      timerRef.current = setTimeout(dismiss, ms);
    }
    return () => clearTimeout(timerRef.current);
  }, [toast.id, toast.duration, toast.type, dismiss]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && document.activeElement === toastRef.current) {
        dismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dismiss]);

  const classNames = [
    styles.toast,
    styles[toast.type],
    exiting ? styles.toastExiting : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderIcon = () => {
    if (toast.type === 'pending') {
      return <div className={styles.spinner} aria-hidden="true" />;
    }
    if (toast.type === 'success') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    }
    if (toast.type === 'error') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    }
    if (toast.type === 'warning') {
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    }
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div
      ref={toastRef}
      className={classNames}
      role="alert"
      tabIndex={0}
      aria-live="assertive"
      onKeyDown={(e) => {
        if (e.key === 'Escape') dismiss();
      }}
    >
      {renderIcon()}
      <div className={styles.body}>
        <p className={styles.message}>{toast.message}</p>
        {toast.nextSteps && <p className={styles.nextSteps}>{toast.nextSteps}</p>}
        {toast.details && (
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>{SEE_DETAILS}</summary>
            <p className={styles.detailsBody}>{toast.details}</p>
          </details>
        )}
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
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3, verticalAlign: 'middle' }} aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </p>
        )}
        {toast.action && (
          <button
            className={styles.actionButton}
            onClick={() => {
              toast.action.onClick?.(toast);
              dismiss();
            }}
            type="button"
          >
            {toast.action.label}
          </button>
        )}
        <span className={styles.timestamp}>{formatTime(toast.createdAt)}</span>
      </div>
      <button
        className={styles.closeBtn}
        onClick={dismiss}
        aria-label={`Dismiss ${toast.type} notification`}
        title="Dismiss"
        type="button"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const history = useToastStore((s) => s.history);
  const preferences = useToastStore((s) => s.preferences);
  const updatePreferences = useToastStore((s) => s.updatePreferences);
  const clearHistory = useToastStore((s) => s.clearHistory);
  const removeToast = useToastStore((s) => s.removeToast);
  const [showHistory, setShowHistory] = useState(false);
  const historyPanelRef = useRef(null);
  const [focusedToastIndex, setFocusedToastIndex] = useState(-1);

  const handleDismiss = useCallback((id) => {
    removeToast(id);
  }, [removeToast]);

  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e) => {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  useEffect(() => {
    if (!showHistory) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowHistory(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showHistory]);

  const handleContainerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setFocusedToastIndex((prev) => {
        const next = prev + delta;
        if (next < 0 || next >= toasts.length) return prev;
        return next;
      });
    }
  };

  useEffect(() => {
    if (focusedToastIndex >= 0 && focusedToastIndex < toasts.length) {
      const toastEls = document.querySelectorAll('[role="alert"]');
      toastEls[focusedToastIndex]?.focus();
    }
  }, [focusedToastIndex, toasts.length]);

  if (toasts.length === 0 && !showHistory) return null;

  const formatHistoryTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <>
      <div
        className={styles.container}
        data-position={preferences.position}
        onKeyDown={handleContainerKeyDown}
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={handleDismiss} />
        ))}
        {toasts.length > 0 && (
          <button
            className={styles.historyToggle}
            onClick={() => setShowHistory((prev) => !prev)}
            aria-expanded={showHistory}
            aria-controls="toast-history-panel"
            type="button"
          >
            {showHistory ? 'Hide history' : `History (${history.length})`}
          </button>
        )}
      </div>

      {showHistory && (
        <div
          id="toast-history-panel"
          ref={historyPanelRef}
          className={styles.historyPanel}
          data-position={preferences.position}
          role="dialog"
          aria-label="Notification history"
          aria-modal="false"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className={styles.historyTitle}>Notification History</h3>
            <button
              className={styles.historyClose}
              onClick={() => setShowHistory(false)}
              aria-label="Close history"
              type="button"
            >
              ×
            </button>
          </div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>No notifications yet.</p>
          ) : (
            <ul className={styles.historyList}>
              {history.map((item) => (
                <li key={item.id} className={styles.historyItem}>
                  <p className={styles.historyMessage}>{item.message}</p>
                  <span className={styles.historyMeta}>
                    {item.type} · {formatHistoryTime(item.createdAt)}
                    {item.txHash ? ` · Tx: ${item.txHash.slice(0, 8)}…` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {history.length > 0 && (
            <button
              className={styles.historyClear}
              onClick={clearHistory}
              type="button"
            >
              Clear history
            </button>
          )}
        </div>
      )}
    </>
  );
}
