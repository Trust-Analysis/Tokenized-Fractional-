import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriceHistoryChart from '../components/PriceHistoryChart/PriceHistoryChart';

const stats = {
  min: 10,
  max: 12,
  avg: 11,
  latest: 12,
  earliest: 10,
  change: 2,
  changePercent: 20,
  high52w: 12,
  low52w: 10,
};

describe('PriceHistoryChart', () => {
  it('shows a loading state while the history request is in flight', () => {
    render(<PriceHistoryChart data={[]} loading height={400} />);

    expect(screen.getByText('Loading price history...')).toBeInTheDocument();
  });

  it('shows the API error instead of a chart', () => {
    render(
      <PriceHistoryChart data={[]} error="Failed to fetch price history (503)" height={400} />,
    );

    expect(screen.getByText('⚠️ Failed to load price history')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch price history (503)')).toBeInTheDocument();
  });

  it('shows a no-data-yet state when the API returns no price points', () => {
    render(<PriceHistoryChart data={[]} assetName="Test Asset" stats={stats} height={400} />);

    expect(screen.getByRole('status')).toHaveTextContent('No price history yet for Test Asset');
    expect(screen.getByText(/No trades have been recorded for this asset/)).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('renders the chart footer for real data points', () => {
    const data = [
      {
        date: '2026-01-01',
        timestamp: new Date('2026-01-01T00:00:00.000Z').getTime(),
        price: 12,
        volume: 5,
        change: 2,
        changePercent: 20,
      },
    ];

    render(
      <PriceHistoryChart
        data={data}
        assetName="Test Asset"
        timeRange="1y"
        stats={stats}
        height={400}
      />,
    );

    expect(screen.getByText('Showing 1 data point • 1Y')).toBeInTheDocument();
  });
});
