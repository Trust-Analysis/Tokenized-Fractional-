import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Badge from '../Badge/Badge';
import Button from '../Button/Button';
import Input from '../Input/Input';
import { formatOrderTimestamp, getSafeLocale } from '../../utils/i18nFormatters';
import styles from './TransactionHistoryDashboard.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STELLAR_EXPLORER_BASE = 'https://stellar.expert/explorer/testnet/tx/';
const ROWS_PER_PAGE = 10;
const POLL_INTERVAL_MS = 15000;

const TX_TYPES = ['buy_shares', 'sell_shares', 'transfer', 'payment'];
const TX_STATUSES = ['confirmed', 'pending', 'failed'];
const ASSETS = ['USDC', 'XLM', 'REIT-A', 'REIT-B', 'PROP-NYC', 'PROP-LA', 'BOND-2026'];

// ---------------------------------------------------------------------------
// Mock data generator
// ---------------------------------------------------------------------------
function randomHex(length) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function randomAddress() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = 'G';
  for (let i = 0; i < 55; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateMockTransactions(publicKey) {
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const transactions = [];

  // Use a seeded-ish deterministic shuffle so data is stable per publicKey
  const seed = publicKey ? publicKey.charCodeAt(1) || 42 : 42;

  for (let i = 0; i < 35; i++) {
    const type = TX_TYPES[(i + seed) % TX_TYPES.length];
    const status = i < 3 ? 'pending' : TX_STATUSES[Math.floor(((i * 7 + seed) % 10) / 10 * 3)];
    const resolvedStatus = status === undefined ? 'confirmed' : status;
    const isBuy = type === 'buy_shares';
    const asset = ASSETS[(i + seed) % ASSETS.length];
    const amount = parseFloat((Math.random() * 9900 + 100).toFixed(7));
    const fee = parseFloat((Math.random() * 0.005 + 0.0001).toFixed(7));
    const shares = type === 'buy_shares' || type === 'sell_shares'
      ? Math.floor(Math.random() * 50) + 1
      : null;
    const offsetMs = Math.floor(Math.random() * ninetyDaysMs);
    const timestamp = new Date(now - offsetMs).toISOString();

    transactions.push({
      id: `tx-${i + 1}`,
      hash: randomHex(64),
      type,
      asset,
      amount,
      fee,
      status: resolvedStatus,
      timestamp,
      fromAddress: isBuy && publicKey ? publicKey : randomAddress(),
      toAddress: randomAddress(),
      shares,
    });
  }

  // Sort by timestamp descending (newest first)
  transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return transactions;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatTimestamp(isoString) {
  return formatOrderTimestamp(isoString, undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAmount(amount) {
  try {
    return new Intl.NumberFormat(getSafeLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    }).format(amount);
  }
}

function formatTypeLabel(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncateHash(hash) {
  if (!hash) return '';
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function toDateInputValue(isoString) {
  return isoString ? isoString.slice(0, 10) : '';
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function exportCSV(transactions) {
  const headers = [
    'ID', 'Hash', 'Type', 'Asset', 'Amount', 'Fee',
    'Status', 'Timestamp', 'From Address', 'To Address', 'Shares',
  ];
  const rows = transactions.map((tx) => [
    tx.id,
    tx.hash,
    tx.type,
    tx.asset,
    tx.amount,
    tx.fee,
    tx.status,
    tx.timestamp,
    tx.fromAddress,
    tx.toAddress,
    tx.shares ?? '',
  ]);
  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    )
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rwa-transactions-${dateStr}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------
function computeStats(transactions) {
  const total = transactions.length;
  const confirmed = transactions.filter((tx) => tx.status === 'confirmed').length;
  const successRate = total > 0 ? ((confirmed / total) * 100).toFixed(1) : '0.0';
  const totalFees = transactions.reduce((sum, tx) => sum + tx.fee, 0);
  const totalVolume = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  return { total, successRate, totalFees, totalVolume };
}

// ---------------------------------------------------------------------------
// Week bucket helpers for the chart
// ---------------------------------------------------------------------------
function getWeekBuckets() {
  const now = new Date();
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const label = weekStart.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    buckets.push({ start: weekStart, end: weekEnd, label, confirmed: 0, pending: 0, failed: 0 });
  }
  return buckets;
}

function buildChartData(transactions) {
  const buckets = getWeekBuckets();
  transactions.forEach((tx) => {
    const ts = new Date(tx.timestamp);
    const bucket = buckets.find((b) => ts >= b.start && ts < b.end);
    if (bucket) {
      if (tx.status === 'confirmed') bucket.confirmed += 1;
      else if (tx.status === 'pending') bucket.pending += 1;
      else if (tx.status === 'failed') bucket.failed += 1;
    }
  });
  return buckets;
}

// ---------------------------------------------------------------------------
// SVG Bar Chart sub-component
// ---------------------------------------------------------------------------
function WeeklyBarChart({ transactions }) {
  const data = useMemo(() => buildChartData(transactions), [transactions]);

  const chartHeight = 120;
  const labelHeight = 18;
  const barAreaHeight = chartHeight - labelHeight;
  const maxCount = Math.max(...data.map((b) => b.confirmed + b.pending + b.failed), 1);

  // We use a viewBox approach: 800 wide, chartHeight+labelHeight tall
  const svgWidth = 800;
  const bucketWidth = svgWidth / data.length;
  const barGroupWidth = bucketWidth * 0.7;
  const barWidth = barGroupWidth / 3;
  const gapX = (bucketWidth - barGroupWidth) / 2;

  return (
    <div className={styles.chartContainer} aria-label="Weekly transaction chart">
      <svg
        viewBox={`0 0 ${svgWidth} ${chartHeight + labelHeight}`}
        preserveAspectRatio="none"
        className={styles.chartSvg}
        role="img"
        aria-label="Bar chart showing transaction counts per week"
      >
        {data.map((bucket, i) => {
          const x = i * bucketWidth;
          const confirmedH = (bucket.confirmed / maxCount) * barAreaHeight;
          const pendingH = (bucket.pending / maxCount) * barAreaHeight;
          const failedH = (bucket.failed / maxCount) * barAreaHeight;

          return (
            <g key={bucket.label}>
              {/* Confirmed bar */}
              {bucket.confirmed > 0 && (
                <rect
                  x={x + gapX}
                  y={barAreaHeight - confirmedH}
                  width={barWidth}
                  height={confirmedH}
                  fill="var(--primary)"
                  opacity="0.85"
                  rx="2"
                >
                  <title>{`${bucket.label}: ${bucket.confirmed} confirmed`}</title>
                </rect>
              )}
              {/* Pending bar */}
              {bucket.pending > 0 && (
                <rect
                  x={x + gapX + barWidth + 1}
                  y={barAreaHeight - pendingH}
                  width={barWidth}
                  height={pendingH}
                  fill="var(--warning)"
                  opacity="0.85"
                  rx="2"
                >
                  <title>{`${bucket.label}: ${bucket.pending} pending`}</title>
                </rect>
              )}
              {/* Failed bar */}
              {bucket.failed > 0 && (
                <rect
                  x={x + gapX + (barWidth + 1) * 2}
                  y={barAreaHeight - failedH}
                  width={barWidth}
                  height={failedH}
                  fill="var(--error)"
                  opacity="0.85"
                  rx="2"
                >
                  <title>{`${bucket.label}: ${bucket.failed} failed`}</title>
                </rect>
              )}
              {/* Week label */}
              <text
                x={x + bucketWidth / 2}
                y={chartHeight + labelHeight - 2}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
              >
                {bucket.label}
              </text>
            </g>
          );
        })}
        {/* Baseline */}
        <line
          x1={0}
          y1={barAreaHeight}
          x2={svgWidth}
          y2={barAreaHeight}
          stroke="var(--border-color)"
          strokeWidth="1"
        />
      </svg>
      {/* Legend */}
      <div className={styles.chartLegend}>
        <span className={styles.legendConfirmed}>● Confirmed</span>
        <span className={styles.legendPending}>● Pending</span>
        <span className={styles.legendFailed}>● Failed</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort arrow indicator
// ---------------------------------------------------------------------------
function SortArrow({ direction }) {
  if (!direction) {
    return (
      <svg className={styles.sortArrow} viewBox="0 0 10 14" aria-hidden="true">
        <path d="M5 1 L8 5 H2 Z" fill="var(--text-muted)" opacity="0.4" />
        <path d="M5 13 L2 9 H8 Z" fill="var(--text-muted)" opacity="0.4" />
      </svg>
    );
  }
  if (direction === 'asc') {
    return (
      <svg className={styles.sortArrow} viewBox="0 0 10 14" aria-hidden="true">
        <path d="M5 1 L8 5 H2 Z" fill="var(--primary)" />
        <path d="M5 13 L2 9 H8 Z" fill="var(--text-muted)" opacity="0.4" />
      </svg>
    );
  }
  return (
    <svg className={styles.sortArrow} viewBox="0 0 10 14" aria-hidden="true">
      <path d="M5 1 L8 5 H2 Z" fill="var(--text-muted)" opacity="0.4" />
      <path d="M5 13 L2 9 H8 Z" fill="var(--primary)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// External link icon
// ---------------------------------------------------------------------------
function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" />
      <path d="M10 2h4v4" />
      <line x1="14" y1="2" x2="7" y2="9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stats bar sub-component
// ---------------------------------------------------------------------------
function StatsBar({ transactions }) {
  const { total, successRate, totalFees, totalVolume } = useMemo(
    () => computeStats(transactions),
    [transactions]
  );

  const stats = [
    { label: 'Total Transactions', value: total.toLocaleString() },
    { label: 'Success Rate', value: `${successRate}%` },
    { label: 'Total Fees', value: `${formatAmount(totalFees)} XLM` },
    { label: 'Total Volume', value: `${formatAmount(totalVolume)} XLM` },
  ];

  return (
    <div className={styles.statsBar}>
      {stats.map((stat) => (
        <div key={stat.label} className={styles.statCard}>
          <span className={styles.statLabel}>{stat.label}</span>
          <span className={styles.statValue}>{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter controls sub-component
// ---------------------------------------------------------------------------
function FilterControls({ filters, onChange, onExport, onClear }) {
  return (
    <div className={styles.filterRow}>
      <div className={styles.filterSearch}>
        <Input
          id="tx-search"
          type="text"
          placeholder="Search hash, asset, type…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          aria-label="Search transactions"
        />
      </div>

      <div className={styles.filterSelect}>
        <label htmlFor="status-filter" className={styles.selectLabel}>Status</label>
        <select
          id="status-filter"
          className={styles.select}
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
          aria-label="Filter by status"
        >
          <option value="">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className={styles.filterSelect}>
        <label htmlFor="type-filter" className={styles.selectLabel}>Type</label>
        <select
          id="type-filter"
          className={styles.select}
          value={filters.type}
          onChange={(e) => onChange({ ...filters, type: e.target.value })}
          aria-label="Filter by type"
        >
          <option value="">All</option>
          <option value="buy_shares">Buy Shares</option>
          <option value="sell_shares">Sell Shares</option>
          <option value="transfer">Transfer</option>
          <option value="payment">Payment</option>
        </select>
      </div>

      <div className={styles.filterDate}>
        <label htmlFor="date-from" className={styles.selectLabel}>From</label>
        <input
          id="date-from"
          type="date"
          className={styles.dateInput}
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          aria-label="Filter from date"
        />
      </div>

      <div className={styles.filterDate}>
        <label htmlFor="date-to" className={styles.selectLabel}>To</label>
        <input
          id="date-to"
          type="date"
          className={styles.dateInput}
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          aria-label="Filter to date"
        />
      </div>

      <Button variant="secondary" onClick={onExport} aria-label="Export CSV">
        Export CSV
      </Button>

      <Button variant="ghost" onClick={onClear} aria-label="Clear all filters">
        Clear Filters
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction table sub-component
// ---------------------------------------------------------------------------
const COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'asset', label: 'Asset' },
  { key: 'amount', label: 'Amount' },
  { key: 'fee', label: 'Fee' },
  { key: 'status', label: 'Status' },
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'actions', label: 'Actions', sortable: false },
];

function statusVariant(status) {
  if (status === 'confirmed') return 'success';
  if (status === 'pending') return 'warning';
  return 'danger';
}

function TransactionTable({ transactions, sort, onSort, page, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(transactions.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * ROWS_PER_PAGE;
  const pageRows = transactions.slice(startIdx, startIdx + ROWS_PER_PAGE);

  function handleHeaderClick(colKey) {
    if (colKey === 'actions') return;
    if (sort.key === colKey) {
      onSort({ key: colKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSort({ key: colKey, dir: 'asc' });
    }
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`${styles.th} ${col.key !== 'actions' ? styles.thSortable : ''}`}
                onClick={() => handleHeaderClick(col.key)}
                aria-sort={
                  sort.key === col.key
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
                scope="col"
              >
                <span className={styles.thContent}>
                  {col.label}
                  {col.key !== 'actions' && (
                    <SortArrow
                      direction={sort.key === col.key ? sort.dir : null}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className={styles.emptyState}>
                <div className={styles.emptyContent}>
                  <svg viewBox="0 0 48 48" className={styles.emptyIcon} aria-hidden="true">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-color-hover)" strokeWidth="2" />
                    <path d="M16 24h16M24 16v16" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <p className={styles.emptyTitle}>No transactions found</p>
                  <p className={styles.emptySubtitle}>Try adjusting your search or filter criteria.</p>
                </div>
              </td>
            </tr>
          ) : (
            pageRows.map((tx, idx) => (
              <tr
                key={tx.id}
                className={`${styles.tr} ${idx % 2 === 0 ? styles.trEven : styles.trOdd}`}
              >
                <td className={styles.td}>
                  <span className={styles.typeLabel}>{formatTypeLabel(tx.type)}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.assetLabel}>{tx.asset}</span>
                </td>
                <td className={`${styles.td} ${styles.numeric}`}>
                  {formatAmount(tx.amount)}
                </td>
                <td className={`${styles.td} ${styles.numeric} ${styles.feeCell}`}>
                  {formatAmount(tx.fee)}
                </td>
                <td className={styles.td}>
                  <Badge variant={statusVariant(tx.status)}>
                    {tx.status}
                  </Badge>
                </td>
                <td className={`${styles.td} ${styles.timestampCell}`}>
                  {formatTimestamp(tx.timestamp)}
                </td>
                <td className={`${styles.td} ${styles.actionsCell}`}>
                  <a
                    href={`${STELLAR_EXPLORER_BASE}${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.explorerLink}
                    title={`View ${truncateHash(tx.hash)} on Stellar Expert`}
                    aria-label={`View transaction ${truncateHash(tx.hash)} on Stellar Expert`}
                  >
                    <ExternalLinkIcon />
                    <span className={styles.explorerLinkText}>{truncateHash(tx.hash)}</span>
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {transactions.length > 0 && (
        <div className={styles.pagination}>
          <Button
            variant="ghost"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Previous page"
          >
            ← Prev
          </Button>
          <span className={styles.pageIndicator}>
            Page {safePage} of {totalPages}
          </span>
          <Button
            variant="ghost"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Next page"
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtering + sorting logic
// ---------------------------------------------------------------------------
function applyFilters(transactions, filters) {
  let result = transactions;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (tx) =>
        tx.hash.includes(q) ||
        tx.asset.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q)
    );
  }

  if (filters.status) {
    result = result.filter((tx) => tx.status === filters.status);
  }

  if (filters.type) {
    result = result.filter((tx) => tx.type === filters.type);
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    result = result.filter((tx) => new Date(tx.timestamp) >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setUTCHours(23, 59, 59, 999);
    result = result.filter((tx) => new Date(tx.timestamp) <= to);
  }

  return result;
}

function applySort(transactions, sort) {
  if (!sort.key || sort.key === 'actions') return transactions;
  return [...transactions].sort((a, b) => {
    let aVal = a[sort.key];
    let bVal = b[sort.key];
    if (sort.key === 'timestamp') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    } else if (typeof aVal === 'number') {
      // numeric comparison
    } else {
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
    }
    if (aVal < bVal) return sort.dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

const DEFAULT_FILTERS = {
  search: '',
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function TransactionHistoryDashboard({ publicKey }) {
  const [allTransactions, setAllTransactions] = useState(() =>
    generateMockTransactions(publicKey)
  );
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState({ key: 'timestamp', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [isPolling, setIsPolling] = useState(false);
  const pollCycleRef = useRef({});

  // Reset transactions when publicKey changes
  useEffect(() => {
    setAllTransactions(generateMockTransactions(publicKey));
    setPage(1);
  }, [publicKey]);

  // Real-time polling for pending transactions
  useEffect(() => {
    if (!publicKey) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);

    const intervalId = setInterval(() => {
      setAllTransactions((prev) => {
        const updated = prev.map((tx) => {
          if (tx.status !== 'pending') return tx;

          // Track how many cycles this tx has been pending
          if (!pollCycleRef.current[tx.id]) {
            pollCycleRef.current[tx.id] = 0;
          }
          pollCycleRef.current[tx.id] += 1;

          const cycles = pollCycleRef.current[tx.id];
          // Randomly confirm after 1-2 cycles
          const threshold = Math.random() < 0.5 ? 1 : 2;
          if (cycles >= threshold) {
            delete pollCycleRef.current[tx.id];
            return { ...tx, status: 'confirmed' };
          }
          return tx;
        });
        return updated;
      });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      setIsPolling(false);
    };
  }, [publicKey]);

  // Reset to page 1 whenever filters/sort change
  useEffect(() => {
    setPage(1);
  }, [filters, sort]);

  const filteredAndSorted = useMemo(() => {
    const filtered = applyFilters(allTransactions, filters);
    return applySort(filtered, sort);
  }, [allTransactions, filters, sort]);

  function handleExportCSV() {
    exportCSV(filteredAndSorted);
  }

  function handleClearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>Transaction History</h2>
        <div className={styles.headerRight}>
          {isPolling && (
            <span className={styles.liveBadge} aria-label="Live polling active">
              <span className={styles.liveDot} aria-hidden="true" />
              Live
            </span>
          )}
          {publicKey && (
            <span className={styles.walletAddress} title={publicKey}>
              {publicKey.slice(0, 6)}…{publicKey.slice(-6)}
            </span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar transactions={allTransactions} />

      {/* Weekly chart */}
      <section className={styles.chartSection} aria-label="Weekly transaction activity">
        <h3 className={styles.sectionTitle}>Weekly Activity</h3>
        <WeeklyBarChart transactions={allTransactions} />
      </section>

      {/* Filter controls */}
      <FilterControls
        filters={filters}
        onChange={setFilters}
        onExport={handleExportCSV}
        onClear={handleClearFilters}
      />

      {/* Results count */}
      <div className={styles.resultsMeta}>
        <span className={styles.resultsCount}>
          {filteredAndSorted.length} transaction{filteredAndSorted.length !== 1 ? 's' : ''} found
        </span>
      </div>

      {/* Table */}
      <TransactionTable
        transactions={filteredAndSorted}
        sort={sort}
        onSort={setSort}
        page={page}
        onPageChange={setPage}
      />
    </div>
  );
}
