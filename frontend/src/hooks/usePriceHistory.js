import { useState, useCallback, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * usePriceHistory Hook
 *
 * Manages price history data for an asset
 * - Fetches historical price data from the backend API only; no synthetic data
 *   is generated, so an asset without recorded trades renders an empty state
 * - Caches the response per asset (contractId) to avoid unnecessary fetches
 * - Tracks loading and error states
 * - Supports filtering by time range
 */
export function usePriceHistory(contractId, assetName = '') {
  const [priceData, setPriceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('1m'); // 1m, 3m, 6m, 1y, all
  const [cached, setCached] = useState(false);

  // Per-asset cache: the contract id whose history is currently held in state.
  // Using a ref keeps the fetch callback stable, and keying by contract id means
  // switching assets always triggers a real fetch instead of reusing stale data.
  const cachedContractIdRef = useRef(null);
  // Monotonic request id so an in-flight response for a previous asset cannot
  // overwrite fresher data (or the error state) for the current one.
  const requestIdRef = useRef(0);

  /**
   * Filter data based on time range
   */
  const getFilteredData = useCallback((data, range) => {
    if (!data || data.length === 0) return [];
    if (range === 'all') return data;

    const now = new Date();
    const daysMap = {
      '1m': 30,
      '3m': 90,
      '6m': 180,
      '1y': 365,
    };

    const days = daysMap[range] || 30;
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return data.filter((item) => new Date(item.timestamp) >= cutoffDate);
  }, []);

  /**
   * Fetch price history data from the backend
   */
  const fetchPriceHistory = useCallback(
    async (force = false) => {
      if (!contractId) return;

      // Return cached data if this asset's history is already loaded and the
      // caller is not forcing a refresh.
      if (!force && cachedContractIdRef.current === contractId) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);

      try {
        const now = new Date();
        const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        const query = new URLSearchParams({
          from: from.toISOString(),
          to: now.toISOString(),
          resolution: 'day',
          limit: '500',
        });
        const response = await fetch(
          `${API_URL}/api/v1/rwa/${encodeURIComponent(contractId)}/price-history?${query}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch price history (${response.status})`);
        }

        const result = await response.json();
        if (!Array.isArray(result.data)) {
          throw new Error('Invalid price history response');
        }

        let previousPrice = null;
        const data = result.data.map((point) => {
          const price = Number(point.price);
          const timestamp = new Date(point.timestamp).getTime();
          const change = previousPrice === null ? 0 : price - previousPrice;
          const changePercent = previousPrice ? (change / previousPrice) * 100 : 0;
          previousPrice = price;
          return {
            date: new Date(timestamp).toISOString().split('T')[0],
            timestamp,
            price,
            volume: Number(point.volume),
            change: Math.round(change * 100) / 100,
            changePercent: Math.round(changePercent * 100) / 100,
          };
        });

        // A slower response for a previous asset must not replace the current one.
        if (requestId !== requestIdRef.current) return;

        cachedContractIdRef.current = contractId;
        setPriceData(data);
        setCached(true);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;

        setError(err.message || 'Failed to fetch price history');
        console.error('Error fetching price history:', err);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [contractId],
  );

  /**
   * Calculate statistics for the price data
   */
  const calculateStats = useCallback(
    (data = priceData) => {
      if (!data || data.length === 0) {
        return {
          min: 0,
          max: 0,
          avg: 0,
          latest: 0,
          earliest: 0,
          change: 0,
          changePercent: 0,
          high52w: 0,
          low52w: 0,
        };
      }

      const prices = data.map((d) => d.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
      const latest = prices[prices.length - 1];
      const earliest = prices[0];
      const change = Math.round((latest - earliest) * 100) / 100;
      const changePercent = Math.round(((latest - earliest) / earliest) * 10000) / 100;

      return {
        min,
        max,
        avg,
        latest,
        earliest,
        change,
        changePercent,
        high52w: max,
        low52w: min,
      };
    },
    [priceData],
  );

  /**
   * Format price for display
   */
  const formatPrice = useCallback(
    (price) =>
      `$${Number(price).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    [],
  );

  /**
   * Format percentage for display
   */
  const formatPercent = useCallback((percent) => {
    const formatted = Number(percent).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return percent >= 0 ? `+${formatted}%` : `${formatted}%`;
  }, []);

  // Fetch data on mount or when contractId changes. Clearing here (rather than
  // inside the fetch) keeps the previous asset's points visible during an
  // explicit refetch, but never shows one asset's history under another's name.
  useEffect(() => {
    if (!contractId) {
      cachedContractIdRef.current = null;
      setCached(false);
      setPriceData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setPriceData([]);
    fetchPriceHistory();
  }, [contractId, fetchPriceHistory]);

  // Get filtered data based on time range
  const filteredData = getFilteredData(priceData, timeRange);
  const stats = calculateStats(filteredData);

  return {
    // Data
    priceData: filteredData,
    allData: priceData,
    stats,

    // State
    loading,
    error,
    cached,

    // Controls
    timeRange,
    setTimeRange,
    refetch: () => fetchPriceHistory(true),

    // Utilities
    formatPrice,
    formatPercent,

    // Metadata
    assetName,
    contractId,
    dataPoints: filteredData.length,
    range: timeRange,
  };
}

export default usePriceHistory;
