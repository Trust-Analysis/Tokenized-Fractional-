import React, { useState, useEffect, useRef, useCallback } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Spinner from '../Spinner/Spinner';
import Badge from '../Badge/Badge';
import styles from './TimeWindowManager.module.css';
import { useToastStore } from '../../store/useToastStore';
import useTransactionStatus from '../../hooks/useTransactionStatus';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(Number(ts) * 1000).toLocaleString();
}

function formatDateTimeLocal(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().slice(0, 16);
}

function getWindowStatus(start, end) {
  const now = Math.floor(Date.now() / 1000);
  if (now < start) return 'upcoming';
  if (now >= start && now < end) return 'active';
  return 'ended';
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
  if (name === 'vec') {
    const v = val.vec();
    return v ? v.map(parseScVal) : [];
  }
  if (name === 'map') {
    const m = val.map();
    if (!m) return {};
    const obj = {};
    for (const [k, v] of m.entries()) {
      obj[k.toString()] = parseScVal(v);
    }
    return obj;
  }
  return null;
}

export default function TimeWindowManager({ publicKey }) {
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lastTxHash, setLastTxHash] = useState(null);
  const [editingWindow, setEditingWindow] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const txStatus = useTransactionStatus(lastTxHash);

  const [form, setForm] = useState({
    start: '',
    end: '',
    priceOverride: '',
    maxPerBuyer: '',
    totalShares: '',
    name: '',
  });

  useEffect(() => {
    if (!lastTxHash || notifiedRef.current[lastTxHash]) return;
    if (txStatus === 'confirmed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: 'Time window transaction confirmed', type: 'success', txHash: lastTxHash });
      fetchWindows();
    } else if (txStatus === 'failed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: 'Time window transaction failed', type: 'error', txHash: lastTxHash });
    }
  }, [lastTxHash, txStatus]);

  useEffect(() => {
    if (publicKey && CONTRACT_ID.length >= 50) {
      fetchWindows();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const sdk = async () => {
    const { rpc: sdkRpc, TransactionBuilder, Contract, nativeToScVal } = await import('@stellar/stellar-sdk');
    return { rpc: sdkRpc, TransactionBuilder, Contract, nativeToScVal };
  };

  const fetchWindows = useCallback(async () => {
    if (!publicKey || CONTRACT_ID.length < 50) return;
    setFetching(true);
    try {
      const { rpc: sdkRpc, TransactionBuilder, Contract } = await sdk();
      const server = new sdkRpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(publicKey);

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
        const parsed = [];
        if (vec) {
          for (const item of vec) {
            const obj = parseScVal(item);
            if (obj && obj.start) parsed.push(obj);
          }
        }
        setWindows(parsed);
      }
    } catch (err) {
      console.error('Error fetching time windows:', err);
    } finally {
      setFetching(false);
    }
  }, [publicKey]);

  const executeContractCall = useCallback(async (fnName, args, pendingMessage) => {
    if (!publicKey || CONTRACT_ID.length < 50) {
      addToast({ message: 'Wallet must be connected and contract configured', type: 'error' });
      return false;
    }

    setLoading(true);
    setLastTxHash(null);

    try {
      const { signTransaction } = await import('@stellar/freighter-api');
      const { rpc: sdkRpc, TransactionBuilder, Contract, nativeToScVal } = await sdk();
      const server = new sdkRpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(publicKey);

      let tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(fnName, ...args))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.error) throw new Error(simulation.error);

      tx = sdkRpc.assembleTransaction(tx, simulation).build();
      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signError || !signedTxXdr) throw new Error(signError?.message || 'Signing failed');

      const submitRes = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      );

      const hash = submitRes.hash;
      setLastTxHash(hash);
      pendingToastRef.current = addToast({
        message: pendingMessage,
        type: 'pending',
        txHash: hash,
      });

      return true;
    } catch (err) {
      addToast({ message: err.message || 'Transaction failed', type: 'error' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [publicKey, addToast, removeToast]);

  const handleCreateWindow = async () => {
    const { start, end, totalShares, name } = form;
    if (!start || !end || !totalShares || !name) {
      addToast({ message: 'Fill in all required fields (start, end, totalShares, name)', type: 'error' });
      return;
    }

    const startTs = Math.floor(new Date(start).getTime() / 1000);
    const endTs = Math.floor(new Date(end).getTime() / 1000);
    if (endTs <= startTs) {
      addToast({ message: 'End time must be after start time', type: 'error' });
      return;
    }

    const { nativeToScVal } = await sdk();
    const args = [
      nativeToScVal(publicKey, { type: 'address' }),
      nativeToScVal(startTs, { type: 'u64' }),
      nativeToScVal(endTs, { type: 'u64' }),
      nativeToScVal(form.priceOverride ? BigInt(form.priceOverride) : null, { type: 'option', innerType: 'i128' }),
      nativeToScVal(form.maxPerBuyer ? parseInt(form.maxPerBuyer) : 0, { type: 'u32' }),
      nativeToScVal(parseInt(totalShares), { type: 'u32' }),
      nativeToScVal(false, { type: 'bool' }),
      nativeToScVal(0, { type: 'u64' }),
      nativeToScVal(name, { type: 'string' }),
    ];

    const success = await executeContractCall('create_time_window', args, 'Creating time window...');
    if (success) {
      setForm({ start: '', end: '', priceOverride: '', maxPerBuyer: '', totalShares: '', name: '' });
      setShowForm(false);
    }
  };

  const handleUpdateWindow = async (windowId) => {
    const { start, end, totalShares } = form;
    if (!start || !end) {
      addToast({ message: 'Start and end times are required', type: 'error' });
      return;
    }

    const startTs = Math.floor(new Date(start).getTime() / 1000);
    const endTs = Math.floor(new Date(end).getTime() / 1000);
    if (endTs <= startTs) {
      addToast({ message: 'End time must be after start time', type: 'error' });
      return;
    }

    const { nativeToScVal } = await sdk();
    const args = [
      nativeToScVal(publicKey, { type: 'address' }),
      nativeToScVal(windowId, { type: 'u64' }),
      nativeToScVal(startTs, { type: 'u64' }),
      nativeToScVal(endTs, { type: 'u64' }),
      nativeToScVal(form.priceOverride ? BigInt(form.priceOverride) : null, { type: 'option', innerType: 'i128' }),
      nativeToScVal(form.maxPerBuyer ? parseInt(form.maxPerBuyer) : 0, { type: 'u32' }),
      nativeToScVal(totalShares ? parseInt(totalShares) : 100, { type: 'u32' }),
    ];

    const success = await executeContractCall('update_time_window', args, 'Updating time window...');
    if (success) {
      setEditingWindow(null);
      setForm({ start: '', end: '', priceOverride: '', maxPerBuyer: '', totalShares: '', name: '' });
    }
  };

  const handleCancelWindow = async (windowId) => {
    const { nativeToScVal } = await sdk();
    const args = [
      nativeToScVal(publicKey, { type: 'address' }),
      nativeToScVal(windowId, { type: 'u64' }),
    ];

    await executeContractCall('cancel_time_window', args, 'Cancelling time window...');
  };

  const startEditing = (w) => {
    setEditingWindow(w.id);
    setForm({
      start: formatDateTimeLocal(w.start),
      end: formatDateTimeLocal(w.end),
      priceOverride: w.price_override > 0 ? String(w.price_override) : '',
      maxPerBuyer: w.max_shares_per_buyer > 0 ? String(w.max_shares_per_buyer) : '',
      totalShares: String(w.total_shares),
      name: w.name || '',
    });
    setShowForm(true);
  };

  const cancelEditing = () => {
    setEditingWindow(null);
    setForm({ start: '', end: '', priceOverride: '', maxPerBuyer: '', totalShares: '', name: '' });
    setShowForm(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.heading}>Time-Locked Purchase Windows</h3>
          <p className={styles.description}>
            Create and manage time-restricted purchase windows for phased launches or promotional events.
          </p>
        </div>
        {!showForm && (
          <Button
            variant="primary"
            onClick={() => setShowForm(true)}
            disabled={!publicKey || CONTRACT_ID.length < 50}
          >
            + New Window
          </Button>
        )}
      </div>

      {showForm && (
        <div className={styles.form}>
          <h4 className={styles.formTitle}>
            {editingWindow !== null ? 'Edit Time Window' : 'Create New Time Window'}
          </h4>
          <Input
            id="tw-name"
            label="Window Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Phase 1 Launch"
            disabled={loading}
          />
          <div className={styles.row}>
            <Input
              id="tw-start"
              label="Start Time"
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
              disabled={loading}
            />
            <Input
              id="tw-end"
              label="End Time"
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
              disabled={loading}
            />
          </div>
          <div className={styles.row}>
            <Input
              id="tw-shares"
              label="Total Shares"
              type="number"
              value={form.totalShares}
              onChange={(e) => setForm({ ...form, totalShares: e.target.value })}
              min="1"
              placeholder="100"
              disabled={loading}
            />
            <Input
              id="tw-price"
              label="Price Override (optional)"
              type="number"
              value={form.priceOverride}
              onChange={(e) => setForm({ ...form, priceOverride: e.target.value })}
              placeholder="Leave empty for base price"
              disabled={loading}
            />
          </div>
          <Input
            id="tw-max"
            label="Max Shares Per Buyer (0 = unlimited)"
            type="number"
            value={form.maxPerBuyer}
            onChange={(e) => setForm({ ...form, maxPerBuyer: e.target.value })}
            min="0"
            disabled={loading}
          />
          <div className={styles.formActions}>
            <Button
              variant="primary"
              onClick={editingWindow !== null ? () => handleUpdateWindow(editingWindow) : handleCreateWindow}
              loading={loading}
              disabled={!publicKey || CONTRACT_ID.length < 50}
            >
              {loading
                ? (editingWindow !== null ? 'Updating...' : 'Creating...')
                : (editingWindow !== null ? 'Update Window' : 'Create Time Window')
              }
            </Button>
            <Button variant="secondary" onClick={cancelEditing} disabled={loading}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {windows.length > 0 && (
        <div className={styles.windowList}>
          <h4 className={styles.listHeading}>Existing Windows ({windows.length})</h4>
          {windows.map((w, i) => {
            const status = getWindowStatus(w.start, w.end);
            const utilization = w.total_shares > 0
              ? Math.round(((w.shares_sold || 0) / w.total_shares) * 100)
              : 0;
            return (
              <div key={i} className={`${styles.windowItem} ${styles[`status_${status}`] || ''}`}>
                <div className={styles.windowHeader}>
                  <div className={styles.windowTitleRow}>
                    <span className={styles.windowName}>{w.name || `Window ${w.id}`}</span>
                    <Badge variant={status === 'active' ? 'success' : status === 'upcoming' ? 'default' : 'danger'}>
                      {status}
                    </Badge>
                    {w.is_recurring && <Badge variant="info">recurring</Badge>}
                  </div>
                  <div className={styles.windowActions}>
                    {status === 'upcoming' && (
                      <Button variant="secondary" size="sm" onClick={() => startEditing(w)} disabled={loading}>
                        Edit
                      </Button>
                    )}
                    {status !== 'ended' && (
                      <Button variant="danger" size="sm" onClick={() => handleCancelWindow(w.id)} disabled={loading}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                <div className={styles.windowDetails}>
                  <span><strong>Start:</strong> {formatDate(w.start)}</span>
                  <span><strong>End:</strong> {formatDate(w.end)}</span>
                  <span><strong>Shares:</strong> {w.shares_sold || 0}/{w.total_shares}</span>
                  {w.price_override > 0 && <span><strong>Price:</strong> {w.price_override}</span>}
                  {w.max_shares_per_buyer > 0 && <span><strong>Max/buyer:</strong> {w.max_shares_per_buyer}</span>}
                  {w.is_recurring && w.recurrence_interval > 0 && (
                    <span><strong>Repeats every:</strong> {Math.round(w.recurrence_interval / 3600)}h</span>
                  )}
                </div>
                {w.total_shares > 0 && (
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${Math.min(utilization, 100)}%` }}
                    />
                    <span className={styles.progressLabel}>{utilization}% utilized</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {windows.length === 0 && !fetching && (
        <div className={styles.empty}>
          No time windows created yet. Click "New Window" to get started.
        </div>
      )}

      {fetching && (
        <div className={styles.fetching}>
          <Spinner size="sm" label="Loading windows..." />
        </div>
      )}
    </div>
  );
}
