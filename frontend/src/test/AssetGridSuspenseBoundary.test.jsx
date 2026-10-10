import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssetGridSuspenseBoundary from '../components/AssetGrid/AssetGridSuspenseBoundary';

describe('AssetGridSuspenseBoundary Component', () => {
  const mockAssets = [
    {
      contractId: 'C111',
      title: 'Fractional Real Estate Vault',
      assetType: 'RealEstate',
      valuation: 500000,
    },
    {
      contractId: 'C222',
      title: 'Tokenized Fine Art',
      assetType: 'Art',
      valuation: 120000,
    },
  ];

  it('renders SkeletonGrid during loading with exact grid dimensions (CLS = 0.0)', () => {
    render(<AssetGridSuspenseBoundary loading={true} skeletonCount={6} />);

    const skeletonGrid = screen.getByTestId('skeleton-grid');
    expect(skeletonGrid).toBeInTheDocument();

    const cards = screen.getAllByTestId('skeleton-card');
    expect(cards.length).toBe(6);
  });

  it('renders loaded AssetGrid smoothly when loading is false', () => {
    render(<AssetGridSuspenseBoundary loading={false} assets={mockAssets} />);

    expect(screen.getByText('Fractional Real Estate Vault')).toBeInTheDocument();
    expect(screen.getByText('Tokenized Fine Art')).toBeInTheDocument();
  });
});
