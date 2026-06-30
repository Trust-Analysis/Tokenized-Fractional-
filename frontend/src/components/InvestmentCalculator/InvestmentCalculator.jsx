// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import React, { useState, useMemo } from 'react';
import Card from '../Card/Card';
import styles from './InvestmentCalculator.module.css';

/** Stroops per XLM */
const STROOP = 10_000_000;

/**
 * Format a stroops value as XLM with 2 decimal places.
 * @param {number} stroops
 * @returns {string}
 */
function xlm(stroops) {
  return (stroops / STROOP).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a plain number as a currency string (USD-style).
 * @param {number} value
 * @returns {string}
 */
function usd(value) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Clamp a number to [min, max].
 */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * InvestmentCalculator
 *
 * Shows projected returns based on share count, price per share (in stroops),
 * hypothetical annual appreciation rate, and a holding period.
 *
 * Props:
 *   pricePerShare  {number|null}  — price in stroops (passed from contract)
 *   assetTitle     {string}       — displayed in the heading
 *   totalShares    {number|null}  — used to clamp max share count
 *   availableShares {number|null} — used to show a warning when over-purchasing
 */
export default function InvestmentCalculator({
  pricePerShare = null,
  assetTitle = 'Asset',
  totalShares = null,
  availableShares = null,
}) {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  const [shares, setShares] = useState(1);
  const [appreciationRate, setAppreciationRate] = useState(8); // % per year
  const [years, setYears] = useState(5);

  // ── Derived calculations ─────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const price = pricePerShare ?? 0;
    const safeShares = Math.max(1, shares);

    // Initial investment in stroops, then converted to XLM
    const initialInvestmentStroops = price * safeShares;
    const initialInvestmentXlm = initialInvestmentStroops / STROOP;

    // Assume 1 XLM ≈ $0.15 USD for illustration only.
    // This is clearly labelled as hypothetical in the UI.
    const xlmToUsd = 0.15;
    const initialInvestmentUsd = initialInvestmentXlm * xlmToUsd;

    // Compound annual growth: FV = PV × (1 + r)^n
    const r = appreciationRate / 100;
    const n = Math.max(1, years);
    const projectedValueUsd = initialInvestmentUsd * Math.pow(1 + r, n);
    const gainUsd = projectedValueUsd - initialInvestmentUsd;
    const gainPct = initialInvestmentUsd > 0
      ? ((gainUsd / initialInvestmentUsd) * 100)
      : 0;

    // Annualised return breakdown (year-by-year table — capped at 10 rows)
    const displayYears = Math.min(n, 10);
    const yearlyData = Array.from({ length: displayYears }, (_, i) => {
      const yr = i + 1;
      const value = initialInvestmentUsd * Math.pow(1 + r, yr);
      const gain  = value - initialInvestmentUsd;
      return { year: yr, value, gain };
    });

    return {
      initialInvestmentStroops,
      initialInvestmentXlm,
      initialInvestmentUsd,
      projectedValueUsd,
      gainUsd,
      gainPct,
      yearlyData,
      xlmToUsd,
    };
  }, [pricePerShare, shares, appreciationRate, years]);

  // Edge case: price not yet loaded
  const priceNotLoaded = pricePerShare == null || pricePerShare <= 0;

  const maxShares = totalShares ?? 10_000;
  const overAvailable = availableShares != null && shares > availableShares;

  return (
    <Card>
      <div className={styles.header}>
        <svg
          className={styles.headerIcon}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        <h3 className={styles.title}>Investment Calculator</h3>
      </div>

      <p className={styles.disclaimer}>
        Hypothetical projections only — not financial advice. XLM price assumed at $0.15 USD for illustration.
      </p>

      {priceNotLoaded && (
        <p className={styles.notice}>
          Share price not yet available. Enter a custom share count to estimate once the price loads.
        </p>
      )}

      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <div className={styles.inputs}>
        {/* Number of shares */}
        <div className={styles.field}>
          <label htmlFor="calc-shares" className={styles.label}>
            Number of shares
          </label>
          <input
            id="calc-shares"
            type="number"
            className={styles.input}
            value={shares}
            min={1}
            max={maxShares}
            step={1}
            onChange={e => setShares(clamp(Number(e.target.value), 1, maxShares))}
          />
          {overAvailable && (
            <span className={styles.warning}>
              Only {availableShares.toLocaleString()} shares available
            </span>
          )}
        </div>

        {/* Price per share — read-only, sourced from the contract */}
        <div className={styles.field}>
          <label className={styles.label}>Price per share</label>
          <div className={styles.readOnly}>
            {priceNotLoaded ? '—' : `${xlm(pricePerShare)} XLM`}
          </div>
        </div>

        {/* Annual appreciation rate */}
        <div className={styles.field}>
          <label htmlFor="calc-rate" className={styles.label}>
            Annual appreciation (%)
          </label>
          <div className={styles.sliderRow}>
            <input
              id="calc-rate"
              type="range"
              className={styles.slider}
              value={appreciationRate}
              min={1}
              max={50}
              step={1}
              onChange={e => setAppreciationRate(Number(e.target.value))}
              aria-valuetext={`${appreciationRate}%`}
            />
            <span className={styles.sliderValue}>{appreciationRate}%</span>
          </div>
        </div>

        {/* Holding period */}
        <div className={styles.field}>
          <label htmlFor="calc-years" className={styles.label}>
            Holding period (years)
          </label>
          <div className={styles.sliderRow}>
            <input
              id="calc-years"
              type="range"
              className={styles.slider}
              value={years}
              min={1}
              max={30}
              step={1}
              onChange={e => setYears(Number(e.target.value))}
              aria-valuetext={`${years} years`}
            />
            <span className={styles.sliderValue}>{years} yr{years !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Initial investment</span>
          <span className={styles.summaryValue}>
            {xlm(calc.initialInvestmentStroops)} XLM
          </span>
          <span className={styles.summarySubValue}>
            ≈ ${usd(calc.initialInvestmentUsd)}
          </span>
        </div>

        <div className={`${styles.summaryCard} ${styles.summaryCardAccent}`}>
          <span className={styles.summaryLabel}>Projected value ({years} yr{years !== 1 ? 's' : ''})</span>
          <span className={styles.summaryValue}>
            ${usd(calc.projectedValueUsd)}
          </span>
          <span className={styles.summarySubValue}>
            at {appreciationRate}%/yr
          </span>
        </div>

        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Projected gain</span>
          <span className={`${styles.summaryValue} ${calc.gainUsd >= 0 ? styles.gain : styles.loss}`}>
            {calc.gainUsd >= 0 ? '+' : ''}${usd(calc.gainUsd)}
          </span>
          <span className={styles.summarySubValue}>
            {calc.gainPct >= 0 ? '+' : ''}{usd(calc.gainPct)}% total return
          </span>
        </div>
      </div>

      {/* ── Year-by-year table ─────────────────────────────────────────────── */}
      {calc.yearlyData.length > 0 && (
        <div className={styles.tableWrapper}>
          <h4 className={styles.tableTitle}>Year-by-year breakdown</h4>
          <table className={styles.table} aria-label="Projected value by year">
            <thead>
              <tr>
                <th className={styles.th} scope="col">Year</th>
                <th className={styles.th} scope="col">Projected value</th>
                <th className={styles.th} scope="col">Total gain</th>
              </tr>
            </thead>
            <tbody>
              {calc.yearlyData.map(row => (
                <tr key={row.year} className={styles.tr}>
                  <td className={styles.td}>{row.year}</td>
                  <td className={styles.td}>${usd(row.value)}</td>
                  <td className={`${styles.td} ${styles.gain}`}>
                    +${usd(row.gain)}
                  </td>
                </tr>
              ))}
              {years > 10 && (
                <tr className={styles.tr}>
                  <td className={styles.tdMuted} colSpan={3}>
                    … showing first 10 of {years} years
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
