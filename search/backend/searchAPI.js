/**
 * Backend Search and Filtering API
 * Comprehensive filtering, sorting, and search capabilities
 */

import express from 'express';
import { logger } from './index.js';

/**
 * Search query builder and executor
 */
export class SearchQueryBuilder {
  constructor(data = {}) {
    this.data = data;
    this.filters = {};
    this.sortOptions = {};
    this.pagination = { page: 1, limit: 20 };
    this.searchTerm = '';
  }

  // Add text search
  search(term) {
    this.searchTerm = term?.toLowerCase() || '';
    return this;
  }

  // Filter by price range
  priceRange(min, max) {
    this.filters.priceMin = min;
    this.filters.priceMax = max;
    return this;
  }

  // Filter by asset type
  assetTypes(types = []) {
    this.filters.assetTypes = Array.isArray(types) ? types : [types];
    return this;
  }

  // Filter by availability
  availability(status) {
    this.filters.availability = status; // 'available', 'limited', 'unavailable'
    return this;
  }

  // Filter by category
  categories(cats = []) {
    this.filters.categories = Array.isArray(cats) ? cats : [cats];
    return this;
  }

  // Add sort option
  sort(field, direction = 'asc') {
    const validFields = ['price', 'name', 'createdAt', 'popularity', 'views'];
    const validDirections = ['asc', 'desc'];

    if (!validFields.includes(field) || !validDirections.includes(direction)) {
      return this;
    }

    this.sortOptions[field] = direction;
    return this;
  }

  // Set pagination
  paginate(page = 1, limit = 20) {
    this.pagination = {
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
    };
    return this;
  }

  // Execute search
  execute() {
    let results = Object.values(this.data);

    // Apply text search
    if (this.searchTerm) {
      results = results.filter(item =>
        item.title?.toLowerCase().includes(this.searchTerm) ||
        item.description?.toLowerCase().includes(this.searchTerm) ||
        item.location?.toLowerCase().includes(this.searchTerm)
      );
    }

    // Apply price filter
    if (this.filters.priceMin !== undefined || this.filters.priceMax !== undefined) {
      const min = this.filters.priceMin ?? 0;
      const max = this.filters.priceMax ?? Infinity;
      results = results.filter(item => item.price >= min && item.price <= max);
    }

    // Apply asset type filter
    if (this.filters.assetTypes?.length > 0) {
      results = results.filter(item =>
        this.filters.assetTypes.includes(item.assetType)
      );
    }

    // Apply availability filter
    if (this.filters.availability) {
      results = results.filter(item => {
        const availabilityStatus = this.getAvailabilityStatus(item);
        return availabilityStatus === this.filters.availability;
      });
    }

    // Apply category filter
    if (this.filters.categories?.length > 0) {
      results = results.filter(item =>
        this.filters.categories.includes(item.category)
      );
    }

    // Apply sorting
    if (Object.keys(this.sortOptions).length > 0) {
      for (const [field, direction] of Object.entries(this.sortOptions)) {
        results.sort((a, b) => {
          let aVal = a[field];
          let bVal = b[field];

          // Handle string comparison
          if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
            return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          }

          // Handle numeric comparison
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
      }
    }

    // Apply pagination
    const total = results.length;
    const startIndex = (this.pagination.page - 1) * this.pagination.limit;
    const endIndex = startIndex + this.pagination.limit;
    const paginatedResults = results.slice(startIndex, endIndex);

    return {
      results: paginatedResults,
      pagination: {
        page: this.pagination.page,
        limit: this.pagination.limit,
        total,
        totalPages: Math.ceil(total / this.pagination.limit),
      },
      filters: this.filters,
      sort: this.sortOptions,
    };
  }

  /**
   * Determine availability status
   */
  getAvailabilityStatus(item) {
    const available = item.totalShares - item.soldShares;
    if (available <= 0) return 'unavailable';
    if (available < 10) return 'limited';
    return 'available';
  }

  /**
   * Get available filter options
   */
  getFilterOptions() {
    const results = Object.values(this.data);

    return {
      priceRange: {
        min: Math.min(...results.map(r => r.price ?? 0)),
        max: Math.max(...results.map(r => r.price ?? 0)),
      },
      assetTypes: [...new Set(results.map(r => r.assetType).filter(Boolean))],
      categories: [...new Set(results.map(r => r.category).filter(Boolean))],
      availabilityStatuses: ['available', 'limited', 'unavailable'],
    };
  }
}

/**
 * Create search routes
 */
export function createSearchRoutes(data) {
  const router = express.Router();

  /**
   * GET /api/search - Advanced search with filters
   */
  router.get('/search', (req, res) => {
    try {
      const {
        q,                          // search term
        priceMin,
        priceMax,
        assetType,
        category,
        availability,
        sortBy = 'name',            // field to sort by
        sortDirection = 'asc',      // asc or desc
        page = 1,
        limit = 20,
      } = req.query;

      const builder = new SearchQueryBuilder(data);

      // Build query
      if (q) builder.search(q);
      if (priceMin !== undefined || priceMax !== undefined) {
        builder.priceRange(
          priceMin ? parseFloat(priceMin) : undefined,
          priceMax ? parseFloat(priceMax) : undefined
        );
      }
      if (assetType) builder.assetTypes(assetType.split(','));
      if (category) builder.categories(category.split(','));
      if (availability) builder.availability(availability);
      builder.sort(sortBy, sortDirection);
      builder.paginate(page, limit);

      const result = builder.execute();

      // Log search analytics
      logger.info('Search executed', {
        searchTerm: q,
        resultCount: result.results.length,
        filters: result.filters,
      });

      return res.json(result);
    } catch (error) {
      logger.error('Search error', { error: error.message });
      return res.status(500).json({ error: 'Search failed' });
    }
  });

  /**
   * GET /api/search/filters - Get available filter options
   */
  router.get('/search/filters', (req, res) => {
    try {
      const builder = new SearchQueryBuilder(data);
      const filterOptions = builder.getFilterOptions();

      return res.json(filterOptions);
    } catch (error) {
      logger.error('Filter options error', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch filter options' });
    }
  });

  /**
   * POST /api/search/advanced - Advanced search with complex filters
   */
  router.post('/search/advanced', (req, res) => {
    try {
      const {
        query,
        filters = {},
        sort = {},
        pagination = { page: 1, limit: 20 },
      } = req.body;

      const builder = new SearchQueryBuilder(data);

      if (query) builder.search(query);

      // Apply filters
      if (filters.priceRange) {
        builder.priceRange(filters.priceRange.min, filters.priceRange.max);
      }
      if (filters.assetTypes) builder.assetTypes(filters.assetTypes);
      if (filters.categories) builder.categories(filters.categories);
      if (filters.availability) builder.availability(filters.availability);

      // Apply sort
      if (sort.field) {
        builder.sort(sort.field, sort.direction || 'asc');
      }

      // Apply pagination
      builder.paginate(pagination.page, pagination.limit);

      const result = builder.execute();
      return res.json(result);
    } catch (error) {
      logger.error('Advanced search error', { error: error.message });
      return res.status(500).json({ error: 'Advanced search failed' });
    }
  });

  /**
   * GET /api/search/suggestions - Search suggestions
   */
  router.get('/search/suggestions', (req, res) => {
    try {
      const { q = '' } = req.query;
      const term = q.toLowerCase();

      const suggestions = new Set();
      Object.values(data).forEach(item => {
        if (item.title?.toLowerCase().startsWith(term)) suggestions.add(item.title);
        if (item.location?.toLowerCase().startsWith(term)) suggestions.add(item.location);
        if (item.assetType?.toLowerCase().startsWith(term)) suggestions.add(item.assetType);
      });

      return res.json({
        suggestions: Array.from(suggestions).slice(0, 10),
      });
    } catch (error) {
      logger.error('Suggestions error', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
  });

  /**
   * GET /api/search/trending - Trending searches
   */
  router.get('/search/trending', (req, res) => {
    try {
      // This would connect to analytics in production
      const trendingAssets = Object.values(data)
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5);

      return res.json({
        trending: trendingAssets.map(asset => ({
          id: asset.id,
          title: asset.title,
          views: asset.views || 0,
        })),
      });
    } catch (error) {
      logger.error('Trending error', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch trending' });
    }
  });

  return router;
}

export default SearchQueryBuilder;
