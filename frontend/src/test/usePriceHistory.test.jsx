import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePriceHistory } from '../hooks/usePriceHistory';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePriceHistory', () => {
  it('loads real price points from the backend API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          timestamp: '2026-01-01T00:00:00.000Z',
          price: 12.5,
          volume: 25,
          transactions: 2,
        }],
      }),
    }));

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/rwa/C123/price-history?'));
    expect(result.current.priceData).toEqual([{
      date: '2026-01-01',
      timestamp: new Date('2026-01-01T00:00:00.000Z').getTime(),
      price: 12.5,
      volume: 25,
      change: 0,
      changePercent: 0,
    }]);
  });
});
