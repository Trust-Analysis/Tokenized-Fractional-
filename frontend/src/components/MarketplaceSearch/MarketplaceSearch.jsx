import React from 'react';
import { useMarketplaceFilters } from '../../hooks/useMarketplaceFilters';

/**
 * Asset search, filter, and sort toolbar (Issue #786). The URL is kept in sync
 * by the hook so a filtered catalogue view can be shared.
 */
export default function MarketplaceSearch() {
  const {
    searchQuery,
    setSearchQuery,
    assetTypeFilter,
    setAssetTypeFilter,
    sortBy,
    setSortBy,
    filteredAssets,
  } = useMarketplaceFilters();

  return (
    <>
      <div
        className="asset-search-toolbar"
        style={{
          margin: '20px auto',
          padding: '16px 20px',
          background: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          maxWidth: '900px',
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <input
          id="search-input"
          type="text"
          placeholder="🔍 Search assets by name or location..."
          aria-label="Search assets by name or location"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: '1 1 280px',
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        />
        <select
          value={assetTypeFilter}
          aria-label="Filter by asset type"
          onChange={(e) => setAssetTypeFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '14px',
            background: '#fff',
          }}
        >
          <option value="all">All Asset Types</option>
          <option value="real_estate">Real Estate</option>
          <option value="energy">Energy &amp; Infrastructure</option>
        </select>
        <select
          value={sortBy}
          aria-label="Sort assets"
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '14px',
            background: '#fff',
          }}
        >
          <option value="newest">Sort: Newest First</option>
          <option value="valuation-desc">Valuation: High to Low</option>
          <option value="valuation-asc">Valuation: Low to High</option>
        </select>
      </div>

      <div
        className="asset-grid"
        style={{
          margin: '10px auto',
          maxWidth: '900px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px',
          textAlign: 'left',
        }}
      >
        {filteredAssets.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '30px',
              background: '#fff',
              borderRadius: '8px',
              textAlign: 'center',
              color: '#64748b',
            }}
          >
            No assets match your search criteria.
          </div>
        ) : (
          filteredAssets.map((asset) => (
            <div
              key={asset.contractId}
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  color: '#0284c7',
                  background: '#e0f2fe',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                }}
              >
                {asset.assetType}
              </span>
              <h4 style={{ margin: '10px 0 6px 0', color: '#0f172a', fontSize: '16px' }}>
                {asset.title}
              </h4>
              <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#475569' }}>
                📍 {asset.location}
              </p>
              <p
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#16a34a',
                }}
              >
                Valuation: ${asset.valuation.toLocaleString()}
              </p>
              <code
                style={{
                  fontSize: '10px',
                  color: '#94a3b8',
                  display: 'block',
                  wordBreak: 'break-all',
                }}
              >
                {asset.contractId}
              </code>
            </div>
          ))
        )}
      </div>
    </>
  );
}
