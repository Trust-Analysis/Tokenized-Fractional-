import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeToScVal, Address, Contract, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { useWalletStore } from '../store/useWalletStore';
import { useSorobanRead, useSorobanWrite } from './useSoroban';
import useTransactionStatus from './useTransactionStatus';
import { usePendingTransaction } from './usePendingTransaction';
import {
  TX_CONFIRMED,
  TX_FAILED,
  TX_SUBMITTED,
  FAILED_FETCH_SHARE_BALANCE,
} from '../constants/errors';
import { toToastError } from '../lib/errorMapper';
import { API_URL, CONTRACT_ID, NETWORK_PASSPHRASE } from '../constants/app';

/**
 * Owns everything involved in buying shares: on-chain reads, the purchase
 * transaction, pending-transaction recovery, and confirmation notifications.
 */
export function useSharePurchase({
  publicKey,
  addToast,
  removeToast,
  networkMismatch,
  expectedNetworkLabel,
  recheckNetwork,
}) {
  const [buyAmount, setBuyAmount] = useState(1);
  const [lastTxHash, setLastTxHash] = useState(null);
  const [recoveringTx, setRecoveringTx] = useState(false);
  const [acceptedTokens, setAcceptedTokens] = useState([]);
  const [paymentToken, setPaymentToken] = useState('');

  const { shares, setShares } = useWalletStore();
  const txStatus = useTransactionStatus(lastTxHash);
  const pendingToastRef = useRef(null);
  const notifiedRef = useRef({});
  const lastPurchaseRef = useRef({ amount: null, timestamp: null });

  const { setPendingTx, clearPendingTx, hasPendingTx, checkPendingTxStatus } =
    usePendingTransaction();

  // ── On-chain reads ─────────────────────────────────────────────────────────
  const fetchSharesArgs = useMemo(() => {
    if (!publicKey) return [];
    try {
      return [nativeToScVal(publicKey, { type: 'address' })];
    } catch {
      return [];
    }
  }, [publicKey]);

  const { loading: loadingShares, refetch: fetchShares } = useSorobanRead(
    'get_shares',
    fetchSharesArgs,
    {
      skip: !publicKey || CONTRACT_ID.length < 50,
      onSuccess: (result) => {
        if (result?.retval) setShares(Number(result.retval.u32()));
      },
      onError: () => console.error(FAILED_FETCH_SHARE_BALANCE),
    },
  );

  // On-chain price per share. Read before the confirmation effect below, which
  // lists it as a dependency.
  const { data: priceData } = useSorobanRead('get_price', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const pricePerShare = priceData?.retval ? Number(priceData.retval.u64()) : null;

  const { data: availableSharesData } = useSorobanRead('get_available_shares', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const availableShares =
    availableSharesData?.retval != null ? Number(availableSharesData.retval.u32()) : null;

  const { data: totalSharesData } = useSorobanRead('get_total_shares', [], {
    skip: CONTRACT_ID.length < 50,
  });
  const totalShares = totalSharesData?.retval != null ? Number(totalSharesData.retval.u32()) : null;

  const buySharesTx = useSorobanWrite('buy_shares');
  const loadingBuy = buySharesTx.loading;

  // ── Accepted payment tokens ────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey || CONTRACT_ID.length < 50) return;

    (async () => {
      try {
        const server = new rpc.Server(
          import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443',
        );
        const contract = new Contract(CONTRACT_ID);
        const account = await server.getAccount(publicKey);
        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(contract.call('get_accepted_tokens'))
          .setTimeout(30)
          .build();
        const sim = await server.simulateTransaction(tx);
        if (sim.result?.retval) {
          const vec = sim.result.retval.vec();
          const list = vec ? vec.map((value) => Address.fromScVal(value).toString()) : [];
          setAcceptedTokens(list);
          if (list.length > 0) setPaymentToken(list[0]);
        }
      } catch {
        // Silently fall back — the buyer will use the default token.
      }
    })();
  }, [publicKey]);

  // ── Confirmation notifications ─────────────────────────────────────────────
  useEffect(() => {
    if (!lastTxHash || notifiedRef.current[lastTxHash]) return;

    if (txStatus === 'confirmed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: TX_CONFIRMED, type: 'success', txHash: lastTxHash });
      clearPendingTx();

      // Broadcast the purchase so other subscribers see it immediately.
      if (publicKey && lastPurchaseRef.current.amount && pricePerShare) {
        const totalCost = lastPurchaseRef.current.amount * pricePerShare;
        fetch(`${API_URL}/api/v1/notify/share-purchased`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contractId: CONTRACT_ID,
            buyerAddress: publicKey,
            sharesToBuy: lastPurchaseRef.current.amount,
            totalCost,
          }),
        }).catch((err) => console.error('Failed to broadcast share purchase:', err));
      }

      fetchShares();
    } else if (txStatus === 'failed') {
      notifiedRef.current[lastTxHash] = true;
      if (pendingToastRef.current) {
        removeToast(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      addToast({ message: TX_FAILED, type: 'error', txHash: lastTxHash });
      clearPendingTx();
    }
  }, [
    lastTxHash,
    txStatus,
    publicKey,
    pricePerShare,
    clearPendingTx,
    setPendingTx,
    fetchShares,
    addToast,
    removeToast,
  ]);

  // ── Pending transaction recovery (Issue #719) ──────────────────────────────
  useEffect(() => {
    if (!hasPendingTx || !publicKey || recoveringTx) return;

    const recoverTransaction = async () => {
      setRecoveringTx(true);
      try {
        const status = await checkPendingTxStatus();

        if (!status) {
          clearPendingTx();
          return;
        }

        if (status.status === 'confirmed') {
          addToast({
            message: 'Your previous transaction was confirmed! Refreshing your balance...',
            type: 'success',
            txHash: status.txHash,
          });
          setLastTxHash(status.txHash);
          clearPendingTx();
          fetchShares();
        } else if (status.status === 'failed') {
          addToast({
            message: 'Your previous transaction failed. You can try again.',
            type: 'error',
            txHash: status.txHash,
          });
          clearPendingTx();
        } else if (status.status === 'pending') {
          addToast({
            message:
              'Detecting a pending transaction from your previous session. Monitoring for confirmation...',
            type: 'warning',
            txHash: status.txHash,
          });
          setLastTxHash(status.txHash);
        } else {
          addToast({
            message:
              'Unable to determine the status of your previous transaction. You can try again.',
            type: 'warning',
          });
          clearPendingTx();
        }
      } catch (error) {
        console.error('Transaction recovery failed:', error);
        clearPendingTx();
      } finally {
        setRecoveringTx(false);
      }
    };

    recoverTransaction();
  }, [
    hasPendingTx,
    publicKey,
    recoveringTx,
    checkPendingTxStatus,
    clearPendingTx,
    fetchShares,
    addToast,
  ]);

  // ── Purchase ───────────────────────────────────────────────────────────────
  const handleBuyShares = useCallback(
    async (purchaseDetails) => {
      if (!publicKey) return;

      if (networkMismatch) {
        addToast({
          message: `Freighter is on the wrong network. Switch it to ${expectedNetworkLabel} and try again.`,
          type: 'error',
        });
        recheckNetwork();
        return;
      }

      if (hasPendingTx) {
        addToast({
          message:
            'You have a pending transaction. Please wait for it to complete before starting a new purchase.',
          type: 'error',
        });
        return;
      }

      setLastTxHash(null);
      try {
        const scValBuyer = nativeToScVal(publicKey, { type: 'address' });
        const scValShares = nativeToScVal(purchaseDetails.amount, { type: 'u32' });
        const scValToken = nativeToScVal(paymentToken, { type: 'address' });

        lastPurchaseRef.current = { amount: purchaseDetails.amount, timestamp: Date.now() };

        setPendingTx({
          txHash: null,
          amount: purchaseDetails.amount,
          contractId: CONTRACT_ID,
          publicKey,
        });

        const submitRes = await buySharesTx.execute([scValBuyer, scValShares, scValToken]);
        const { hash } = submitRes;
        setLastTxHash(hash);

        setPendingTx({
          txHash: hash,
          amount: purchaseDetails.amount,
          contractId: CONTRACT_ID,
          publicKey,
        });

        pendingToastRef.current = addToast({
          message: TX_SUBMITTED,
          type: 'pending',
          txHash: hash,
        });

        return { txHash: hash };
      } catch (err) {
        clearPendingTx();
        addToast(toToastError(err, { operation: 'buy_shares' }));
        throw err;
      }
    },
    [
      publicKey,
      networkMismatch,
      expectedNetworkLabel,
      recheckNetwork,
      hasPendingTx,
      paymentToken,
      buySharesTx,
      addToast,
      clearPendingTx,
      setPendingTx,
    ],
  );

  return {
    shares,
    loadingShares,
    buyAmount,
    setBuyAmount,
    loadingBuy,
    pricePerShare,
    availableShares,
    totalShares,
    acceptedTokens,
    paymentToken,
    setPaymentToken,
    hasPendingTx,
    recoveringTx,
    handleBuyShares,
  };
}

export default useSharePurchase;
