const paths = {
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'System health check',
      description: 'Returns overall system status, timestamp, and dependency health (storage, Redis). Returns 503 degraded status if Redis is configured but unreachable.',
      responses: {
        200: {
          description: 'System is healthy',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
        },
        503: {
          description: 'System is degraded (dependency failure)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
        },
      },
    },
  },

  '/api/admin/verify': {
    get: {
      tags: ['Admin'],
      summary: 'Verify admin API key',
      description: 'Returns ok:true if the x-api-key header matches the configured ADMIN_API_KEY. Used for testing authentication.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'API key is valid',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminVerifyResponse' } } },
        },
        401: {
          description: 'Invalid or missing API key',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
  },

  '/api/rwa': {
    get: {
      tags: ['Assets'],
      summary: 'List RWA assets (cursor-based pagination)',
      description: 'Returns a paginated list of RWA asset metadata. Supports cursor-based pagination, field-based sorting, asset type filtering, and text search. Results are cached in Redis when available. The default sort is by createdAt descending (most recent first).',
      parameters: [
        { in: 'query', name: 'after', schema: { type: 'string' }, description: 'Cursor for forward pagination (received from previous response nextCursor)' },
        { in: 'query', name: 'before', schema: { type: 'string' }, description: 'Cursor for backward pagination (received from previous response prevCursor)' },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, description: 'Maximum number of items per page' },
        { in: 'query', name: 'sort', schema: { type: 'string', enum: ['createdAt', 'title', 'contractId', 'assetType', 'updatedAt', 'totalValuation'], default: 'createdAt' }, description: 'Field to sort by' },
        { in: 'query', name: 'order', schema: { type: 'string', enum: ['asc', 'desc'] }, description: 'Sort direction (defaults per field)' },
        { in: 'query', name: 'assetType', schema: { type: 'string' }, description: 'Filter by asset type (case-insensitive exact match)' },
        { in: 'query', name: 'search', schema: { type: 'string' }, description: 'Search term for case-insensitive matching against title and description' },
      ],
      responses: {
        200: {
          description: 'Paginated list of assets',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedAssetList' } } },
        },
        400: {
          description: 'Invalid cursor or pagination parameters',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        429: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
    post: {
      tags: ['Assets'],
      summary: 'Create or update RWA asset metadata (admin)',
      description: 'Creates a new asset metadata record or updates an existing one. Requires admin authentication. The contractId must be at least 50 characters starting with C. Required fields: title, location, description, assetType. Invalidates Redis cache on success.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetInput' } } },
      },
      responses: {
        201: {
          description: 'Asset created or updated successfully',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetCreatedResponse' } } },
        },
        400: {
          description: 'Invalid request body or contract ID',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        401: {
          description: 'Invalid or missing API key',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        429: {
          description: 'Rate limit exceeded (write limiter)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
  },

  '/api/rwa/{contractId}': {
    get: {
      tags: ['Assets'],
      summary: 'Get single RWA asset metadata',
      description: 'Returns metadata for a specific RWA asset by contract ID. Results are cached in Redis (if configured) for subsequent requests.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string', minLength: 50, pattern: '^C[A-Za-z0-9]+$' }, description: 'Stellar contract ID of the asset' },
      ],
      responses: {
        200: {
          description: 'Asset metadata',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } },
        },
        404: {
          description: 'Asset not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        429: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
    delete: {
      tags: ['Assets'],
      summary: 'Delete RWA asset metadata (admin)',
      description: 'Deletes an asset metadata record by contract ID. Requires admin authentication. Invalidates Redis cache on success.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string', minLength: 50 }, description: 'Stellar contract ID of the asset to delete' },
      ],
      responses: {
        200: {
          description: 'Asset deleted successfully',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteResponse' } } },
        },
        401: {
          description: 'Invalid or missing API key',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        404: {
          description: 'Asset not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        429: {
          description: 'Rate limit exceeded (write limiter)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
  },

  '/time-windows/{contractId}': {
    get: {
      tags: ['Time Windows'],
      summary: 'List time windows for an asset',
      description: 'Returns all time-locked purchase windows associated with a given asset contract ID.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string', minLength: 50 }, description: 'Asset contract ID' },
      ],
      responses: {
        200: {
          description: 'List of time windows',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindowListResponse' } } },
        },
        400: { description: 'Invalid contract ID' },
        404: { description: 'Asset not found' },
        500: { description: 'Internal server error' },
      },
    },
    post: {
      tags: ['Time Windows'],
      summary: 'Create time window metadata (admin)',
      description: 'Creates a new time-locked purchase window for an asset. Requires admin authentication. Required: windowId, title, description. Logs a window.metadata.created event on success.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindowInput' } } },
      },
      responses: {
        201: {
          description: 'Time window created',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindow' } } },
        },
        400: { description: 'Invalid contract ID or missing required fields' },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'Asset not found' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/{windowId}': {
    get: {
      tags: ['Time Windows'],
      summary: 'Get single time window',
      description: 'Returns metadata for a specific time-locked purchase window.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string', minLength: 50 }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
      ],
      responses: {
        200: {
          description: 'Time window metadata',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindow' } } },
        },
        400: { description: 'Invalid contract ID' },
        404: { description: 'Asset or time window not found' },
        500: { description: 'Internal server error' },
      },
    },
    put: {
      tags: ['Time Windows'],
      summary: 'Update time window metadata (admin)',
      description: 'Updates an existing time window metadata. Partial updates supported. Logs a window.metadata.updated event.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                imageUrl: { type: 'string' },
                termsUrl: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Time window updated',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindow' } } },
        },
        400: { description: 'Invalid contract ID' },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'Asset or time window not found' },
        500: { description: 'Internal server error' },
      },
    },
    delete: {
      tags: ['Time Windows'],
      summary: 'Delete time window metadata (admin)',
      description: 'Deletes a time window and its metadata. Logs a window.metadata.deleted event.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
      ],
      responses: {
        200: {
          description: 'Time window deleted',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteResponse' } } },
        },
        400: { description: 'Invalid contract ID' },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'Time window not found' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/{windowId}/events': {
    get: {
      tags: ['Time Window Events'],
      summary: 'Get events for a time window (cursor-based)',
      description: 'Returns paginated events for a specific time window. Supports cursor-based pagination using event ID + timestamp cursors.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
        { in: 'query', name: 'limit', schema: { type: 'integer', default: 50 }, description: 'Maximum events per page' },
        { in: 'query', name: 'after', schema: { type: 'string' }, description: 'Cursor for forward pagination' },
        { in: 'query', name: 'before', schema: { type: 'string' }, description: 'Cursor for backward pagination' },
      ],
      responses: {
        200: {
          description: 'Paginated events',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedTimeWindowEvents' } } },
        },
        400: { description: 'Invalid contract ID' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/{windowId}/analytics': {
    get: {
      tags: ['Time Window Events'],
      summary: 'Get analytics for a time window',
      description: 'Returns purchase analytics (total purchases, unique buyers, shares sold, volume, averages) for a specific time window.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
      ],
      responses: {
        200: {
          description: 'Window analytics',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindowAnalyticsResponse' } } },
        },
        400: { description: 'Invalid contract ID' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/{windowId}/log': {
    post: {
      tags: ['Time Window Events'],
      summary: 'Manually log a time window event (admin)',
      description: 'Manually records a time window event for backfilling or testing. Requires admin authentication. Only eventType is required.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'path', name: 'windowId', required: true, schema: { type: 'string' }, description: 'Time window identifier' },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeWindowEventInput' } } },
      },
      responses: {
        201: {
          description: 'Event logged successfully',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedTimeWindowEvents' } } },
        },
        400: { description: 'Invalid contract ID or missing eventType' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/analytics/aggregate': {
    get: {
      tags: ['Time Window Events'],
      summary: 'Get aggregate analytics across all windows',
      description: 'Returns aggregated analytics across all time windows for an asset, including total windows, active vs cancelled, total volume, utilization rate.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
      ],
      responses: {
        200: {
          description: 'Aggregate analytics',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AggregateAnalyticsResponse' } } },
        },
        400: { description: 'Invalid contract ID' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/analytics/trends': {
    get: {
      tags: ['Time Window Events'],
      summary: 'Get usage trends over time',
      description: 'Returns daily aggregated event data (purchases, shares sold, volume) for the specified lookback period.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'query', name: 'days', schema: { type: 'integer', default: 30, minimum: 1 }, description: 'Number of days to look back' },
      ],
      responses: {
        200: {
          description: 'Daily trend data',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WindowTrendsResponse' } } },
        },
        400: { description: 'Invalid contract ID' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/time-windows/{contractId}/events': {
    get: {
      tags: ['Time Window Events'],
      summary: 'Get all events for an asset time windows (cursor-based)',
      description: 'Returns cursor-paginated events across all time windows for an asset. Supports filtering by eventType, date range (from/to), and cursor pagination.',
      parameters: [
        { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Asset contract ID' },
        { in: 'query', name: 'eventType', schema: { type: 'string' }, description: 'Filter by event type' },
        { in: 'query', name: 'from', schema: { type: 'string', format: 'date-time' }, description: 'Start date (ISO 8601)' },
        { in: 'query', name: 'to', schema: { type: 'string', format: 'date-time' }, description: 'End date (ISO 8601)' },
        { in: 'query', name: 'limit', schema: { type: 'integer', default: 100 }, description: 'Maximum events per page' },
        { in: 'query', name: 'after', schema: { type: 'string' }, description: 'Cursor for forward pagination' },
        { in: 'query', name: 'before', schema: { type: 'string' }, description: 'Cursor for backward pagination' },
      ],
      responses: {
        200: {
          description: 'Paginated events',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedTimeWindowEvents' } } },
        },
        400: { description: 'Invalid contract ID' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/stats': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get all rate limit stats (admin)',
      description: 'Returns rate limit usage statistics for all configured API keys.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'Rate limit stats for all keys',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimitStatsList' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/stats/{apiKey}': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get per-key rate limit stats (admin)',
      description: 'Returns detailed rate limit usage statistics for a specific API key.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'apiKey', required: true, schema: { type: 'string' }, description: 'API key to query' },
      ],
      responses: {
        200: {
          description: 'Per-key rate limit stats',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimitKeyStatsResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'No stats found for this API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/tiers': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get available rate limit tiers (admin)',
      description: 'Returns all configured rate limit tiers and their configurations.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'Available tiers',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimitTiers' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/tiers/{tier}': {
    put: {
      tags: ['Rate Limiting'],
      summary: 'Update tier configuration (admin)',
      description: 'Updates the configuration for a specific rate limit tier. Accepts partial updates.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'tier', required: true, schema: { type: 'string' }, description: 'Tier name to update' },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/TierUpdateRequest' } } },
      },
      responses: {
        200: {
          description: 'Tier updated',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TierUpdateResponse' } } },
        },
        400: { description: 'Invalid configuration' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/configure': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Configure API key rate limits (admin)',
      description: 'Assigns a rate limit tier to an API key. Optionally creates a billing subscription.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/KeyConfigureRequest' } } },
      },
      responses: {
        200: {
          description: 'API key configured',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/KeyConfigureResponse' } } },
        },
        400: { description: 'Missing required fields (apiKey, tier)' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/reset/{apiKey}': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Reset rate limit counters (admin)',
      description: 'Resets all rate limit counters for a specific API key.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'apiKey', required: true, schema: { type: 'string' }, description: 'API key whose counters should be reset' },
      ],
      responses: {
        200: {
          description: 'Counters reset',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/KeyResetResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/analytics/summary': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get rate limit analytics summary (admin)',
      description: 'Returns a summary of rate limit analytics including usage patterns and key metrics.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'Analytics summary',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsSummaryResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/analytics/export': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Export analytics data (admin)',
      description: 'Exports rate limit analytics data with optional date range and format filters.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'query', name: 'from', schema: { type: 'string' }, description: 'Start date' },
        { in: 'query', name: 'to', schema: { type: 'string' }, description: 'End date' },
        { in: 'query', name: 'format', schema: { type: 'string' }, description: 'Export format' },
      ],
      responses: {
        200: {
          description: 'Exported analytics data',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsExportResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/analytics/key/{apiKey}': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get per-key analytics (admin)',
      description: 'Returns detailed rate limit analytics for a specific API key.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'apiKey', required: true, schema: { type: 'string' }, description: 'API key' },
      ],
      responses: {
        200: {
          description: 'Per-key analytics',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsKeyResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/anomaly/model': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get anomaly detection model info (admin)',
      description: 'Returns current anomaly detection model configuration and statistics.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'Model info',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnomalyModelResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/anomaly/train': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Train anomaly detection model (admin)',
      description: 'Trains the anomaly detection model with provided data.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AnomalyTrainRequest' } } },
      },
      responses: {
        200: {
          description: 'Model trained',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnomalyModelResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/anomaly/config': {
    put: {
      tags: ['Rate Limiting'],
      summary: 'Configure anomaly detector (admin)',
      description: 'Updates anomaly detector parameters (burstThreshold, timeWindowMs, confidenceThreshold).',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                burstThreshold: { type: 'integer' },
                timeWindowMs: { type: 'integer' },
                confidenceThreshold: { type: 'number' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Anomaly detector configured',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AnomalyConfigResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/geo/stats': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get geo statistics (admin)',
      description: 'Returns per-country rate limit usage statistics.',
      security: [{ ApiKeyAuth: [] }],
      responses: {
        200: {
          description: 'Geo stats',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoStatsResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/geo/block': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Block a country (admin)',
      description: 'Adds a country to the blocked list. All requests from this country will be denied.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoBlockRequest' } } },
      },
      responses: {
        200: {
          description: 'Country blocked',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoActionResponse' } } },
        },
        400: { description: 'Missing country code' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/geo/unblock': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Unblock a country (admin)',
      description: 'Removes a country from the blocked list.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoBlockRequest' } } },
      },
      responses: {
        200: {
          description: 'Country unblocked',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoActionResponse' } } },
        },
        400: { description: 'Missing country code' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/geo/restrict': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Restrict a country rate limit (admin)',
      description: 'Sets a custom rate limit for a specific country.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoRestrictRequest' } } },
      },
      responses: {
        200: {
          description: 'Country restricted',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GeoActionResponse' } } },
        },
        400: { description: 'Missing country or limit' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/billing/subscription/{apiKey}': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Get billing subscription (admin)',
      description: 'Returns subscription details for a specific API key.',
      security: [{ ApiKeyAuth: [] }],
      parameters: [
        { in: 'path', name: 'apiKey', required: true, schema: { type: 'string' }, description: 'API key' },
      ],
      responses: {
        200: {
          description: 'Subscription details',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingSubscriptionResponse' } } },
        },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'No subscription found' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/billing/upgrade': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Upgrade subscription (admin)',
      description: 'Upgrades an existing subscription to a higher tier.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingUpgradeRequest' } } },
      },
      responses: {
        200: {
          description: 'Subscription upgraded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingUpgradeResponse' } } },
        },
        400: { description: 'Missing apiKey or tier' },
        401: { description: 'Invalid or missing API key' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/billing/cancel': {
    post: {
      tags: ['Rate Limiting'],
      summary: 'Cancel subscription (admin)',
      description: 'Cancels an existing billing subscription for an API key.',
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingCancelRequest' } } },
      },
      responses: {
        200: {
          description: 'Subscription cancelled',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BillingCancelResponse' } } },
        },
        400: { description: 'Missing apiKey' },
        401: { description: 'Invalid or missing API key' },
        404: { description: 'No subscription found' },
        500: { description: 'Internal server error' },
      },
    },
  },

  '/api/admin/rate-limits/health': {
    get: {
      tags: ['Rate Limiting'],
      summary: 'Rate limiter subsystem health',
      description: 'Returns health status of all rate limiting subsystems.',
      responses: {
        200: {
          description: 'Rate limiter health',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimitHealthResponse' } } },
        },
      },
    },
  },
};

export default paths;
