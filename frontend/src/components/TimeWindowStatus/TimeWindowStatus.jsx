import React, { useState, useEffect, useCallback } from 'react';
import styles from './TimeWindowStatus.module.css';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

function formatCountdown(seconds) {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseScVal(val) {
  if (!val) return null;
  const name = val.switch().name;
  if (name === 'some') return parseScVal(val.some());
  if (name === 'u32') return val.u32();
  if (name === 'u64') return val.u64();
  if (name === 'i128') return val.i128().toNumber();
  if (name === 'bool') return val.bool();
  if (name === 'bytes' || name === 'string') {
    try { return val.bytes().toString(); } catch { return ''; }
  }
  return null;
}

export default function TimeWindowStatus({ onNotification }) {
  const [activeWindow, setActiveWindow] = useState(null);
  const [upcomingWindow, setUpcomingWindow] = useState(null);
  const [countdown, setCountdown] = useState('');
  const [upcomingCountdown, setUpcomingCountdown] = useState('');
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fetchWindows = useCallback(async () => {
    if (CONTRACT_ID.length < 50) return;
    setLoading(true);
    try {
      const { rpc, TransactionBuilder, Contract } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const pk = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF';
      const account = await server.getAccount(pk);

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('get_time_windows'))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (sim.result) {
        const retval = sim.result.retval;
        const vec = retval.vec();
        if (vec) {
          const now = Math.floor(Date.now() / 1000);
          let active = null;
          let upcoming = null;

          for (const item of vec) {
            const obj = parseScVal(item);
            if (!obj || !obj.start || !obj.end) continue;

            if (now >= obj.start && now < obj.end) {
              if (!active || obj.start > active.start) active = obj;
            } else if (obj.start > now) {
              if (!upcoming || obj.start < upcoming.start) upcoming = obj;
            }
          }

          setActiveWindow(active);
          setUpcomingWindow(upcoming);

          if (active && onNotification) {
            onNotification({ type: 'window_active', window: active });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching time windows:', err);
    } finally {
      setLoading(false);
    }
  }, [onNotification]);

  useEffect(() => {
    fetchWindows();
    const refreshInterval = setInterval(fetchWindows, 60000);
    return () => clearInterval(refreshInterval);
  }, [fetchWindows]);

  useEffect(() => {
    if (!activeWindow) return;
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = activeWindow.end - now;
      if (remaining <= 0) {
        setActiveWindow(null);
        if (onNotification) onNotification({ type: 'window_expired', window: activeWindow });
        fetchWindows();
        clearInterval(interval);
      } else {
        setCountdown(formatCountdown(remaining));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeWindow, onNotification, fetchWindows]);

  useEffect(() => {
    if (!upcomingWindow) return;
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = upcomingWindow.start - now;
      if (remaining <= 0) {
        setUpcomingWindow(null);
        fetchWindows();
        clearInterval(interval);
      } else {
        setUpcomingCountdown(formatCountdown(remaining));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [upcomingWindow, fetchWindows]);

  if (loading) return null;

  if (!dismissed && activeWindow) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = activeWindow.end - now;
    if (remaining <= 0) return null;

    const soldPct = activeWindow.total_shares > 0
      ? Math.round(((activeWindow.shares_sold || 0) / activeWindow.total_shares) * 100)
      : 0;

    return (
      <div className={styles.banner}>
        <div className={styles.content}>
          <div className={styles.indicator} />
          <div className={styles.info}>
            <span className={styles.title}>
              {activeWindow.name || 'Time-Limited Purchase Window'}
            </span>
            <span className={styles.subtitle}>
              {activeWindow.total_shares > 0 && (
                <>{activeWindow.shares_sold || 0}/{activeWindow.total_shares} shares sold ({soldPct}%)</>
              )}
              {activeWindow.price_override > 0 && (
                <> &mdash; Special price: {activeWindow.price_override}</>
              )}
              {activeWindow.max_shares_per_buyer > 0 && (
                <> &mdash; Max {activeWindow.max_shares_per_buyer} per buyer</>
              )}
            </span>
          </div>
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>Ends in</span>
            <span className={styles.countdownValue}>{countdown}</span>
          </div>
          <button
            className={styles.dismissBtn}
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    );
  }

  if (!dismissed && upcomingWindow) {
    return (
      <div className={`${styles.banner} ${styles.upcoming}`}>
        <div className={styles.content}>
          <div className={`${styles.indicator} ${styles.upcomingIndicator}`} />
          <div className={styles.info}>
            <span className={styles.title}>
              {upcomingWindow.name || 'Upcoming Purchase Window'}
            </span>
            <span className={styles.subtitle}>
              Opens in {upcomingCountdown}
              {upcomingWindow.total_shares > 0 && (
                <> &mdash; {upcomingWindow.total_shares} shares available</>
              )}
            </span>
          </div>
          <button
            className={styles.dismissBtn}
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    );
  }

  return null;
}
