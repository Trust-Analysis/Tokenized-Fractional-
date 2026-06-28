import React, { useState, useEffect, useCallback } from 'react';
import Card from '../Card/Card';
import Spinner from '../Spinner/Spinner';
import Skeleton from '../Skeleton/Skeleton';
import Button from '../Button/Button';
import Badge from '../Badge/Badge';
import { useWalletStore } from '../../store/useWalletStore';
import styles from './TransactionHistory.module.css';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || '';
const HORIZON_LIMIT = 20;

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusVariant(successful) {
  return successful ? 'success' : 'danger';
}

function shortHash(hash) {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function explorerLink(hash) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export default function TransactionHistory() {
  const { publicKey } = useWalletStore();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${HORIZON_URL}/accounts/${publicKey}/transactions?order=desc&limit=${HORIZON_LIMIT}&include_failed=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
      const data = await res.json();
      const records = data._embedded?.records ?? [];

      // Filter to contract-related txs if CONTRACT_ID is configured
      const filtered = CONTRACT_ID.length > 10
        ? records.filter(tx => tx.memo?.includes(CONTRACT_ID) || tx.operations_count > 0)
        : records;

      setTxs(filtered.slice(0, HORIZON_LIMIT));
    } catch (err) {
      console.error('TransactionHistory fetch error:', err);
      setError('Failed to load transaction history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (!publicKey) {
    return (
      <Card>
        <div className={styles.state}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
          <p className={styles.stateText}>Connect your wallet to view transaction history</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Transaction History</h2>
        <Button onClick={fetchHistory} loading={loading} variant="primary" size="sm">
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {error}
        </div>
      )}

      {loading && txs.length === 0 ? (
        <div className={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className={styles.row}>
              <Skeleton variant="text" width="120px" height="1em" />
              <Skeleton variant="text" width="60px" height="1em" />
              <Skeleton variant="text" width="80px" height="1em" />
              <Skeleton variant="text" width="100px" height="1em" />
            </Card>
          ))}
        </div>
      ) : !loading && txs.length === 0 ? (
        <Card>
          <div className={styles.state}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <p className={styles.stateText}>No transactions found</p>
            <p className={styles.stateSub}>Your recent Stellar transactions will appear here.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className={styles.tableHeader}>
            <span>Hash</span>
            <span>Date</span>
            <span>Operations</span>
            <span>Status</span>
          </div>
          {txs.map((tx) => (
            <Card key={tx.id} className={styles.row}>
              <a
                href={explorerLink(tx.hash)}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.hash}
                title={tx.hash}
              >
                {shortHash(tx.hash)}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
              <span className={styles.date}>{formatDate(tx.created_at)}</span>
              <span className={styles.ops}>{tx.operation_count ?? tx.operations_count ?? '—'}</span>
              <Badge variant={statusVariant(tx.successful)}>
                {tx.successful ? 'Success' : 'Failed'}
              </Badge>
            </Card>
          ))}
          {loading && (
            <div className={styles.loadingMore}>
              <Spinner size="sm" label="Loading more…" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
