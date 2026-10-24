import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
// i18nFormatters imports date-fns, which is not a declared frontend dependency.
vi.mock('../utils/i18nFormatters', () => ({ formatLocalCurrency: (n) => `$${n}` }));

import AssetComparison from '../components/AssetComparison/AssetComparison';
import AssetCard from '../components/AssetCard/AssetCard';
import { useComparisonStore, MAX_COMPARISON } from '../store/useComparisonStore';
import { useToastStore } from '../store/useToastStore';

const asset = (n) => ({ contractId: `C${n}`.padEnd(20, '0'), title: `Asset ${n}`, totalShares: 100, availableShares: 50 });

describe('Asset comparison limit (#904)', () => {
  beforeEach(() => {
    useComparisonStore.setState({ comparedAssets: [] });
    useToastStore.setState({ toasts: [] });
  });

  it('caps a comparison at 4 assets', () => {
    expect(MAX_COMPARISON).toBe(4);
  });

  it('reports limit_reached instead of silently ignoring the 5th asset', () => {
    const { toggleComparison } = useComparisonStore.getState();
    for (let i = 1; i <= MAX_COMPARISON; i++) {
      expect(toggleComparison(asset(i))).toEqual({ status: 'added' });
    }
    expect(toggleComparison(asset(5))).toEqual({ status: 'limit_reached' });
    expect(useComparisonStore.getState().comparedAssets.map((a) => a.title)).toEqual([
      'Asset 1', 'Asset 2', 'Asset 3', 'Asset 4',
    ]);
    expect(useComparisonStore.getState().isComparisonFull()).toBe(true);
  });

  it('frees a slot once an asset is removed', () => {
    const { toggleComparison } = useComparisonStore.getState();
    for (let i = 1; i <= MAX_COMPARISON; i++) toggleComparison(asset(i));
    expect(toggleComparison(asset(1))).toEqual({ status: 'removed' });
    expect(toggleComparison(asset(5))).toEqual({ status: 'added' });
  });

  it('shows a limit notice in the comparison view when full', () => {
    useComparisonStore.setState({ comparedAssets: [1, 2, 3, 4].map(asset) });
    render(<AssetComparison />);
    expect(screen.getByText('4 of 4 assets selected')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Comparison limit reached (4 assets)');
  });

  it('does not show the notice below the limit', () => {
    useComparisonStore.setState({ comparedAssets: [1, 2].map(asset) });
    render(<AssetComparison />);
    expect(screen.queryByText(/Comparison limit reached/)).not.toBeInTheDocument();
  });

  it('warns the user when they try to add a 5th asset from an asset card', () => {
    useComparisonStore.setState({ comparedAssets: [1, 2, 3, 4].map(asset) });
    render(<AssetCard asset={asset(5)} />);

    fireEvent.click(screen.getByLabelText(/Compare Asset 5 \(limit of 4 reached\)/));

    expect(useComparisonStore.getState().comparedAssets).toHaveLength(4);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: 'warning', message: expect.stringContaining('up to 4 assets') }),
    ]);
  });
});
