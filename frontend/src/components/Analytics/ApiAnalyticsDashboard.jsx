// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import React, { useState, useEffect } from 'react';
import styles from './ApiAnalyticsDashboard.module.css';

export default function ApiAnalyticsDashboard({ apiKey = '', role = 'admin' }) {
  const [overview, setOverview] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        setLoading(true);
        const headers = { 'x-api-key': apiKey };
        const overviewRes = await fetch('/api/v1/analytics/overview', { headers });
        const overviewData = await overviewRes.json();
        setOverview(overviewData.data || null);

        const anomaliesRes = await fetch('/api/v1/analytics/anomalies', { headers });
        const anomaliesData = await anomaliesRes.json();
        setAnomalies(anomaliesData);

        const forecastRes = await fetch('/api/v1/analytics/capacity-forecast', { headers });
        const forecastData = await forecastRes.json();
        setForecast(forecastData);

        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, [apiKey]);

  const handleExport = (format) => {
    window.open(`/api/v1/analytics/export?format=${format}&role=${role}&x-api-key=${apiKey}`, '_blank');
  };

  if (loading) return <div className={styles.dashboard}>Loading API analytics dashboard...</div>;
  if (error) return <div className={styles.dashboard} style={{ color: '#f87171' }}>Error: {error}</div>;

  return (
    <div className={styles.dashboard}>
      <div className={styles.titleBar}>
        <h2>API Analytics & Performance Dashboard</h2>
        <div className={styles.exportGroup}>
          <button onClick={() => handleExport('json')} className={styles.btnExport}>Export JSON</button>
          <button onClick={() => handleExport('csv')} className={styles.btnExport}>Export CSV</button>
        </div>
      </div>

      {overview && (
        <div className={styles.metricsGrid}>
          <div className={styles.metricCard}>
            <div className={styles.metricTitle}>Total API Volume</div>
            <div className={styles.metricValue}>{overview.totalVolumeFormatted || '$0'}</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricTitle}>Total Transactions</div>
            <div className={styles.metricValue}>{overview.totalTransactions || 0}</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricTitle}>Active Monthly Users</div>
            <div className={styles.metricValue}>{overview.activeUsers?.month || 0}</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricTitle}>Avg Transaction Size</div>
            <div className={styles.metricValue}>{overview.averageTransactionSizeFormatted || '$0'}</div>
          </div>
        </div>
      )}

      {anomalies && (
        <div className={styles.section}>
          <h3>Anomaly Detection Insights</h3>
          {anomalies.anomaliesDetected ? (
            <div className={styles.anomalyBox}>
              ⚠️ <strong>{anomalies.anomalyCount} Anomaly Spike(s) Detected!</strong>
              <p>Z-Score exceedance threshold of 2.5 std-dev observed in request traffic pattern.</p>
            </div>
          ) : (
            <div style={{ color: '#4ade80' }}>✓ No unusual activity or traffic anomalies detected. System operating within normal thresholds.</div>
          )}
        </div>
      )}

      {forecast && (
        <div className={styles.section}>
          <h3>Predictive Capacity Planning</h3>
          <div className={styles.forecastBox}>
            📈 <strong>Projected 30-Day Growth Rate:</strong> {forecast.projectedGrowthRate}
            <div>Daily Volume Trend Slope: +{forecast.dailyTrendSlope}% per day</div>
          </div>
        </div>
      )}
    </div>
  );
}
