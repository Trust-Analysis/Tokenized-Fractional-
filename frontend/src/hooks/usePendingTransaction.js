import { useState, useEffect, useCallback, useRef } from 'react';

const PENDING_TX_KEY = 'pending_buy_shares_transaction';
const TX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes timeout for pending transactions

/**
 * usePendingTransaction — Hook for managing pending transaction state
 * across page refreshes and navigation.
 *
 * This hook provides a recovery mechanism for transactions that may be
 * in-flight when the user refreshes the browser or navigates away. It
 * persists minimal transaction state in sessionStorage and provides
 * recovery information on page load.
 *
 * Features:
 * - Persists pending transaction details in sessionStorage
 * - Checks for pending transactions on page load
 * - Automatically clears expired pending transactions (>30 min)
 * - Provides transaction recovery status and details
 * - Clears pending marker when transaction is confirmed/failed
 *
 * Usage:
 *   const {
 *     pendingTx,
 *     setPendingTx,
 *     clearPendingTx,
 *     hasPendingTx,
 *     isExpired,
 *     checkPendingTxStatus
 *   } = usePendingTransaction();
 */

export function usePendingTransaction() {
  const [pendingTx, setPendingTxState] = useState(null);
  const [isExpired, setIsExpired] = useState(false);
  const checkInProgressRef = useRef(false);

  // Load pending transaction from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PENDING_TX_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        const age = now - parsed.timestamp;

        // Check if transaction has expired (>30 minutes)
        if (age > TX_TIMEOUT_MS) {
          sessionStorage.removeItem(PENDING_TX_KEY);
          setIsExpired(true);
          setPendingTxState(null);
        } else {
          setPendingTxState(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load pending transaction:', error);
      sessionStorage.removeItem(PENDING_TX_KEY);
    }
  }, []);

  // Set pending transaction in sessionStorage
  const setPendingTx = useCallback((txData) => {
    try {
      const data = {
        ...txData,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(PENDING_TX_KEY, JSON.stringify(data));
      setPendingTxState(data);
      setIsExpired(false);
    } catch (error) {
      console.error('Failed to save pending transaction:', error);
    }
  }, []);

  // Clear pending transaction from sessionStorage
  const clearPendingTx = useCallback(() => {
    try {
      sessionStorage.removeItem(PENDING_TX_KEY);
      setPendingTxState(null);
      setIsExpired(false);
    } catch (error) {
      console.error('Failed to clear pending transaction:', error);
    }
  }, []);

  // Check if there's a pending transaction
  const hasPendingTx = pendingTx !== null;

  // Check pending transaction status via RPC
  const checkPendingTxStatus = useCallback(async (rpcUrl) => {
    if (!hasPendingTx || checkInProgressRef.current) {
      return null;
    }

    checkInProgressRef.current = true;

    try {
      const { rpc } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(rpcUrl || import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443');

      if (pendingTx.txHash) {
        const result = await server.getTransaction(pendingTx.txHash);
        
        return {
          txHash: pendingTx.txHash,
          status: result.status === 'SUCCESS' ? 'confirmed' : 
                 result.status === 'FAILED' || result.errorResult ? 'failed' : 'pending',
          timestamp: pendingTx.timestamp,
          amount: pendingTx.amount,
          contractId: pendingTx.contractId,
        };
      }
    } catch (error) {
      console.error('Failed to check pending transaction status:', error);
      return {
        txHash: pendingTx.txHash,
        status: 'unknown',
        timestamp: pendingTx.timestamp,
        amount: pendingTx.amount,
        contractId: pendingTx.contractId,
        error: error.message,
      };
    } finally {
      checkInProgressRef.current = false;
    }

    return null;
  }, [hasPendingTx, pendingTx]);

  return {
    pendingTx,
    setPendingTx,
    clearPendingTx,
    hasPendingTx,
    isExpired,
    checkPendingTxStatus,
  };
}

export default usePendingTransaction;
