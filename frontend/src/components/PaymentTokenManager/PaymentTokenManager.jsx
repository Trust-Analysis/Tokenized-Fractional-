import React, { useState, useEffect } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Spinner from '../Spinner/Spinner';
import { useToastStore } from '../../store/useToastStore';
import styles from './PaymentTokenManager.module.css';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

export default function PaymentTokenManager({ publicKey }) {
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (publicKey && CONTRACT_ID.length >= 50) fetchTokens();
  }, [publicKey]);

  const fetchTokens = async () => {
    setLoadingTokens(true);
    try {
      const { rpc, Contract, TransactionBuilder, Address, xdr } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(RPC_URL);
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(publicKey);
      const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call('get_accepted_tokens'))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (sim.result?.retval) {
        const vec = sim.result.retval.vec();
        setTokens(vec ? vec.map((v) => Address.fromScVal(v).toString()) : []);
      }
    } catch (err) {
      addToast({ message: `Failed to fetch accepted tokens: ${err.message}`, type: 'error' });
    } finally {
      setLoadingTokens(false);
    }
  };

  const callAdminFn = async (fnName, args) => {
    const { signTransaction } = await import('@stellar/freighter-api');
    const { rpc, TransactionBuilder, Contract } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(RPC_URL);
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(publicKey);
    let tx = new TransactionBuilder(account, { fee: '10000', networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call(fnName, ...args))
      .setTimeout(30)
      .build();
    const simulation = await server.simulateTransaction(tx);
    if (simulation.error) throw new Error(simulation.error);
    tx = rpc.assembleTransaction(tx, simulation).build();
    const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
    if (signError || !signedTxXdr) throw new Error(signError?.message || 'Signing failed');
    const { TransactionBuilder: TB } = await import('@stellar/stellar-sdk');
    return server.sendTransaction(TB.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
  };

  const handleAdd = async () => {
    if (!newToken.trim()) return;
    setSubmitting(true);
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const scToken = nativeToScVal(newToken.trim(), { type: 'address' });
      await callAdminFn('add_payment_token', [scToken]);
      addToast({ message: 'Token added successfully', type: 'success' });
      setNewToken('');
      await fetchTokens();
    } catch (err) {
      addToast({ message: `Failed to add token: ${err.message}`, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (token) => {
    setSubmitting(true);
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const scToken = nativeToScVal(token, { type: 'address' });
      await callAdminFn('remove_payment_token', [scToken]);
      addToast({ message: 'Token removed', type: 'success' });
      await fetchTokens();
    } catch (err) {
      addToast({ message: `Failed to remove token: ${err.message}`, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Accepted Payment Tokens</h3>

      {loadingTokens ? (
        <Spinner size="sm" label="Loading tokens…" />
      ) : (
        <ul className={styles.tokenList}>
          {tokens.length === 0 && <li className={styles.empty}>No tokens configured.</li>}
          {tokens.map((t) => (
            <li key={t} className={styles.tokenItem}>
              <span className={styles.tokenAddress} title={t}>{t}</span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleRemove(t)}
                disabled={submitting}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <Input
          id="new-token-input"
          placeholder="Token contract address (C…)"
          value={newToken}
          onChange={(e) => setNewToken(e.target.value)}
          disabled={submitting}
          className={styles.tokenInput}
        />
        <Button variant="primary" onClick={handleAdd} loading={submitting} disabled={!newToken.trim()}>
          Add Token
        </Button>
      </div>
    </div>
  );
}
