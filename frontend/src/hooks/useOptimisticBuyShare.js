import { useState, useCallback } from 'react';
import { getQueryData, setQueryData, invalidateQuery } from '../services/queryCache.js';

/**
 * Optimistic UI state reconciler hook for on-chain buy share mutations (#420)
 *
 * Requirements:
 * 1. Utilize onMutate to snapshot current cache state.
 * 2. Apply optimistic share balance to the UI instantly.
 * 3. Implement onError rollback to restore previous cache state.
 * 4. Success triggers background invalidation to fetch canonical on-chain state.
 */
export function useOptimisticBuyShare({ vaultId, userAddress, onExecuteTx } = {}) {
  const cacheKey = `vault:${vaultId || 'default'}:balance:${userAddress || 'anonymous'}`;

  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState(null);
  const [optimisticState, setOptimisticState] = useState(null);

  /**
   * Snapshot current cache state and apply optimistic update
   */
  const onMutate = useCallback((mutationPayload) => {
    const { amount = 1 } = mutationPayload || {};

    // 1. Snapshot current cache state
    const previousState = getQueryData(cacheKey) || {
      shares: 0,
      userWalletBalance: 0,
      availableShares: 1000,
    };

    // 2. Apply optimistic share balance instantly
    const nextShares = (previousState.shares || 0) + Number(amount);
    const nextAvailable = Math.max(0, (previousState.availableShares || 0) - Number(amount));

    const updatedState = {
      ...previousState,
      shares: nextShares,
      availableShares: nextAvailable,
      isOptimistic: true,
    };

    setQueryData(cacheKey, updatedState);
    setOptimisticState(updatedState);

    return { previousState };
  }, [cacheKey]);

  /**
   * Rollback cache state to previous snapshot on failure
   */
  const onErrorCallback = useCallback((err, mutationPayload, context) => {
    setError(err);
    if (context && context.previousState) {
      // Revert to original balance seamlessly
      setQueryData(cacheKey, context.previousState);
      setOptimisticState(context.previousState);
    }
  }, [cacheKey]);

  /**
   * Success triggers background invalidation to fetch true on-chain state
   */
  const onSuccessCallback = useCallback((data, mutationPayload, context) => {
    setError(null);
    // Background invalidation
    invalidateQuery(cacheKey);
  }, [cacheKey]);

  /**
   * Execute mutation with full optimistic lifecycle
   */
  const buySharesOptimistically = useCallback(async (mutationPayload) => {
    setIsMutating(true);
    setError(null);

    const context = onMutate(mutationPayload);

    try {
      let result;
      if (onExecuteTx) {
        result = await onExecuteTx(mutationPayload);
      } else {
        result = { success: true, txHash: '0x' + Math.random().toString(16).substring(2) };
      }

      onSuccessCallback(result, mutationPayload, context);
      setIsMutating(false);
      return result;
    } catch (err) {
      onErrorCallback(err, mutationPayload, context);
      setIsMutating(false);
      throw err;
    }
  }, [onMutate, onErrorCallback, onSuccessCallback, onExecuteTx]);

  return {
    buySharesOptimistically,
    onMutate,
    onError: onErrorCallback,
    onSuccess: onSuccessCallback,
    isMutating,
    error,
    optimisticState,
    cacheKey,
  };
}

export default useOptimisticBuyShare;
