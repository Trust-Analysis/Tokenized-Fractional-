import html2canvas from 'html2canvas';

/**
 * Price-history export helpers (Issue #1045).
 *
 * CSV serialises exactly the points the caller passes in, which is the visible
 * time range from `usePriceHistory`. PNG captures the rendered chart element.
 */

const CSV_HEADER = ['Date', 'Price', 'Volume', 'Change', 'Change (%)'];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds an RFC 4180-compatible CSV document for the supplied price points.
 * @param {Array<{date?: string, timestamp?: number, price: number, volume?: number, change?: number, changePercent?: number}>} data
 * @returns {string}
 */
export function buildPriceHistoryCsv(data = []) {
  const rows = (data ?? []).map((point) => [
    point.date ?? (point.timestamp ? new Date(point.timestamp).toISOString().slice(0, 10) : ''),
    point.price,
    point.volume ?? '',
    point.change ?? '',
    point.changePercent ?? '',
  ]);

  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/**
 * @param {string} assetName
 * @param {string} range visible time range ('1m', '3m', '6m', '1y', 'all')
 * @param {'csv'|'png'} extension
 * @returns {string} filesystem-safe download name
 */
export function buildPriceHistoryFilename(assetName, range, extension) {
  const slug = String(assetName || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `price-history-${slug || 'asset'}-${range || 'all'}.${extension}`;
}

function triggerDownload(href, filename) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Downloads CSV text as a file.
 * @param {string} csv
 * @param {string} filename
 */
export function downloadPriceHistoryCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Renders `element` to a PNG and downloads it.
 * @param {HTMLElement} element chart container
 * @param {string} filename
 */
export async function downloadPriceHistoryPng(element, filename) {
  if (!element) throw new Error('Chart element is not available');

  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
  });
  triggerDownload(canvas.toDataURL('image/png'), filename);
}
