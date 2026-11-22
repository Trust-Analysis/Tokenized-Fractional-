import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePendingTransaction } from '../hooks/usePendingTransaction.js';

describe('Issue #719: Pending Transaction Recovery', () => {
  const mockPendingTx = {
    txHash: 'abc123def456',
    amount: 5,
    contractId: 'C...',
    publicKey: 'GABC123...',
  };

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
    // Mock console.error to avoid noise in test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists pending transaction marker in sessionStorage', () => {
    const { result } = renderHook(() => usePendingTransaction());

    act(() => {
      result.current.setPendingTx(mockPendingTx);
    });

    const stored = sessionStorage.getItem('pending_buy_shares_transaction');
    expect(stored).toBeTruthy();
    
    const parsed = JSON.parse(stored);
    expect(parsed.txHash).toBe(mockPendingTx.txHash);
    expect(parsed.amount).toBe(mockPendingTx.amount);
    expect(parsed.contractId).toBe(mockPendingTx.contractId);
    expect(parsed.publicKey).toBe(mockPendingTx.publicKey);
    expect(parsed.timestamp).toBeDefined();
  });

  it('loads pending transaction from sessionStorage on mount', async () => {
    // Pre-populate sessionStorage with a pending transaction
    sessionStorage.setItem(
      'pending_buy_shares_transaction',
      JSON.stringify({ ...mockPendingTx, timestamp: Date.now() })
    );

    const { result } = renderHook(() => usePendingTransaction());

    await waitFor(() => {
      expect(result.current.hasPendingTx).toBe(true);
    });

    expect(result.current.pendingTx.txHash).toBe(mockPendingTx.txHash);
    expect(result.current.pendingTx.amount).toBe(mockPendingTx.amount);
  });

  it('clears pending transaction from sessionStorage', () => {
    const { result } = renderHook(() => usePendingTransaction());

    act(() => {
      result.current.setPendingTx(mockPendingTx);
    });

    expect(sessionStorage.getItem('pending_buy_shares_transaction')).toBeTruthy();

    act(() => {
      result.current.clearPendingTx();
    });

    expect(sessionStorage.getItem('pending_buy_shares_transaction')).toBeNull();
    expect(result.current.hasPendingTx).toBe(false);
  });

  it('clears expired pending transactions (>30 minutes)', async () => {
    const expiredTx = {
      ...mockPendingTx,
      timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
    };

    sessionStorage.setItem(
      'pending_buy_shares_transaction',
      JSON.stringify(expiredTx)
    );

    const { result } = renderHook(() => usePendingTransaction());

    await waitFor(() => {
      expect(result.current.hasPendingTx).toBe(false);
    });

    expect(result.current.isExpired).toBe(true);
    expect(sessionStorage.getItem('pending_buy_shares_transaction')).toBeNull();
  });

  it('keeps recent pending transactions (<30 minutes)', async () => {
    const recentTx = {
      ...mockPendingTx,
      timestamp: Date.now() - 29 * 60 * 1000, // 29 minutes ago
    };

    sessionStorage.setItem(
      'pending_buy_shares_transaction',
      JSON.stringify(recentTx)
    );

    const { result } = renderHook(() => usePendingTransaction());

    await waitFor(() => {
      expect(result.current.hasPendingTx).toBe(true);
    });

    expect(result.current.isExpired).toBe(false);
    expect(result.current.pendingTx.txHash).toBe(mockPendingTx.txHash);
  });

  it('checks pending transaction status via RPC', async () => {
    const { result } = renderHook(() => usePendingTransaction());

    act(() => {
      result.current.setPendingTx(mockPendingTx);
    });

    // Since the hook uses dynamic import, we can't easily mock it in this test
    // Instead, we'll test that the function can be called and handles the response
    // The actual RPC integration would be tested in integration tests
    
    // This test verifies the function signature and basic behavior
    const status = await result.current.checkPendingTxStatus('https://mock-rpc-url');

    // If the RPC call fails (which it will with a mock URL), it should return unknown status
    expect(status).toEqual({
      txHash: mockPendingTx.txHash,
      status: 'unknown',
      timestamp: result.current.pendingTx.timestamp,
      amount: mockPendingTx.amount,
      contractId: mockPendingTx.contractId,
      error: expect.any(String),
    });
  });

  it('handles RPC errors gracefully when checking status', async () => {
    const { result } = renderHook(() => usePendingTransaction());

    act(() => {
      result.current.setPendingTx(mockPendingTx);
    });

    // Since the hook uses dynamic import, we can't easily mock it in this test
    // The function will try to connect to the mock URL and fail gracefully
    
    const status = await result.current.checkPendingTxStatus('https://mock-rpc-url');

    // Should return unknown status with error when RPC fails
    expect(status).toEqual({
      txHash: mockPendingTx.txHash,
      status: 'unknown',
      timestamp: result.current.pendingTx.timestamp,
      amount: mockPendingTx.amount,
      contractId: mockPendingTx.contractId,
      error: expect.any(String),
    });
  });

  it('simulates page reload with pending transaction', async () => {
    // Simulate setting a pending transaction
    const { result: firstRender, unmount } = renderHook(() => usePendingTransaction());

    act(() => {
      firstRender.current.setPendingTx(mockPendingTx);
    });

    expect(firstRender.current.hasPendingTx).toBe(true);

    // Simulate page reload by unmounting and remounting
    unmount();

    // Reload the hook (simulating page refresh)
    const { result: secondRender } = renderHook(() => usePendingTransaction());

    await waitFor(() => {
      expect(secondRender.current.hasPendingTx).toBe(true);
    });

    expect(secondRender.current.pendingTx.txHash).toBe(mockPendingTx.txHash);
    expect(secondRender.current.pendingTx.amount).toBe(mockPendingTx.amount);
  });

  it('prevents duplicate status checks', async () => {
    const { result } = renderHook(() => usePendingTransaction());

    act(() => {
      result.current.setPendingTx(mockPendingTx);
    });

    // Start first check
    const firstCheck = result.current.checkPendingTxStatus('https://mock-rpc-url');
    
    // Try to start second check immediately
    const secondCheck = result.current.checkPendingTxStatus('https://mock-rpc-url');

    const [firstResult, secondResult] = await Promise.all([firstCheck, secondCheck]);

    // The second check should return null because the first is in progress
    expect(firstResult).toBeTruthy();
    expect(secondResult).toBeNull();
  });

  it('handles corrupted sessionStorage data gracefully', async () => {
    sessionStorage.setItem('pending_buy_shares_transaction', 'invalid json');

    const { result } = renderHook(() => usePendingTransaction());

    await waitFor(() => {
      expect(result.current.hasPendingTx).toBe(false);
    });

    expect(sessionStorage.getItem('pending_buy_shares_transaction')).toBeNull();
  });
});
