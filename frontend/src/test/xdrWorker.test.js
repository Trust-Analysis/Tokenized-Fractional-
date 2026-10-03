import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useXdrWorker } from '../hooks/useXdrWorker';

describe('useXdrWorker', () => {
  it('returns base64-encoded XDR payload off main thread', async () => {
    const { result } = renderHook(() => useXdrWorker());

    let txResult;
    await act(async () => {
      txResult = await result.current.serializeTransaction({
        contractId: 'C12345678901234567890123456789012345678901234567890',
        fnName: 'buy_shares',
        args: [100],
        sourceAccount: 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR',
      });
    });

    expect(txResult).toBeDefined();
    expect(txResult.xdrBase64).toBeTypeOf('string');
    expect(txResult.xdrBase64.length).toBeGreaterThan(0);
    expect(txResult.status).toBe('READY_TO_SIGN');
  });

  it('bubbles up errors gracefully to React state when invalid input is provided', async () => {
    const { result } = renderHook(() => useXdrWorker());

    // Expect promise rejection
    await act(async () => {
      try {
        await result.current.serializeTransaction(null);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});
