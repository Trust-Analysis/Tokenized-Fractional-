import paths from './openapi-paths.js';

const openapiDefinition = {
  openapi: '3.1.0',
  info: {
    title: 'Tokenized Fractional RWA Marketplace API',
    version: '2.0.0',
    description: `Off-chain metadata and event logging API for the Tokenized Fractional RWA (Real World Asset) marketplace. Provides CRUD for asset metadata, time-locked purchase window management, rate limiting administration, and cursor-based pagination across all list endpoints.

## Authentication

- **Public endpoints** (GET /health, GET /api/rwa, GET /api/rwa/:contractId) require no authentication but are rate-limited.
- **Admin endpoints** require the \`x-api-key\` header matching the server's configured \`ADMIN_API_KEY\`.

## Rate Limiting

All API routes (except admin rate-limit management) are rate-limited by configurable tiers. Rate limit headers (\`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`) are returned on every response. When exceeded, a \`429\` response is returned with a \`Retry-After\` header.

## Pagination

List endpoints use cursor-based pagination. Cursors are HMAC-signed base64url-encoded tokens. Pass \`after\` to get the next page or \`before\` to get the previous page. Each response includes \`pagination\` with \`nextCursor\` and \`prevCursor\` when available.`,
    contact: {
      name: 'Tokenized Fractional Team',
      url: 'https://github.com/damzempire/Tokenized-Fractional-',
    },
    license: {
      name: 'MIT',
      url: 'https://spdx.org/licenses/MIT.html',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development',
    },
    {
      url: 'https://api.tokenized-fractional.example.com',
      description: 'Production',
    },
  ],
  tags: [
    { name: 'Health', description: 'System health checks' },
    { name: 'Assets', description: 'RWA asset metadata CRUD' },
    { name: 'Admin', description: 'Administrative operations' },
    { name: 'Rate Limiting', description: 'Rate limit configuration and monitoring' },
    { name: 'Time Windows', description: 'Time-locked purchase window management' },
    { name: 'Time Window Events', description: 'Purchase window event logging and analytics' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Admin API key for protected endpoints. Configured via the ADMIN_API_KEY environment variable.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', description: 'Human-readable error message' },
          code: { type: 'string', description: 'Machine-readable error code for programmatic handling' },
          reason: { type: 'string', description: 'Additional context about the error (e.g., rate limit reason)' },
          upgrade: { type: 'string', description: 'Upgrade prompt shown when rate limit is exceeded' },
        },
        example: {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          reason: 'hourly_limit_reached',
          upgrade: 'Upgrade to a higher tier for increased limits',
        },
      },
      PaginationInfo: {
        type: 'object',
        required: ['limit', 'sort', 'order', 'total', 'hasNext', 'hasPrev'],
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size used for this response' },
          sort: { type: 'string', enum: ['createdAt', 'title', 'contractId', 'assetType', 'updatedAt', 'totalValuation'], description: 'Sort field used' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
          total: { type: 'integer', description: 'Total number of items matching the query (after filtering)' },
          hasNext: { type: 'boolean', description: 'Whether a next page is available' },
          hasPrev: { type: 'boolean', description: 'Whether a previous page is available' },
          nextCursor: { type: 'string', nullable: true, description: 'Cursor to pass as ?after= to get the next page' },
          prevCursor: { type: 'string', nullable: true, description: 'Cursor to pass as ?before= to get the previous page' },
        },
        example: {
          limit: 20,
          sort: 'createdAt',
          order: 'desc',
          total: 42,
          hasNext: true,
          hasPrev: false,
          nextCursor: 'eyJ2IjoxLCJzdiI6IjIwMjYtMDctMjlUMDA6MDA6MDAuMDAwWiIsInNzIjoi...',
        },
      },
      PaginatedAssetList: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Asset' },
          },
          pagination: { $ref: '#/components/schemas/PaginationInfo' },
        },
      },
      Asset: {
        type: 'object',
        required: ['contractId', 'title', 'location', 'description', 'assetType'],
        properties: {
          contractId: {
            type: 'string',
            description: 'Stellar contract ID (56+ chars, starts with "C")',
            minLength: 50,
            pattern: '^C[A-Za-z0-9]{55,}$',
            example: 'CCF7LXM6U6H6Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z',
          },
          id: { type: 'string', description: 'Optional display ID (defaults to contractId)' },
          title: { type: 'string', description: 'Asset title/name', example: 'Luxury Manhattan Condo Unit 12B' },
          location: { type: 'string', description: 'Asset location', example: 'New York, NY' },
          description: { type: 'string', description: 'Detailed asset description', example: 'A fully furnished 2-bedroom condo in the heart of Manhattan' },
          assetType: { type: 'string', description: 'Asset category', example: 'real_estate' },
          imageUrl: { type: 'string', format: 'uri', description: 'URL to asset image', example: 'https://ipfs.io/ipfs/QmX...' },
          totalValuation: { type: 'string', description: 'Total asset valuation (as string for precision)', example: '2500000.00' },
          documents: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            description: 'URLs to legal documents',
            example: ['https://ipfs.io/ipfs/QmY...'],
          },
          createdAt: { type: 'string', format: 'date-time', description: 'When the asset was created' },
          updatedAt: { type: 'string', format: 'date-time', description: 'When the asset was last updated' },
        },
      },
      AssetInput: {
        type: 'object',
        required: ['contractId', 'title', 'location', 'description', 'assetType'],
        properties: {
          contractId: {
            type: 'string',
            description: 'Stellar contract ID (must start with C, min 50 chars)',
            minLength: 50,
            pattern: '^C[A-Za-z0-9]{55,}$',
          },
          id: { type: 'string', description: 'Optional display ID' },
          title: { type: 'string', minLength: 1, description: 'Asset title' },
          location: { type: 'string', minLength: 1, description: 'Asset location' },
          description: { type: 'string', minLength: 1, description: 'Asset description' },
          assetType: { type: 'string', minLength: 1, description: 'Asset category' },
          imageUrl: { type: 'string', format: 'uri', description: 'URL to asset image' },
          totalValuation: { type: 'string', description: 'Total valuation' },
          documents: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
          },
        },
      },
      AssetCreatedResponse: {
        type: 'object',
        properties: {
          contractId: { $ref: '#/components/schemas/Asset/properties/contractId' },
          id: { type: 'string' },
          title: { type: 'string' },
          location: { type: 'string' },
          description: { type: 'string' },
          assetType: { type: 'string' },
          imageUrl: { type: 'string' },
          totalValuation: { type: 'string' },
          documents: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      DeleteResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Asset metadata deleted' },
          contractId: { type: 'string' },
        },
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'timestamp', 'dependencies'],
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'], description: 'Overall system status' },
          timestamp: { type: 'string', format: 'date-time', description: 'Current server time' },
          dependencies: {
            type: 'object',
            properties: {
              storage: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ok', 'error'] },
                },
              },
              redis: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ok', 'error', 'not_configured'] },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        example: {
          status: 'ok',
          timestamp: '2026-07-29T12:00:00.000Z',
          dependencies: {
            storage: { status: 'ok' },
            redis: { status: 'not_configured' },
          },
        },
      },
      TimeWindow: {
        type: 'object',
        properties: {
          windowId: { type: 'string', description: 'Time window identifier', example: 'presale-q3-2026' },
          title: { type: 'string', description: 'Window display name', example: 'Q3 2026 Presale' },
          description: { type: 'string', description: 'Window description' },
          imageUrl: { type: 'string', format: 'uri' },
          termsUrl: { type: 'string', format: 'uri' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TimeWindowInput: {
        type: 'object',
        required: ['windowId', 'title', 'description'],
        properties: {
          windowId: { type: 'string', description: 'Unique window identifier' },
          title: { type: 'string', description: 'Window display name' },
          description: { type: 'string', description: 'Window description' },
          imageUrl: { type: 'string', format: 'uri' },
          termsUrl: { type: 'string', format: 'uri' },
        },
      },
      TimeWindowListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/TimeWindow' } },
          total: { type: 'integer' },
        },
      },
      TimeWindowEvent: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Unique event ID (twe_ prefix)', example: 'twe_a1b2c3d4e5f6g7h8i9j0' },
          event_type: { type: 'string', description: 'Event type', enum: ['window.created', 'window.updated', 'window.cancelled', 'window.purchased', 'window.expired', 'window.recurring.started'] },
          contract_id: { type: 'string' },
          window_id: { type: 'string' },
          admin_address: { type: 'string', nullable: true, description: 'Stellar address of admin' },
          buyer_address: { type: 'string', nullable: true, description: 'Stellar address of buyer' },
          details: { type: 'object', description: 'Event-specific payload (e.g., shares, totalAmount)' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      TimeWindowEventInput: {
        type: 'object',
        required: ['eventType'],
        properties: {
          eventType: { type: 'string', description: 'Event type to log' },
          adminAddress: { type: 'string', description: 'Stellar address of admin performing the action' },
          buyerAddress: { type: 'string', description: 'Stellar address of buyer (for purchases)' },
          details: { type: 'object', description: 'Arbitrary event details' },
        },
      },
      PaginatedTimeWindowEvents: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/TimeWindowEvent' } },
          pagination: {
            type: 'object',
            properties: {
              limit: { type: 'integer' },
              total: { type: 'integer' },
              hasNext: { type: 'boolean' },
              hasPrev: { type: 'boolean' },
              nextCursor: { type: 'string', nullable: true },
              prevCursor: { type: 'string', nullable: true },
            },
          },
        },
      },
      TimeWindowAnalyticsResponse: {
        type: 'object',
        properties: {
          data: { $ref: '#/components/schemas/TimeWindowAnalytics' },
        },
      },
      TimeWindowAnalytics: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          windowId: { type: 'string' },
          totalPurchases: { type: 'integer' },
          uniqueBuyers: { type: 'integer' },
          totalSharesSold: { type: 'integer' },
          totalVolume: { type: 'number' },
          averageSharesPerBuyer: { type: 'number' },
          averageVolumePerPurchase: { type: 'number' },
        },
      },
      AggregateAnalyticsResponse: {
        type: 'object',
        properties: {
          data: { $ref: '#/components/schemas/AggregateAnalytics' },
        },
      },
      AggregateAnalytics: {
        type: 'object',
        properties: {
          contractId: { type: 'string' },
          totalWindows: { type: 'integer' },
          activeWindows: { type: 'integer' },
          cancelledWindows: { type: 'integer' },
          totalPurchases: { type: 'integer' },
          uniqueBuyers: { type: 'integer' },
          totalSharesSold: { type: 'integer' },
          totalVolume: { type: 'number' },
          windowsUtilizationRate: { type: 'integer', description: 'Percentage of windows with purchases' },
          averagePurchasesPerWindow: { type: 'number' },
        },
      },
      WindowTrendsResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', format: 'date' },
                purchases: { type: 'integer' },
                sharesSold: { type: 'integer' },
                volume: { type: 'number' },
                events: { type: 'integer' },
              },
            },
          },
        },
      },
      AdminVerifyResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', enum: [true] },
        },
      },
      RateLimitStatsList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/RateLimitKeyStats' } },
          total: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      RateLimitKeyStats: {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
          tier: { type: 'string' },
          usage: { type: 'object' },
          limits: { type: 'object' },
          blocked: { type: 'boolean' },
        },
      },
      RateLimitKeyStatsResponse: {
        type: 'object',
        properties: {
          data: { $ref: '#/components/schemas/RateLimitKeyStats' },
        },
      },
      RateLimitTiers: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Map of tier name to tier configuration', additionalProperties: true },
        },
      },
      TierUpdateRequest: {
        type: 'object',
        description: 'Partial tier configuration to update',
        additionalProperties: true,
      },
      TierUpdateResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          tier: { type: 'string' },
          config: { type: 'object', description: 'Updated tier configuration' },
        },
      },
      KeyConfigureRequest: {
        type: 'object',
        required: ['apiKey', 'tier'],
        properties: {
          apiKey: { type: 'string', description: 'API key to configure' },
          tier: { type: 'string', description: 'Rate limit tier name' },
          email: { type: 'string', format: 'email' },
        },
      },
      KeyConfigureResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          apiKey: { type: 'string', description: 'Partially masked API key' },
          tier: { type: 'string' },
        },
      },
      KeyResetResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
      AnalyticsSummaryResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Rate limit analytics summary' },
        },
      },
      AnalyticsExportResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Exported analytics data' },
        },
      },
      AnalyticsKeyResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Detailed per-key analytics' },
        },
      },
      AnomalyModelResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Anomaly detection model info' },
        },
      },
      AnomalyTrainRequest: {
        type: 'object',
        properties: {
          data: { type: 'array', description: 'Training data for the anomaly detection model' },
        },
      },
      AnomalyConfigResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          config: { type: 'object' },
        },
      },
      GeoStatsResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Per-country geo statistics' },
        },
      },
      GeoBlockRequest: {
        type: 'object',
        required: ['country'],
        properties: {
          country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code', example: 'XX' },
        },
      },
      GeoRestrictRequest: {
        type: 'object',
        required: ['country', 'limit'],
        properties: {
          country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
          limit: { type: 'integer', description: 'Max requests per hour for this country' },
        },
      },
      GeoActionResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
      BillingSubscriptionResponse: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Subscription details' },
        },
      },
      BillingUpgradeRequest: {
        type: 'object',
        required: ['apiKey', 'tier'],
        properties: {
          apiKey: { type: 'string' },
          tier: { type: 'string' },
        },
      },
      BillingUpgradeResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          data: { type: 'object', description: 'Updated subscription details' },
        },
      },
      BillingCancelRequest: {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string' },
        },
      },
      BillingCancelResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
      RateLimitHealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          services: {
            type: 'object',
            properties: {
              rateLimiter: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  activeKeys: { type: 'integer' },
                },
              },
              analytics: { type: 'object', properties: { status: { type: 'string' }, enabled: { type: 'boolean' } } },
              anomalyDetector: { type: 'object', properties: { status: { type: 'string' }, enabled: { type: 'boolean' } } },
              geoLimiter: { type: 'object', properties: { status: { type: 'string' }, enabled: { type: 'boolean' } } },
              billing: { type: 'object', properties: { status: { type: 'string' }, enabled: { type: 'boolean' } } },
            },
          },
        },
      },
    },
  },
  paths,
};

export default openapiDefinition;
