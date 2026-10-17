import React from 'react';
import Button from '../Button/Button';
import { useComparisonStore } from '../../store/useComparisonStore';
import styles from './AssetComparison.module.css';

/**
 * AssetComparison — displays a side-by-side comparison table for the selected assets.
 * Shown when the user has at least 2 assets in the comparison list.
 */
export default function AssetComparison() {
  const { comparedAssets, removeFromComparison, clearComparison } = useComparisonStore();

  // Empty state
  if (comparedAssets.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="8" height="18" rx="1" />
            <rect x="13" y="3" width="8" height="18" rx="1" />
          </svg>
        </div>
        <p className={styles.emptyTitle}>No assets selected for comparison</p>
        <p className={styles.emptySubtitle}>
          Check the <strong>Compare</strong> checkbox on any asset card to add it here.
        </p>
      </div>
    );
  }

  /**
   * Calculate advanced metrics for comparison analysis
   */
  const calculateMetrics = (asset) => {
    const shares = Number(asset.totalShares || 0);
    const available = Number(asset.availableShares || 0);
    const price = Number(asset.pricePerShare || 0);
    const valuation = asset.totalValuation
      ? Number(asset.totalValuation.replace(/[^0-9.-]/g, ''))
      : 0;

    const occupancyRate = shares > 0 ? (((shares - available) / shares) * 100).toFixed(1) : 0;
    const investmentCost = price * 10; // Cost to invest in 10 shares
    const valuePerShare = valuation > 0 && shares > 0 ? valuation / shares : 0;

    return {
      occupancyRate,
      investmentCost,
      valuePerShare,
      pricePerShare: price,
      totalShares: shares,
      availableShares: available,
    };
  };

  // Metrics to display in comparison rows
  const metrics = [
    {
      label: 'Asset Type',
      key: 'assetType',
      render: (v) => v || '—',
    },
    {
      label: 'Location',
      key: 'location',
      render: (v) => v || '—',
    },
    {
      label: 'Total Valuation',
      key: 'totalValuation',
      render: (v) => v || '—',
      highlight: true,
    },
    {
      label: 'Available Shares',
      key: 'availableShares',
      render: (v) => (v != null ? Number(v).toLocaleString() : '—'),
    },
    {
      label: 'Total Shares',
      key: 'totalShares',
      render: (v) => (v != null ? Number(v).toLocaleString() : '—'),
    },
    {
      label: 'Price / Share',
      key: 'pricePerShare',
      render: (v) =>
        v != null ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—',
      highlight: true,
    },
    {
      label: 'Occupancy Rate',
      key: 'occupancyRate',
      render: (v) => (v ? `${v}%` : '—'),
      compute: (asset) => calculateMetrics(asset).occupancyRate,
      tooltip: 'Percentage of shares already purchased',
    },
    {
      label: 'Cost (10 Shares)',
      key: 'investmentCost',
      render: (v) =>
        v ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—',
      compute: (asset) => calculateMetrics(asset).investmentCost,
      tooltip: 'Cost to purchase 10 shares',
    },
    {
      label: 'Value per Share',
      key: 'valuePerShare',
      render: (v) =>
        v ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—',
      compute: (asset) => calculateMetrics(asset).valuePerShare,
      highlight: true,
      tooltip: 'Total valuation divided by total shares',
    },
    {
      label: 'Contract ID',
      key: 'contractId',
      render: (v) =>
        v ? (
          <span className={styles.contractId} title={v}>
            {v.slice(0, 8)}…{v.slice(-6)}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.titleIcon}
              aria-hidden="true"
            >
              <rect x="3" y="3" width="8" height="18" rx="1" />
              <rect x="13" y="3" width="8" height="18" rx="1" />
            </svg>
            Asset Comparison
          </h2>
          <span className={styles.assetCount}>
            {comparedAssets.length} asset{comparedAssets.length !== 1 ? 's' : ''} selected
          </span>
        </div>
        <Button onClick={clearComparison} variant="danger" size="sm">
          Clear All
        </Button>
      </div>

      {/* Comparison table — scrolls horizontally on small screens */}
      <div className={styles.tableWrapper} role="region" aria-label="Asset comparison table">
        <table className={styles.table}>
          <thead>
            <tr>
              {/* Metric label column header */}
              <th className={styles.metricHeader} scope="col">
                Metric
              </th>
              {comparedAssets.map((asset) => (
                <th key={asset.contractId} className={styles.assetHeader} scope="col">
                  {asset.imageUrl ? (
                    <img
                      src={asset.imageUrl}
                      alt={asset.title}
                      className={styles.assetThumb}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.thumbPlaceholder} aria-hidden="true">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                  )}
                  <span className={styles.assetName}>{asset.title || 'Untitled Asset'}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeFromComparison(asset.contractId)}
                    aria-label={`Remove ${asset.title || 'asset'} from comparison`}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(({ label, key, render, highlight, compute, tooltip }) => (
              <tr key={key} className={highlight ? styles.highlightRow : ''}>
                <td className={styles.metricLabel} title={tooltip}>
                  {label}
                  {tooltip && (
                    <span
                      className={styles.tooltipIcon}
                      aria-label={`${label}: ${tooltip}`}
                      title={tooltip}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </span>
                  )}
                </td>
                {comparedAssets.map((asset) => {
                  const value = compute ? compute(asset) : asset[key];
                  return (
                    <td key={asset.contractId} className={styles.metricValue}>
                      {render(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Minimum assets hint */}
      {comparedAssets.length === 1 && (
        <p className={styles.hint}>Add at least one more asset to compare side-by-side.</p>
      )}
    </div>
  );
}
