import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import html2canvas from 'html2canvas';
import PriceHistoryModal from '../components/PriceHistoryChart/PriceHistoryModal';

const mockUsePriceHistory = vi.fn();

vi.mock('../hooks/usePriceHistory', () => ({
  usePriceHistory: (...args) => mockUsePriceHistory(...args),
  default: (...args) => mockUsePriceHistory(...args),
}));

vi.mock('html2canvas', () => ({
  default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options?.asset ? `${key}:${options.asset}` : key),
  }),
}));

const asset = {
  contractId: 'C'.repeat(56),
  title: 'Luxury Manhattan Condo 12B',
  location: 'New York, NY',
  assetType: 'real_estate',
  totalValuation: '$2,500,000',
};

const baseHookValue = {
  priceData: [
    {
      date: '2026-11-01',
      timestamp: 1761955200000,
      price: 12.5,
      volume: 4,
      change: 0,
      changePercent: 0,
    },
    {
      date: '2026-11-02',
      timestamp: 1762041600000,
      price: 13,
      volume: 2,
      change: 0.5,
      changePercent: 4,
    },
  ],
  stats: { latest: 13, high52w: 13, low52w: 12.5, avg: 12.75, changePercent: 4 },
  loading: false,
  error: null,
  timeRange: '1m',
  setTimeRange: vi.fn(),
  formatPrice: (value) => `$${Number(value).toFixed(2)}`,
  formatPercent: (value) => `${value >= 0 ? '+' : ''}${value}%`,
};

describe('PriceHistoryModal export', () => {
  let clickSpy;
  let createObjectURL;

  beforeEach(() => {
    mockUsePriceHistory.mockReturnValue(baseHookValue);
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    createObjectURL = vi.fn(() => 'blob:price-history');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('labels both export buttons for assistive technology', () => {
    render(<PriceHistoryModal isOpen onClose={() => {}} asset={asset} />);

    expect(
      screen.getByRole('button', {
        name: 'priceHistory.export.csvLabel:Luxury Manhattan Condo 12B',
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', {
        name: 'priceHistory.export.pngLabel:Luxury Manhattan Condo 12B',
      }),
    ).toBeEnabled();
  });

  it('downloads CSV for the visible range', async () => {
    render(<PriceHistoryModal isOpen onClose={() => {}} asset={asset} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'priceHistory.export.csvLabel:Luxury Manhattan Condo 12B',
      }),
    );

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0].download).toBe(
      'price-history-luxury-manhattan-condo-12b-1m.csv',
    );
  });

  it('downloads a PNG of the chart', async () => {
    html2canvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,chart' });

    render(<PriceHistoryModal isOpen onClose={() => {}} asset={asset} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'priceHistory.export.pngLabel:Luxury Manhattan Condo 12B',
      }),
    );

    await waitFor(() => expect(html2canvas).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(clickSpy.mock.instances[0].download).toBe(
      'price-history-luxury-manhattan-condo-12b-1m.png',
    );
  });

  it('disables export when there is no price history', () => {
    mockUsePriceHistory.mockReturnValue({ ...baseHookValue, priceData: [] });

    render(<PriceHistoryModal isOpen onClose={() => {}} asset={asset} />);

    expect(
      screen.getByRole('button', {
        name: 'priceHistory.export.csvLabel:Luxury Manhattan Condo 12B',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'priceHistory.export.pngLabel:Luxury Manhattan Condo 12B',
      }),
    ).toBeDisabled();
  });
});
