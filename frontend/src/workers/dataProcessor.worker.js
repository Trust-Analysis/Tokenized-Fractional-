/**
 * Web Worker for Computationally Intensive Tasks
 * Processes chart data, price history aggregations, moving averages, 
 * and large dataset sorting/filtering off the main thread.
 */

self.onmessage = function (e) {
  const { taskId, type, payload } = e.data;

  try {
    let result;
    const startTime = performance.now();

    switch (type) {
      case 'PROCESS_CHART_DATA':
        result = processChartData(payload.data, payload.options);
        break;
      case 'CALCULATE_STATISTICS':
        result = calculateStatistics(payload.data);
        break;
      case 'FILTER_LARGE_DATASET':
        result = filterDataset(payload.data, payload.criteria);
        break;
      default:
        throw new Error(`Unknown task type: ${type}`);
    }

    const executionTime = performance.now() - startTime;

    self.postMessage({
      taskId,
      success: true,
      result,
      executionTime
    });
  } catch (error) {
    self.postMessage({
      taskId,
      success: false,
      error: error.message
    });
  }
};

/**
 * Heavy chart data processing and moving average calculation
 */
function processChartData(rawData, options = {}) {
  if (!Array.isArray(rawData)) return [];

  const sorted = [...rawData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const windowSize = options.movingAverageWindow || 5;
  
  return sorted.map((item, index, arr) => {
    let movingAvg = null;
    if (index >= windowSize - 1) {
      const slice = arr.slice(index - windowSize + 1, index + 1);
      const sum = slice.reduce((acc, curr) => acc + Number(curr.price || curr.value || 0), 0);
      movingAvg = sum / windowSize;
    }

    return {
      ...item,
      movingAverage: movingAvg ? Number(movingAvg.toFixed(4)) : null,
      normalizedPrice: Number(item.price || item.value || 0)
    };
  });
}

/**
 * Compute statistical metrics (Min, Max, Volatility, Mean)
 */
function calculateStatistics(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return { min: 0, max: 0, mean: 0, volatility: 0, count: 0 };
  }

  const values = data.map(d => Number(d.price || d.value || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const volatility = Math.sqrt(variance);

  return { min, max, mean: Number(mean.toFixed(4)), volatility: Number(volatility.toFixed(4)), count: values.length };
}

/**
 * Filter large datasets efficiently
 */
function filterDataset(data, criteria) {
  if (!Array.isArray(data)) return [];
  return data.filter(item => {
    for (const [key, val] of Object.entries(criteria)) {
      if (item[key] !== val) return false;
    }
    return true;
  });
}
