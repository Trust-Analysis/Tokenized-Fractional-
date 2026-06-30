import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import styles from './PriceHistoryChart.module.css';

/**
 * PriceHistoryChart Component
 * 
 * Displays asset price history using Recharts
 * Supports multiple chart types: line, area, bar
 * Features: time range selection, statistics, custom tooltips
 */
export default function PriceHistoryChart({
  data = [],
  assetName = 'Asset',
  timeRange = '1m',
  onTimeRangeChange = () => {},
  chartType = 'line',
  onChartTypeChange = () => {},
  stats = {},
  loading = false,
  error = null,
  height = 400,
}) {
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading price history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>⚠️ Failed to load price history</p>
          <p className={styles.errorMessage}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.noData}>
          <p>No price history available for {assetName}</p>
        </div>
      </div>
    );
  }

  // Format Y-axis values
  const formatYAxis = (value) => `$${value.toFixed(0)}`;

  // Format X-axis dates based on data length
  const formatXAxis = (value) => {
    const date = new Date(value);
    if (data.length > 365) {
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    } else if (data.length > 90) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <div className={styles.tooltip}>
          <p className={styles.tooltipDate}>{new Date(data.timestamp).toLocaleDateString()}</p>
          <p className={styles.tooltipPrice}>Price: ${data.price.toFixed(2)}</p>
          {data.volume && <p className={styles.tooltipVolume}>Volume: {data.volume}</p>}
          {data.changePercent !== undefined && (
            <p className={`${styles.tooltipChange} ${data.changePercent >= 0 ? styles.positive : styles.negative}`}>
              Change: {data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // Determine stroke color based on price trend
  const getStrokeColor = () => {
    if (stats.change >= 0) return '#10b981';
    return '#ef4444';
  };

  const strokeColor = getStrokeColor();

  return (
    <div className={styles.container}>
      {/* Header with title and controls */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h3 className={styles.title}>{assetName} Price History</h3>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Current:</span>
              <span className={styles.statValue}>${stats.latest?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>High:</span>
              <span className={styles.statValue}>${stats.max?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Low:</span>
              <span className={styles.statValue}>${stats.min?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Avg:</span>
              <span className={styles.statValue}>${stats.avg?.toFixed(2) || 'N/A'}</span>
            </div>
            {stats.changePercent !== undefined && (
              <div className={`${styles.statItem} ${stats.changePercent >= 0 ? styles.positive : styles.negative}`}>
                <span className={styles.statLabel}>Change:</span>
                <span className={styles.statValue}>
                  {stats.changePercent >= 0 ? '+' : ''}{stats.changePercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Time range selector */}
        <div className={styles.controls}>
          <div className={styles.timeRangeButtons}>
            {['1m', '3m', '6m', '1y', 'all'].map(range => (
              <button
                key={range}
                className={`${styles.timeButton} ${timeRange === range ? styles.active : ''}`}
                onClick={() => onTimeRangeChange(range)}
              >
                {range === '1m' ? '1M' : ''}
                {range === '3m' ? '3M' : ''}
                {range === '6m' ? '6M' : ''}
                {range === '1y' ? '1Y' : ''}
                {range === 'all' ? 'ALL' : ''}
              </button>
            ))}
          </div>

          {/* Chart type selector */}
          <div className={styles.chartTypeButtons}>
            {['line', 'area', 'bar'].map(type => (
              <button
                key={type}
                className={`${styles.chartTypeButton} ${chartType === type ? styles.active : ''}`}
                onClick={() => onChartTypeChange(type)}
                title={`${type.charAt(0).toUpperCase() + type.slice(1)} Chart`}
              >
                {type === 'line' && '📈'}
                {type === 'area' && '📊'}
                {type === 'bar' && '📉'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartContainer} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={strokeColor} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={strokeColor} stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatXAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <YAxis
                tickFormatter={formatYAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={strokeColor}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPrice)"
                dot={false}
              />
            </AreaChart>
          ) : chartType === 'bar' ? (
            <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatXAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <YAxis
                tickFormatter={formatYAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="price"
                fill={strokeColor}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatXAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <YAxis
                tickFormatter={formatYAxis}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="price"
                stroke={strokeColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Footer with data info */}
      <div className={styles.footer}>
        <p className={styles.dataInfo}>
          Showing {data.length} data point{data.length !== 1 ? 's' : ''} • {timeRange.toUpperCase()}
        </p>
      </div>
    </div>
  );
}
