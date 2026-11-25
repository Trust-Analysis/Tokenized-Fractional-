import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePriceHistory } from '../hooks/usePriceHistory';

const DAY_MS = 24 * 60 * 60 * 1000;

// Price history is filtered by the selected range (default 1m), so fixtures are
// relative to now rather than fixed dates that would fall outside the window.
const daysAgoIso = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const pricePoint = (timestamp, price, volume = 10) => ({
  timestamp,
  price,
  volume,
  transactions: 1,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('usePriceHistory', () => {
  it('loads real price points from the backend API', async () => {
    const timestamp = daysAgoIso(2);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              timestamp,
              price: 12.5,
              volume: 25,
              transactions: 2,
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/rwa/C123/price-history?'));
    expect(result.current.priceData).toEqual([
      {
        date: new Date(timestamp).toISOString().split('T')[0],
        timestamp: new Date(timestamp).getTime(),
        price: 12.5,
        volume: 25,
        change: 0,
        changePercent: 0,
      },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('reports a loading state until the request settles', async () => {
    let resolveFetch;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.priceData).toEqual([]);

    await act(async () => {
      resolveFetch(jsonResponse({ data: [] }));
      await pending;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('surfaces the HTTP status as an error instead of inventing data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch price history (503)');
    expect(result.current.priceData).toEqual([]);
  });

  it('rejects a response without a data array', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ priceHistory: [] })));

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Invalid price history response');
    expect(result.current.priceData).toEqual([]);
  });

  it('renders an empty result without an error when no price points exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.priceData).toEqual([]);
    expect(result.current.allData).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.stats).toMatchObject({ latest: 0, changePercent: 0 });
  });

  it('does not expose a mock data generator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));

    const { result } = renderHook(() => usePriceHistory('C123', 'Test asset'));

    expect(result.current).not.toHaveProperty('generateMockData');

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('refetches when the asset changes instead of reusing the cached asset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [pricePoint(daysAgoIso(2), 10)],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [pricePoint(daysAgoIso(1), 20)],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ contractId }) => usePriceHistory(contractId, 'Test asset'),
      { initialProps: { contractId: 'C1' } },
    );

    await waitFor(() => expect(result.current.priceData[0]?.price).toBe(10));

    rerender({ contractId: 'C2' });

    await waitFor(() => expect(result.current.priceData[0]?.price).toBe(20));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/rwa/C2/price-history?');
  });

  it('refetch() bypasses the cache and requests fresh data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [pricePoint(daysAgoIso(2), 10)],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePriceHistory('C1', 'Test asset'));

    await waitFor(() => expect(result.current.cached).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
