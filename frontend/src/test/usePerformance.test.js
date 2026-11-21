// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for frontend/src/hooks/usePerformance.js
 *
 * Covers:
 *  - trackOperation: delegates to measurePerformance, returns result
 *  - startTiming / endTiming: manual timing pair
 *  - scheduleIdleTask: requestIdleCallback / setTimeout fallback
 *  - scheduleFrame: requestAnimationFrame scheduling
 *  - reportTimeToInteractive: emits APP_METRIC
 *  - processInChunks: chunks array and processes all items
 *
 * Issue: #370 (Comprehensive Unit Test Coverage Expansion)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePerformance } from '../../hooks/usePerformance';
import { clearMetricsBuffer, getCollectedMetrics } from '../../services/performanceMonitoring';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('@sentry/react', () => ({
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn() })),
  captureMessage: vi.fn(),
  metrics: { set: vi.fn() },
}));

beforeEach(() => {
  clearMetricsBuffer();
  vi.clearAllMocks();
  import.meta.env.VITE_SENTRY_DSN = undefined;
  import.meta.env.VITE_API_URL = undefined;
});

afterEach(() => {
  clearMetricsBuffer();
});

// ─── trackOperation ───────────────────────────────────────────────────────────

describe('usePerformance.trackOperation', () => {
  it('returns the result of the wrapped function', async () => {
    const { result } = renderHook(() => usePerformance('TestComponent'));
    const retVal = await act(() => result.current.trackOperation('fetch', () => 42));
    expect(retVal).toBe(42);
  });

  it('resolves async functions', async () => {
    const { result } = renderHook(() => usePerformance('TestComponent'));
    const retVal = await act(() =>
      result.current.trackOperation('async-fetch', async () => 'async-result'),
    );
    expect(retVal).toBe('async-result');
  });

  it('propagates errors from the wrapped function', async () => {
    const { result } = renderHook(() => usePerformance('TestComponent'));
    await expect(
      act(() =>
        result.current.trackOperation('fail-op', () => {
          throw new Error('track-error');
        }),
      ),
    ).rejects.toThrow('track-error');
  });
});

// ─── startTiming / endTiming ──────────────────────────────────────────────────

describe('usePerformance.startTiming / endTiming', () => {
  it('endTiming adds a metric to the buffer', () => {
    const { result } = renderHook(() => usePerformance('TimingComponent'));
    act(() => {
      const start = result.current.startTiming('test-op');
      result.current.endTiming('test-op', start);
    });
    const appMetrics = getCollectedMetrics('APP_METRIC');
    expect(appMetrics.length).toBeGreaterThanOrEqual(1);
  });

  it('reported duration is non-negative', () => {
    const { result } = renderHook(() => usePerformance('TimingComponent'));
    act(() => {
      const start = result.current.startTiming('duration-check');
      result.current.endTiming('duration-check', start);
    });
    const metrics = getCollectedMetrics('APP_METRIC');
    metrics.forEach((m) => expect(m.value).toBeGreaterThanOrEqual(0));
  });
});

// ─── scheduleIdleTask ─────────────────────────────────────────────────────────

describe('usePerformance.scheduleIdleTask', () => {
  it('calls the task function eventually (setTimeout fallback)', async () => {
    // jsdom does not implement requestIdleCallback; it falls back to setTimeout
    const task = vi.fn();
    const { result } = renderHook(() => usePerformance('IdleComponent'));
    act(() => {
      result.current.scheduleIdleTask(task, 100);
    });
    // Advance fake timers if needed, or wait for next macrotask
    await new Promise((r) => setTimeout(r, 50));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('uses requestIdleCallback when available', () => {
    const mockRIC = vi.fn((cb) => { cb({ timeRemaining: () => 50, didTimeout: false }); return 1; });
    const originalRIC = globalThis.requestIdleCallback;
    globalThis.requestIdleCallback = mockRIC;

    const task = vi.fn();
    const { result } = renderHook(() => usePerformance('IdleRIC'));
    act(() => {
      result.current.scheduleIdleTask(task);
    });
    expect(mockRIC).toHaveBeenCalled();
    expect(task).toHaveBeenCalled();

    globalThis.requestIdleCallback = originalRIC;
  });
});

// ─── scheduleFrame ────────────────────────────────────────────────────────────

describe('usePerformance.scheduleFrame', () => {
  it('calls the callback via requestAnimationFrame', async () => {
    const callback = vi.fn();
    const { result } = renderHook(() => usePerformance('RAFComponent'));
    act(() => {
      result.current.scheduleFrame(callback);
    });
    // jsdom runs rAF callbacks synchronously in vi.useFakeTimers or
    // after a small wait in real timers
    await new Promise((r) => setTimeout(r, 50));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ─── reportTimeToInteractive ─────────────────────────────────────────────────

describe('usePerformance.reportTimeToInteractive', () => {
  it('adds an APP_METRIC entry to the buffer', () => {
    const { result } = renderHook(() => usePerformance('TTIComponent'));
    act(() => {
      result.current.reportTimeToInteractive('loaded');
    });
    const metrics = getCollectedMetrics('APP_METRIC');
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    expect(metrics.some((m) => m.label?.includes('tti'))).toBe(true);
  });

  it('uses default label "ready" when none is supplied', () => {
    const { result } = renderHook(() => usePerformance('TTIDefault'));
    act(() => {
      result.current.reportTimeToInteractive();
    });
    const metrics = getCollectedMetrics('APP_METRIC');
    expect(metrics.some((m) => m.label?.includes('ready'))).toBe(true);
  });
});

// ─── processInChunks ─────────────────────────────────────────────────────────

describe('usePerformance.processInChunks', () => {
  it('processes every item in the array', async () => {
    const items = Array.from({ length: 150 }, (_, i) => i);
    const processed = [];
    const { result } = renderHook(() => usePerformance('ChunkComponent'));

    await act(async () => {
      await result.current.processInChunks(items, (item) => processed.push(item), 50);
    });

    expect(processed.length).toBe(150);
    expect(processed).toEqual(items);
  });

  it('processes a small array in a single chunk', async () => {
    const items = [1, 2, 3];
    const processed = [];
    const { result } = renderHook(() => usePerformance('SmallChunk'));

    await act(async () => {
      await result.current.processInChunks(items, (i) => processed.push(i));
    });

    expect(processed).toEqual([1, 2, 3]);
  });

  it('handles an empty array without errors', async () => {
    const { result } = renderHook(() => usePerformance('EmptyChunk'));
    await expect(
      act(async () => {
        await result.current.processInChunks([], () => {});
      }),
    ).resolves.not.toThrow();
  });
});

// ─── Cleanup on unmount ───────────────────────────────────────────────────────

describe('usePerformance cleanup', () => {
  it('cancels pending idle callbacks on unmount', () => {
    const cancelMock = vi.fn();
    const originalCancelRIC = globalThis.cancelIdleCallback;
    const originalRIC = globalThis.requestIdleCallback;

    let capturedId = 1;
    globalThis.requestIdleCallback = vi.fn(() => capturedId++);
    globalThis.cancelIdleCallback = cancelMock;

    const { result, unmount } = renderHook(() => usePerformance('CleanupTest'));
    act(() => {
      // Schedule idle task but do NOT resolve it
      result.current.scheduleIdleTask(() => {});
    });
    unmount();
    expect(cancelMock).toHaveBeenCalled();

    globalThis.requestIdleCallback = originalRIC;
    globalThis.cancelIdleCallback = originalCancelRIC;
  });
});
