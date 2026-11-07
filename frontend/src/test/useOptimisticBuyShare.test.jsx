import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimisticBuyShare } from '../hooks/useOptimisticBuyShare.js';
import { getQueryData, setQueryData } from '../services/queryCache.js';

describe('Issue #420: Optimistic UI state reconcilers for on-chain mutations', () => {
  const vaultId = 'vault-101';
  const userAddress = 'GABC123';
  const cacheKey = `vault:${vaultId}:balance:${userAddress}`;

  beforeEach(() => {
    setQueryData(cacheKey, {
      shares: 10,
      availableShares: 90,
    });
  });

  it('updates UI state instantly upon clicking "Buy Share" using onMutate snapshot', () => {
    const { result } = renderHook(() => useOptimisticBuyShare({ vaultId, userAddress }));

    act(() => {
      result.current.onMutate({ amount: 5 });
    });

    const updatedCache = getQueryData(cacheKey);
    expect(updatedCache.shares).toBe(15);
    expect(updatedCache.availableShares).toBe(85);
    expect(updatedCache.isOptimistic).toBe(true);
  });

  it('reverts seamlessly to original balance if transaction is rejected (onError)', async () => {
    const failingTx = vi.fn().mockRejectedValue(new Error('Soroban transaction failed'));

    const { result } = renderHook(() =>
      useOptimisticBuyShare({ vaultId, userAddress, onExecuteTx: failingTx })
    );

    await act(async () => {
      try {
        await result.current.buySharesOptimistically({ amount: 5 });
      } catch (err) {
        expect(err.message).toBe('Soroban transaction failed');
      }
    });

    const rolledBackCache = getQueryData(cacheKey);
    expect(rolledBackCache.shares).toBe(10);
    expect(rolledBackCache.availableShares).toBe(90);
  });

  it('triggers background invalidation on transaction success', async () => {
    const successTx = vi.fn().mockResolvedValue({ success: true, txHash: '0xabc' });

    const { result } = renderHook(() =>
      useOptimisticBuyShare({ vaultId, userAddress, onExecuteTx: successTx })
    );

    await act(async () => {
      const res = await result.current.buySharesOptimistically({ amount: 5 });
      expect(res.txHash).toBe('0xabc');
    });

    // Invalidation clears cache to re-fetch canonical state
    const currentCache = getQueryData(cacheKey);
    expect(currentCache).toBeNull();
  });
});
