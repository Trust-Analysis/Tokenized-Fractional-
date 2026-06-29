import { useState, useEffect, useRef, useCallback } from 'react';

const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const POLL_INTERVAL = 2000;

export default function useTransactionStatus(txHash) {
  const [status, setStatus] = useState('idle');
  const timerRef = useRef(null);
  const serverRef = useRef(null);

  useEffect(() => {
    import('@stellar/stellar-sdk').then(({ rpc }) => {
      serverRef.current = new rpc.Server(RPC_URL);
    });
  }, []);

  const poll = useCallback(async () => {
    if (!serverRef.current || !txHash) return;

    try {
      const result = await serverRef.current.getTransaction(txHash);
      if (result.status === 'SUCCESS') {
        setStatus('confirmed');
        return;
      }
      if (result.status === 'FAILED' || result.errorResult) {
        setStatus('failed');
        return;
      }
      setStatus('pending');
    } catch {
      setStatus('pending');
    }
  }, [txHash]);

  useEffect(() => {
    if (!txHash) {
      setStatus('idle');
      return;
    }

    if (import.meta.env.VITE_MOCK_WALLET === 'true') {
      setStatus('pending');
      const timer = setTimeout(() => {
        setStatus('confirmed');
      }, 1500);
      return () => clearTimeout(timer);
    }

    setStatus('pending');
    poll();

    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [txHash, poll]);

  return status;
}
