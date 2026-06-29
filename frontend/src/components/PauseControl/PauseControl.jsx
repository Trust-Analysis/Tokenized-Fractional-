import React, { useState, useEffect, useRef } from 'react';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import styles from './PauseControl.module.css';
import { useToastStore } from '../../store/useToastStore';
import useTransactionStatus from '../../hooks/useTransactionStatus';
import {
  PAUSE_SUCCESS,
  PAUSE_TOGGLE_FAILED,
  WALLET_AND_CONTRACT_REQUIRED,
  SIGNING_FAILED,
  FAILED_TO_TOGGLE_PAUSE,
} from '../../constants/errors';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

export default function PauseControl({ publicKey }) {
  const [loading, setLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const txStatus = useTransactionStatus(lastTxHash);

  useEffect(() => {
    if (!lastTxHash || notifiedRef.current[lastTxHash]) return;

    if (txStatus === 'confirmed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: PAUSE_SUCCESS(isPaused), type: 'success', txHash: lastTxHash });
    } else if (txStatus === 'failed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: PAUSE_TOGGLE_FAILED, type: 'error', txHash: lastTxHash });
    }
  }, [lastTxHash, txStatus]);

  useEffect(() => {
    if (publicKey && CONTRACT_ID.length >= 50) {
      fetchPauseStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const fetchPauseStatus = async () => {
    if (!publicKey) return;
    try {
      const { rpc, Contract, nativeToScVal } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(publicKey);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call('is_paused'))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (sim.result) {
        setIsPaused(sim.result.retval._value);
      }
    } catch {
      // silently fail — status will show unknown
    }
  };

  const handleToggle = async () => {
    if (!publicKey || CONTRACT_ID.length < 50) {
      addToast({ message: WALLET_AND_CONTRACT_REQUIRED, type: 'error' });
      return;
    }

    setLoading(true);
    setLastTxHash(null);

    try {
      const { signTransaction } = await import('@stellar/freighter-api');
      const { rpc, TransactionBuilder, Contract, nativeToScVal } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);

      const account = await server.getAccount(publicKey);
      const fnName = isPaused ? 'unpause' : 'pause';
      let tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(fnName))
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (simulation.error) throw new Error(simulation.error);

      tx = rpc.assembleTransaction(tx, simulation).build();
      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signError || !signedTxXdr) throw new Error(signError?.message || SIGNING_FAILED);

      const submitRes = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      );

      const hash = submitRes.hash;
      setLastTxHash(hash);
      setIsPaused(!isPaused);
      pendingToastRef.current = addToast({
        message: `${isPaused ? 'Unpausing' : 'Pausing'} marketplace…`,
        type: 'pending',
        txHash: hash,
      });
    } catch (err) {
      addToast({ message: err.message || FAILED_TO_TOGGLE_PAUSE, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Pause / Unpause Marketplace</h3>

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Current Status:</span>
        <span className={`${styles.statusValue} ${isPaused ? styles.paused : styles.active}`}>
          {isPaused === null ? (
            <Spinner size="sm" label="Checking…" />
          ) : isPaused ? (
            'Paused'
          ) : (
            'Active'
          )}
        </span>
      </div>

      <Button
        variant={isPaused ? 'success' : 'danger'}
        onClick={handleToggle}
        loading={loading}
        disabled={!publicKey || CONTRACT_ID.length < 50}
      >
        {loading ? 'Processing…' : isPaused ? 'Unpause Marketplace' : 'Pause Marketplace'}
      </Button>
    </div>
  );
}
