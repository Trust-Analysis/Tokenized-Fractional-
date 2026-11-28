/**
 * PriceRangeFilter — Issue #373
 *
 * A dual-range (min / max) slider for filtering marketplace assets by price.
 *
 * Props:
 *  - min         {number}   Absolute minimum value (derived from all assets)
 *  - max         {number}   Absolute maximum value (derived from all assets)
 *  - value       {[number, number]}  Current [minSelected, maxSelected]
 *  - onChange    {Function} Called with [newMin, newMax] when either thumb moves
 *  - onClear     {Function} Called when the "Clear Filters" button is clicked
 *  - formatPrice {Function} Optional — formats a numeric price for display
 */
import React, { useId } from 'react';
import styles from './PriceRangeFilter.module.css';

const defaultFormat = (n) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M XLM`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}K XLM`
    : `${n} XLM`;

export default function PriceRangeFilter({
  min = 0,
  max = 10_000,
  value,
  onChange,
  onClear,
  formatPrice = defaultFormat,
}) {
  const [selectedMin, selectedMax] = value ?? [min, max];
  const idMin = useId();
  const idMax = useId();

  const range = max - min || 1; // avoid division by zero

  const handleMinChange = (e) => {
    const next = Math.min(Number(e.target.value), selectedMax);
    onChange([next, selectedMax]);
  };

  const handleMaxChange = (e) => {
    const next = Math.max(Number(e.target.value), selectedMin);
    onChange([selectedMin, next]);
  };

  const isActive = selectedMin !== min || selectedMax !== max;

  // Percentage offsets for the filled track overlay
  const leftPct = ((selectedMin - min) / range) * 100;
  const rightPct = 100 - ((selectedMax - min) / range) * 100;

  return (
    <aside className={styles.sidebar} aria-label="Price range filter">
      <div className={styles.header}>
        <h3 className={styles.title}>Filter by Price</h3>
        {isActive && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={onClear}
            aria-label="Clear price range filter"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Selected range display */}
      <div className={styles.rangeDisplay} aria-live="polite" aria-atomic="true">
        <span className={styles.rangeValue}>{formatPrice(selectedMin)}</span>
        <span className={styles.rangeSep}>–</span>
        <span className={styles.rangeValue}>{formatPrice(selectedMax)}</span>
      </div>

      {/* Dual-range slider */}
      <div className={styles.sliderWrapper}>
        {/* Coloured track fill */}
        <div
          className={styles.trackFill}
          style={{ left: `${leftPct}%`, right: `${rightPct}%` }}
          aria-hidden="true"
        />

        {/* Min thumb */}
        <input
          id={idMin}
          type="range"
          className={`${styles.thumb} ${styles.thumbMin}`}
          min={min}
          max={max}
          step={1}
          value={selectedMin}
          onChange={handleMinChange}
          aria-label="Minimum price"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={selectedMin}
          aria-valuetext={formatPrice(selectedMin)}
        />

        {/* Max thumb */}
        <input
          id={idMax}
          type="range"
          className={`${styles.thumb} ${styles.thumbMax}`}
          min={min}
          max={max}
          step={1}
          value={selectedMax}
          onChange={handleMaxChange}
          aria-label="Maximum price"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={selectedMax}
          aria-valuetext={formatPrice(selectedMax)}
        />
      </div>

      {/* Min / Max labels */}
      <div className={styles.labels}>
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
    </aside>
  );
}
