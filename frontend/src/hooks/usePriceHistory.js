import { useState, useCallback, useEffect } from 'react';

/**
 * usePriceHistory Hook
 * 
 * Manages price history data for an asset
 * - Fetches historical price data (supports real API or mock data)
 * - Caches data to avoid unnecessary fetches
 * - Tracks loading and error states
 * - Supports filtering by time range
 */
export function usePriceHistory(contractId, assetName = '') {
  const [priceData, setPriceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('1m'); // 1m, 3m, 6m, 1y, all
  const [cached, setCached] = useState(false);

  /**
   * Generate mock price history data for testing
   * Creates realistic price fluctuations over time
   */
  const generateMockData = useCallback((days = 30) => {
    const data = [];
    const basePrice = Math.random() * 5000 + 1000; // Random base price between 1000-6000
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);

      // Create realistic price fluctuation: ±5% per day
      const volatility = 0.05;
      const change = (Math.random() - 0.5) * 2 * volatility;
      const price = basePrice * (1 + change * (days - i) / days + Math.random() * volatility);

      data.push({
        date: date.toISOString().split('T')[0], // YYYY-MM-DD
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 1000 + 100), // Random volume
        change: Math.round((price - basePrice) * 100) / 100,
        changePercent: Math.round(((price - basePrice) / basePrice) * 10000) / 100,
      });
    }

    return data;
  }, []);

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

    return data.filter(item => new Date(item.timestamp) >= cutoffDate);
  }, []);

  /**
   * Fetch price history data
   * Currently uses mock data; can be replaced with real API call
   */
  const fetchPriceHistory = useCallback(async (force = false) => {
    // Return cached data if available and not forced
    if (cached && !force) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // TODO: Replace with real API call to backend
      // const response = await fetch(`/api/rwa/${contractId}/price-history`);
      // const data = await response.json();

      // For now, use mock data
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay

      const data = generateMockData(365); // Generate 1 year of data
      setPriceData(data);
      setCached(true);
    } catch (err) {
      setError(err.message || 'Failed to fetch price history');
      console.error('Error fetching price history:', err);
    } finally {
      setLoading(false);
    }
  }, [contractId, cached, generateMockData]);

  /**
   * Calculate statistics for the price data
   */
  const calculateStats = useCallback((data = priceData) => {
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

    const prices = data.map(d => d.price);
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
  }, [priceData]);

  /**
   * Format price for display
   */
  const formatPrice = useCallback((price) => {
    return `$${Number(price).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, []);

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

  // Fetch data on mount or when contractId changes
  useEffect(() => {
    if (contractId) {
      fetchPriceHistory();
    }
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
    generateMockData,

    // Metadata
    assetName,
    contractId,
    dataPoints: filteredData.length,
    range: timeRange,
  };
}

export default usePriceHistory;
