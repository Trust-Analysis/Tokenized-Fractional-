/**
 * CSV Export Utility for Transaction History
 * Handles filtering by date range and triggering browser CSV download.
 */
export function exportTransactionsToCSV(transactions, dateRange = null) {
  if (!transactions || transactions.length === 0) {
    alert('No transaction history available to export.');
    return;
  }

  // Limit export to currently filtered date range if one is active
  let filtered = transactions;
  if (dateRange && (dateRange.startDate || dateRange.endDate)) {
    const start = dateRange.startDate ? new Date(dateRange.startDate) : null;
    const end = dateRange.endDate ? new Date(dateRange.endDate) : null;

    filtered = transactions.filter(tx => {
      const txDate = new Date(tx.date || tx.timestamp || tx.created_at);
      if (isNaN(txDate.getTime())) return true;
      if (start && txDate < start) return false;
      if (end && txDate > end) return false;
      return true;
    });
  }

  if (filtered.length === 0) {
    alert('No transactions match the selected date range.');
    return;
  }

  // Acceptance Criteria Columns: date, asset name, action (buy/sell), shares, price per share, total, transaction hash
  const headers = ['Date', 'Asset Name', 'Action', 'Shares', 'Price Per Share', 'Total', 'Transaction Hash'];

  const rows = filtered.map(tx => {
    const txDate = tx.date || tx.timestamp || tx.created_at || new Date().toISOString();
    const assetName = tx.assetName || tx.asset_name || tx.name || 'Unknown Asset';
    const action = (tx.action || 'buy').toLowerCase();
    const shares = tx.shares || tx.amount || 0;
    const pricePerShare = tx.pricePerShare || tx.price_per_share || tx.price || 0;
    const total = tx.total || (Number(shares) * Number(pricePerShare)) || 0;
    const hash = tx.hash || tx.transactionHash || tx.tx_hash || 'N/A';

    return [
      `"${new Date(txDate).toLocaleString()}"`,
      `"${String(assetName).replace(/"/g, '""')}"`,
      `"${action.toUpperCase()}"`,
      shares,
      pricePerShare,
      total,
      `"${String(hash).replace(/"/g, '""')}"`
    ];
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `transaction_history_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
