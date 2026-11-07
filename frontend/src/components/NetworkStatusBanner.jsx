import { useEffect, useState, useRef } from 'react';

const HEALTH_CHECK_URL = `${import.meta.env.VITE_API_URL}/healthz`;
const POLL_INTERVAL_MS = 5000;

/**
 * Global banner that warns the user when the browser is offline or the
 * WebSocket connection has dropped. Auto-dismisses once /healthz responds
 * OK and connectivity is confirmed stable.
 *
 * Exposes `disconnected` via a custom event so other components (e.g. the
 * order form) can disable actions while offline.
 */
export default function NetworkStatusBanner({ wsRef }) {
  const [disconnected, setDisconnected] = useState(!navigator.onLine);
  const pollRef = useRef(null);

  useEffect(() => {
    const handleOffline = () => setDisconnected(true);
    const handleOnline = () => attemptRecovery();

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // Hook into WebSocket disconnect/reconnect if a ref is provided
    const ws = wsRef?.current;
    if (ws) {
      ws.addEventListener('close', handleOffline);
      ws.addEventListener('open', handleOnline);
    }

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (ws) {
        ws.removeEventListener('close', handleOffline);
        ws.removeEventListener('open', handleOnline);
      }
      clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsRef]);

  useEffect(() => {
    if (disconnected) {
      pollRef.current = setInterval(attemptRecovery, POLL_INTERVAL_MS);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [disconnected]);

  useEffect(() => {
    // Broadcast disconnection state so other components (order form, etc.)
    // can react without prop-drilling.
    window.dispatchEvent(
      new CustomEvent('network-status-change', { detail: { disconnected } })
    );
  }, [disconnected]);

  async function attemptRecovery() {
    try {
      const res = await fetch(HEALTH_CHECK_URL, { cache: 'no-store' });
      if (res.ok && navigator.onLine) {
        setDisconnected(false);
      }
    } catch {
      setDisconnected(true);
    }
  }

  if (!disconnected) return null;

  return (
    <div role="alert" className="network-status-banner">
      Connection lost. Displayed prices may be outdated.
    </div>
  );
}