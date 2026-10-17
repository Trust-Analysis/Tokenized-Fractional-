import React, { useState, useEffect, useCallback } from 'react';
import { getQueueStats } from '../../services/offlineQueue';
import styles from './OfflineIndicator.module.css';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const [pendingActions, setPendingActions] = useState(0);
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setOfflineMode(false);
      const t = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(t);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOfflineMode(true);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!offlineMode) return;

    const pollStats = async () => {
      try {
        const stats = await getQueueStats();
        setPendingActions(stats.pending);
      } catch {
        // silently fail
      }
    };

    pollStats();
    const interval = setInterval(pollStats, 5000);
    return () => clearInterval(interval);
  }, [offlineMode]);

  const handleDismissReconnected = useCallback(() => {
    setShowReconnected(false);
  }, []);

  if (isOnline && !showReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={isOnline ? styles.reconnected : styles.offline}
    >
      {isOnline ? (
        <div className={styles.bannerContent}>
          <svg
            className={styles.icon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Back online</span>
          {pendingActions > 0 && (
            <span className={styles.syncInfo}>
              Syncing {pendingActions} pending action{pendingActions !== 1 ? 's' : ''}...
            </span>
          )}
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={handleDismissReconnected}
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <div className={styles.bannerContent}>
          <svg
            className={styles.icon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span className={styles.offlineLabel}>Offline Mode</span>
          <span className={styles.offlineDesc}>Showing cached data</span>
          {pendingActions > 0 && (
            <span className={styles.queueInfo}>
              {pendingActions} action{pendingActions !== 1 ? 's' : ''} queued
            </span>
          )}
        </div>
      )}
    </div>
  );
}
