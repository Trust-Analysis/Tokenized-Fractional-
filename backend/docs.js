const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RWA Marketplace — Off-chain Metadata API',
      version: '2.0.0',
      description:
        'Backend API for managing real-world asset (RWA) metadata in the Tokenized Fractional RWA Marketplace. ' +
        'Supports listing, creating, updating, and deleting asset metadata that is linked to on-chain Soroban smart contracts.',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Admin API key for write operations.',
        },
      },
      schemas: {
        Asset: {
          type: 'object',
          properties: {
            contractId: { type: 'string', description: 'Soroban contract ID (starts with C)' },
            title: { type: 'string', example: 'Luxury Apartment Complex' },
            location: { type: 'string', example: 'New York, USA' },
            description: { type: 'string', example: 'A premium residential property in downtown Manhattan.' },
            assetType: { type: 'string', example: 'real_estate' },
            imageUrl: { type: 'string', format: 'uri', example: 'https://example.com/image.jpg' },
            totalValuation: { type: 'string', example: '$5,000,000' },
            documents: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AssetInput: {
          type: 'object',
          required: ['contractId', 'title', 'location', 'description', 'assetType'],
          properties: {
            contractId: { type: 'string' },
            title: { type: 'string' },
            location: { type: 'string' },
            description: { type: 'string' },
            assetType: { type: 'string' },
            imageUrl: { type: 'string', format: 'uri' },
            totalValuation: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            dependencies: {
              type: 'object',
              properties: {
                storage: { type: 'object', properties: { status: { type: 'string' } } },
                redis: { type: 'object', properties: { status: { type: 'string' } } },
              },
            },
          },
        },
        PaginatedAssets: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Asset' } },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          description: 'Returns the server status and dependency health.',
          responses: {
            '200': {
              description: 'Server is healthy',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
            '503': {
              description: 'Dependency degraded (e.g. Redis unreachable)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
          },
        },
      },
      '/api/rwa': {
        get: {
          tags: ['Assets'],
          summary: 'List all asset metadata',
          description: 'Returns a paginated, filterable list of all RWA assets.',
          parameters: [
            { in: 'query', name: 'page', schema: { type: 'integer', default: 1 }, description: 'Page number' },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 }, description: 'Items per page (max 100)' },
            { in: 'query', name: 'assetType', schema: { type: 'string' }, description: 'Filter by asset type (case-insensitive)' },
            { in: 'query', name: 'search', schema: { type: 'string' }, description: 'Full-text search on title and description' },
          ],
          responses: {
            '200': {
              description: 'Paginated list of assets',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedAssets' } } },
            },
          },
        },
        post: {
          tags: ['Assets'],
          summary: 'Create or update asset metadata',
          description: 'Requires admin API key via `x-api-key` header.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetInput' } } },
          },
          responses: {
            '201': {
              description: 'Asset created or updated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/rwa/{contractId}': {
        get: {
          tags: ['Assets'],
          summary: 'Get asset metadata by contract ID',
          parameters: [
            { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Soroban contract ID' },
          ],
          responses: {
            '200': {
              description: 'Asset metadata',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } },
            },
            '404': {
              description: 'Asset not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          tags: ['Assets'],
          summary: 'Delete asset metadata',
          description: 'Requires admin API key via `x-api-key` header.',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { in: 'path', name: 'contractId', required: true, schema: { type: 'string' }, description: 'Soroban contract ID' },
          ],
          responses: {
            '200': {
              description: 'Asset deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      contractId: { type: 'string' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Asset not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/admin/verify': {
        get: {
          tags: ['Admin'],
          summary: 'Verify admin API key',
          description: 'Checks whether the provided `x-api-key` is valid.',
          security: [{ ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Key is valid',
              content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
            },
            '401': {
              description: 'Invalid or missing key',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = options.definition;
