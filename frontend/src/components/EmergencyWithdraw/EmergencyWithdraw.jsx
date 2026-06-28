import React, { useState, useRef } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import styles from './EmergencyWithdraw.module.css';
import { useToastStore } from '../../store/useToastStore';
import useTransactionStatus from '../../hooks/useTransactionStatus';
import {
  EMERGENCY_WITHDRAW_CONFIRMED,
  EMERGENCY_WITHDRAW_TX_FAILED,
  WALLET_AND_CONTRACT_REQUIRED,
  ENTER_VALID_AMOUNT,
  SIGNING_FAILED,
  EMERGENCY_WITHDRAW_SUBMITTED,
  EMERGENCY_WITHDRAW_FAILED,
} from '../../constants/errors';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

export default function EmergencyWithdraw({ publicKey }) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [lastTxHash, setLastTxHash] = useState(null);
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const txStatus = useTransactionStatus(lastTxHash);

  React.useEffect(() => {
    if (!lastTxHash || notifiedRef.current[lastTxHash]) return;

    if (txStatus === 'confirmed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: EMERGENCY_WITHDRAW_CONFIRMED, type: 'success', txHash: lastTxHash });
    } else if (txStatus === 'failed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: EMERGENCY_WITHDRAW_TX_FAILED, type: 'error', txHash: lastTxHash });
    }
  }, [lastTxHash, txStatus]);

  const handleWithdraw = async () => {
    if (!publicKey || CONTRACT_ID.length < 50) {
      addToast({ message: WALLET_AND_CONTRACT_REQUIRED, type: 'error' });
      return;
    }
    const parsedAmount = BigInt(amount);
    if (!amount || parsedAmount <= 0) {
      addToast({ message: ENTER_VALID_AMOUNT, type: 'error' });
      return;
    }
    if (!confirm(`Emergency withdraw ${amount} tokens from the contract to ${publicKey.slice(0, 8)}…? Continue?`)) return;

    setLoading(true);
    setLastTxHash(null);

    try {
      const { signTransaction } = await import('@stellar/freighter-api');
      const { rpc, TransactionBuilder, Contract, nativeToScVal } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);

      const account = await server.getAccount(publicKey);
      let tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'emergency_withdraw',
            nativeToScVal(publicKey, { type: 'address' }),
            nativeToScVal(parsedAmount, { type: 'i128' }),
          )
        )
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
      pendingToastRef.current = addToast({
        message: EMERGENCY_WITHDRAW_SUBMITTED,
        type: 'pending',
        txHash: hash,
      });
      setAmount('');
    } catch (err) {
      addToast({ message: err.message || EMERGENCY_WITHDRAW_FAILED, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Emergency Withdraw</h3>
      <p className={styles.warning}>
        This will withdraw tokens from the contract back to the admin address.
        Only use this in emergency situations.
      </p>

      <div className={styles.inputRow}>
        <Input
          id="ew-amount"
          type="number"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
          min="1"
          disabled={loading}
          placeholder="Amount to withdraw"
        />
      </div>

      <Button
        variant="danger"
        onClick={handleWithdraw}
        loading={loading}
        disabled={!publicKey || CONTRACT_ID.length < 50}
      >
        {loading ? 'Processing…' : 'Emergency Withdraw'}
      </Button>
    </div>
  );
}
