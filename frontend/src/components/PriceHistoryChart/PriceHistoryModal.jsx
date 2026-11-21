import React, { useState } from 'react';
import PriceHistoryChart from './PriceHistoryChart';
import usePriceHistory from '../../hooks/usePriceHistory';
import styles from './PriceHistoryModal.module.css';

/**
 * PriceHistoryModal Component
 * 
 * Displays price history in a modal with full-screen chart
 * Allows users to view detailed price trends with various options
 */
export default function PriceHistoryModal({ isOpen, onClose, asset }) {
  const [chartType, setChartType] = useState('line');
  const {
    priceData,
    stats,
    loading,
    error,
    timeRange,
    setTimeRange,
    formatPrice,
    formatPercent,
  } = usePriceHistory(asset?.contractId, asset?.title);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleSection}>
            <h2 className={styles.title}>{asset?.title} - Price History</h2>
            <p className={styles.subtitle}>{asset?.location}</p>
          </div>
          <button className={styles.closeButton} onClick={handleClose} title="Close">
            ✕
          </button>
        </div>

        {/* Stats bar */}
        <div className={styles.statsBar}>
          <div className={styles.statCard}>
            <span className={styles.statCardLabel}>Current Price</span>
            <span className={styles.statCardValue}>{formatPrice(stats.latest)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statCardLabel}>52W High</span>
            <span className={styles.statCardValue}>{formatPrice(stats.high52w)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statCardLabel}>52W Low</span>
            <span className={styles.statCardValue}>{formatPrice(stats.low52w)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statCardLabel}>Average</span>
            <span className={styles.statCardValue}>{formatPrice(stats.avg)}</span>
          </div>
          <div className={`${styles.statCard} ${stats.changePercent >= 0 ? styles.positive : styles.negative}`}>
            <span className={styles.statCardLabel}>Change</span>
            <span className={styles.statCardValue}>{formatPercent(stats.changePercent)}</span>
          </div>
        </div>

        {/* Chart container */}
        <div className={styles.chartWrapper}>
          <PriceHistoryChart
            data={priceData}
            assetName={asset?.title}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            chartType={chartType}
            onChartTypeChange={setChartType}
            stats={stats}
            loading={loading}
            error={error}
            height={500}
          />
        </div>

        {/* Additional info */}
        <div className={styles.additionalInfo}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Asset Type:</span>
            <span className={styles.infoValue}>{asset?.assetType}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Contract ID:</span>
            <span className={styles.infoValue}>{asset?.contractId?.slice(0, 20)}...</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Total Valuation:</span>
            <span className={styles.infoValue}>{asset?.totalValuation}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Data Points:</span>
            <span className={styles.infoValue}>{priceData.length} records</span>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.secondaryButton} onClick={handleClose}>
            Close
          </button>
          <button className={styles.primaryButton} onClick={() => {
            // TODO: Add export functionality
            console.log('Export chart');
          }}>
            📥 Export Chart
          </button>
        </div>
      </div>
    </div>
  );
}
