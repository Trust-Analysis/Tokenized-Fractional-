import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { formatLocalCurrency, formatLocalNumber } from '../../utils/i18nFormatters';
import styles from './SearchFilters.module.css';

/**
 * Advanced Search and Filtering Component
 * Features: price range slider, asset type filter, availability status, sorting, pagination
 */
export function SearchFilters({ onFilterChange, assets = [] }) {
  const { t } = useTranslation();
  const { currentLanguage } = useLanguage();

  // State management
  const [searchTerm, setSearchTerm] = useState('');
  const [priceRange, setPriceRange] = useState([0, 1000000]);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [availabilityFilter, setAvailabilityFilter] = useState([]);
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [showFilters, setShowFilters] = useState(true);

  // Calculate available filter options
  const filterOptions = useMemo(() => {
    const priceValues = assets.map(a => a.price || 0).filter(p => p > 0);
    const types = [...new Set(assets.map(a => a.assetType).filter(Boolean))];
    const cats = [...new Set(assets.map(a => a.category).filter(Boolean))];

    return {
      priceMin: Math.min(...priceValues, 0),
      priceMax: Math.max(...priceValues, 1000000),
      assetTypes: types,
      categories: cats,
    };
  }, [assets]);

  // Apply filters and sorting
  const filteredResults = useMemo(() => {
    let results = [...assets];

    // Text search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      results = results.filter(asset =>
        asset.title?.toLowerCase().includes(term) ||
        asset.description?.toLowerCase().includes(term) ||
        asset.location?.toLowerCase().includes(term)
      );
    }

    // Price range filter
    results = results.filter(asset => {
      const price = asset.price || 0;
      return price >= priceRange[0] && price <= priceRange[1];
    });

    // Asset type filter
    if (selectedAssetTypes.length > 0) {
      results = results.filter(asset => selectedAssetTypes.includes(asset.assetType));
    }

    // Category filter
    if (selectedCategories.length > 0) {
      results = results.filter(asset => selectedCategories.includes(asset.category));
    }

    // Availability filter
    if (availabilityFilter.length > 0) {
      results = results.filter(asset => {
        const available = (asset.totalShares || 0) - (asset.soldShares || 0);
        const status = available <= 0 ? 'unavailable' : available < 10 ? 'limited' : 'available';
        return availabilityFilter.includes(status);
      });
    }

    // Sorting
    results.sort((a, b) => {
      let aVal = a[sortBy] || 0;
      let bVal = b[sortBy] || 0;

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return results;
  }, [
    assets,
    searchTerm,
    priceRange,
    selectedAssetTypes,
    selectedCategories,
    availabilityFilter,
    sortBy,
    sortDirection,
  ]);

  // Pagination
  const paginatedResults = useMemo(() => {
    const startIndex = (page - 1) * itemsPerPage;
    return filteredResults.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredResults, page, itemsPerPage]);

  // Notify parent of filter changes
  useEffect(() => {
    onFilterChange?.({
      searchTerm,
      priceRange,
      assetTypes: selectedAssetTypes,
      categories: selectedCategories,
      availability: availabilityFilter,
      sortBy,
      sortDirection,
      page,
      itemsPerPage,
      results: paginatedResults,
      totalResults: filteredResults.length,
      totalPages: Math.ceil(filteredResults.length / itemsPerPage),
    });
  }, [
    searchTerm,
    priceRange,
    selectedAssetTypes,
    selectedCategories,
    availabilityFilter,
    sortBy,
    sortDirection,
    page,
    itemsPerPage,
    paginatedResults,
    filteredResults.length,
  ]);

  const handlePriceChange = (index, value) => {
    const newRange = [...priceRange];
    newRange[index] = value;
    if (newRange[0] <= newRange[1]) {
      setPriceRange(newRange);
    }
  };

  const toggleAssetType = (type) => {
    setSelectedAssetTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setPage(1);
  };

  const toggleCategory = (cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
    setPage(1);
  };

  const toggleAvailability = (status) => {
    setAvailabilityFilter(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
    setPage(1);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setPriceRange([filterOptions.priceMin, filterOptions.priceMax]);
    setSelectedAssetTypes([]);
    setSelectedCategories([]);
    setAvailabilityFilter([]);
    setSortBy('name');
    setSortDirection('asc');
    setPage(1);
  };

  const activeFilterCount = [
    searchTerm ? 1 : 0,
    selectedAssetTypes.length,
    selectedCategories.length,
    availabilityFilter.length,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>{t('search.title', { defaultValue: 'Search & Filter' })}</h2>
        <button
          className={styles.toggleButton}
          onClick={() => setShowFilters(!showFilters)}
          aria-label={t('a11y.toggleFilters', { defaultValue: 'Toggle filters' })}
        >
          {showFilters ? '▼' : '▶'} {t('search.filters', { defaultValue: 'Filters' })}
          {activeFilterCount > 0 && (
            <span className={styles.badge}>{activeFilterCount}</span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className={styles.filtersPanel}>
          {/* Search Bar */}
          <div className={styles.section}>
            <h3>{t('search.search', { defaultValue: 'Search' })}</h3>
            <input
              type="text"
              placeholder={t('search.placeholder', { defaultValue: 'Search assets...' })}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className={styles.searchInput}
            />
          </div>

          {/* Price Range Slider */}
          <div className={styles.section}>
            <h3>{t('search.priceRange', { defaultValue: 'Price Range' })}</h3>
            <div className={styles.priceSliderContainer}>
              <input
                type="range"
                min={filterOptions.priceMin}
                max={filterOptions.priceMax}
                value={priceRange[0]}
                onChange={(e) => handlePriceChange(0, parseFloat(e.target.value))}
                className={styles.priceSlider}
              />
              <input
                type="range"
                min={filterOptions.priceMin}
                max={filterOptions.priceMax}
                value={priceRange[1]}
                onChange={(e) => handlePriceChange(1, parseFloat(e.target.value))}
                className={styles.priceSlider}
              />
            </div>
            <div className={styles.priceDisplay}>
              <span>{formatLocalCurrency(priceRange[0], 'USD', currentLanguage)}</span>
              <span> - </span>
              <span>{formatLocalCurrency(priceRange[1], 'USD', currentLanguage)}</span>
            </div>
          </div>

          {/* Asset Type Filter */}
          {filterOptions.assetTypes.length > 0 && (
            <div className={styles.section}>
              <h3>{t('search.assetType', { defaultValue: 'Asset Type' })}</h3>
              <div className={styles.checkboxGroup}>
                {filterOptions.assetTypes.map(type => (
                  <label key={type} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={selectedAssetTypes.includes(type)}
                      onChange={() => toggleAssetType(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Category Filter */}
          {filterOptions.categories.length > 0 && (
            <div className={styles.section}>
              <h3>{t('search.category', { defaultValue: 'Category' })}</h3>
              <div className={styles.checkboxGroup}>
                {filterOptions.categories.map(cat => (
                  <label key={cat} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                    />
                    <span>{cat}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Availability Filter */}
          <div className={styles.section}>
            <h3>{t('search.availability', { defaultValue: 'Availability' })}</h3>
            <div className={styles.checkboxGroup}>
              {['available', 'limited', 'unavailable'].map(status => (
                <label key={status} className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={availabilityFilter.includes(status)}
                    onChange={() => toggleAvailability(status)}
                  />
                  <span className={styles[`status-${status}`]}>
                    {t(`search.${status}`, { defaultValue: status })}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Sorting */}
          <div className={styles.section}>
            <h3>{t('search.sortBy', { defaultValue: 'Sort By' })}</h3>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className={styles.select}
            >
              <option value="name">{t('search.sortName', { defaultValue: 'Name' })}</option>
              <option value="price">{t('search.sortPrice', { defaultValue: 'Price' })}</option>
              <option value="createdAt">{t('search.sortRecent', { defaultValue: 'Recently Added' })}</option>
              <option value="popularity">{t('search.sortPopular', { defaultValue: 'Popularity' })}</option>
            </select>

            <div className={styles.directionButtons}>
              <button
                className={`${styles.dirBtn} ${sortDirection === 'asc' ? styles.active : ''}`}
                onClick={() => {
                  setSortDirection('asc');
                  setPage(1);
                }}
              >
                ↑ {t('search.ascending', { defaultValue: 'Ascending' })}
              </button>
              <button
                className={`${styles.dirBtn} ${sortDirection === 'desc' ? styles.active : ''}`}
                onClick={() => {
                  setSortDirection('desc');
                  setPage(1);
                }}
              >
                ↓ {t('search.descending', { defaultValue: 'Descending' })}
              </button>
            </div>
          </div>

          {/* Items Per Page */}
          <div className={styles.section}>
            <h3>{t('search.itemsPerPage', { defaultValue: 'Items Per Page' })}</h3>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(parseInt(e.target.value));
                setPage(1);
              }}
              className={styles.select}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          {/* Clear Filters */}
          {activeFilterCount > 0 && (
            <button className={styles.clearButton} onClick={clearFilters}>
              {t('search.clearAll', { defaultValue: 'Clear All Filters' })}
            </button>
          )}
        </div>
      )}

      {/* Results Summary */}
      <div className={styles.resultsSummary}>
        <span>
          {t('search.showing', { defaultValue: 'Showing' })} {paginatedResults.length} {t('search.of', { defaultValue: 'of' })} {filteredResults.length}
        </span>
        <span className={styles.resultCount}>
          {filteredResults.length} {t('search.results', { defaultValue: 'results' })}
        </span>
      </div>

      {/* Pagination */}
      {Math.ceil(filteredResults.length / itemsPerPage) > 1 && (
        <div className={styles.pagination}>
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className={styles.paginationBtn}
          >
            {t('search.previous', { defaultValue: 'Previous' })}
          </button>

          <div className={styles.pageNumbers}>
            {Array.from(
              { length: Math.ceil(filteredResults.length / itemsPerPage) },
              (_, i) => i + 1
            )
              .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === Math.ceil(filteredResults.length / itemsPerPage))
              .map((p, i, arr) => (
                <React.Fragment key={p}>
                  {i > 0 && arr[i - 1] !== p - 1 && <span className={styles.ellipsis}>...</span>}
                  <button
                    onClick={() => setPage(p)}
                    className={`${styles.pageBtn} ${p === page ? styles.active : ''}`}
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
          </div>

          <button
            onClick={() => setPage(Math.min(Math.ceil(filteredResults.length / itemsPerPage), page + 1))}
            disabled={page === Math.ceil(filteredResults.length / itemsPerPage)}
            className={styles.paginationBtn}
          >
            {t('search.next', { defaultValue: 'Next' })}
          </button>
        </div>
      )}
    </div>
  );
}

export default SearchFilters;
