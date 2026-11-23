import { useEffect, useMemo, useState } from 'react';

// Demo catalogue backing the search/filter toolbar (#786). The real asset grid
// is loaded separately from the backend.
const CATALOG_ASSETS = [
  {
    contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
    title: 'Luxury Manhattan Condo Unit 12B',
    location: 'New York, NY',
    assetType: 'real_estate',
    valuation: 2500000,
    status: 'approved',
    createdAt: '2026-06-01',
  },
  {
    contractId: 'CC1234567890ABCDEFGHJKLMNOPQRSTUVWXYZ23456789ABCDEFGH',
    title: 'Silicon Valley Tech Park Parcel A',
    location: 'San Jose, CA',
    assetType: 'real_estate',
    valuation: 8500000,
    status: 'approved',
    createdAt: '2026-07-15',
  },
  {
    contractId: 'CC9876543210FEDCBAZYXWVUTSRQPONMLKJIHGFEDCBA9876543210',
    title: 'Solar Farm Infrastructure Alpha',
    location: 'Austin, TX',
    assetType: 'energy',
    valuation: 1200000,
    status: 'approved',
    createdAt: '2026-08-10',
  },
];

/**
 * Search, filter, and sort catalogue assets while keeping the query string in
 * sync so a filtered view can be shared.
 */
export function useMarketplaceFilters() {
  const [searchQuery, setSearchQuery] = useState('');
  const [assetTypeFilter, setAssetTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Initialise from the URL once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get('search') || '');
    setAssetTypeFilter(params.get('type') || 'all');
    setSortBy(params.get('sort') || 'newest');
  }, []);

  const filteredAssets = useMemo(() => {
    let result = [...CATALOG_ASSETS];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (asset) =>
          asset.title.toLowerCase().includes(query) || asset.location.toLowerCase().includes(query),
      );
    }
    if (assetTypeFilter !== 'all') {
      result = result.filter((asset) => asset.assetType === assetTypeFilter);
    }

    if (sortBy === 'valuation-asc') {
      result.sort((a, b) => a.valuation - b.valuation);
    } else if (sortBy === 'valuation-desc') {
      result.sort((a, b) => b.valuation - a.valuation);
    } else if (sortBy === 'newest') {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return result;
  }, [searchQuery, assetTypeFilter, sortBy]);

  // Reflect the filters in the URL whenever they change.
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (assetTypeFilter !== 'all') params.set('type', assetTypeFilter);
    if (sortBy !== 'newest') params.set('sort', sortBy);

    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [searchQuery, assetTypeFilter, sortBy]);

  return {
    searchQuery,
    setSearchQuery,
    assetTypeFilter,
    setAssetTypeFilter,
    sortBy,
    setSortBy,
    filteredAssets,
  };
}

export default useMarketplaceFilters;
