import { describe, it, expect } from 'vitest';
import { buildPriceHistoryCsv, buildPriceHistoryFilename } from '../utils/priceHistoryExport';

const points = [
  { date: '2026-11-01', price: 12.5, volume: 4, change: 0, changePercent: 0 },
  { date: '2026-11-02', price: 13, volume: 2, change: 0.5, changePercent: 4 },
];

describe('price history export helpers', () => {
  it('serialises the visible points with a header row', () => {
    expect(buildPriceHistoryCsv(points).split('\n')).toEqual([
      'Date,Price,Volume,Change,Change (%)',
      '2026-11-01,12.5,4,0,0',
      '2026-11-02,13,2,0.5,4',
    ]);
  });

  it('falls back to the timestamp when a point has no date', () => {
    const csv = buildPriceHistoryCsv([{ timestamp: Date.UTC(2026, 10, 3), price: 14, volume: 1 }]);
    expect(csv.split('\n')[1]).toBe('2026-11-03,14,1,,');
  });

  it('returns only the header for an empty range', () => {
    expect(buildPriceHistoryCsv([])).toBe('Date,Price,Volume,Change,Change (%)');
  });

  it('builds a safe filename for every supported range', () => {
    for (const range of ['1m', '3m', '6m', '1y', 'all']) {
      expect(buildPriceHistoryFilename('Luxury Manhattan Condo / 12B', range, 'csv')).toBe(
        `price-history-luxury-manhattan-condo-12b-${range}.csv`,
      );
    }
  });

  it('falls back to a generic asset name', () => {
    expect(buildPriceHistoryFilename('', '1m', 'png')).toBe('price-history-asset-1m.png');
  });
});
