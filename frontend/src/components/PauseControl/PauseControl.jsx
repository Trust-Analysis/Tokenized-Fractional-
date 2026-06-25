import React, { useState, useEffect } from 'react';
import Button from '../Button/Button';
import Alert from '../Alert/Alert';
import Spinner from '../Spinner/Spinner';
import styles from './PauseControl.module.css';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

export default function PauseControl({ publicKey }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isPaused, setIsPaused] = useState(null);

  // Fetch pause status on mount and when publicKey changes
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
      setError('Wallet must be connected and contract must be configured');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

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
      if (signError || !signedTxXdr) throw new Error(signError?.message || 'Signing failed');

      const submitRes = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      );

      setSuccess(`Marketplace ${isPaused ? 'unpaused' : 'paused'}! Tx: ${submitRes.hash}`);
      setIsPaused(!isPaused);
    } catch (err) {
      setError(err.message || 'Failed to toggle pause state');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Pause / Unpause Marketplace</h3>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

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
