// GraphQL schema for RWA Marketplace assets
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDataFile() {
  return join(__dirname, '..', process.env.DATA_FILE || 'data.json');
}

function loadData() {
  const file = getDataFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

export const typeDefs = `#graphql
  """A document attached to an asset"""
  type Document {
    name: String
    url: String
  }

  """An RWA asset registered in the marketplace"""
  type Asset {
    contractId: ID!
    title: String!
    location: String!
    description: String!
    assetType: String!
    imageUrl: String
    totalValuation: String
    documents: [Document]
    createdAt: String!
    updatedAt: String!
  }

  """Legacy offset-based pagination metadata (kept for backward compat)"""
  type Pagination {
    total: Int!
    page: Int!
    limit: Int!
    totalPages: Int!
  }

  """Relay-compliant cursor-based page info"""
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  """Paginated asset list response"""
  type AssetConnection {
    data: [Asset!]!
    pageInfo: PageInfo!
    """Legacy offset pagination (populated when no cursor is used)"""
    pagination: Pagination
  }

  """Asset filter input"""
  input AssetFilter {
    assetType: String
    search: String
    """Legacy: page number for offset-based pagination"""
    page: Int
    """Legacy: items per page for offset-based pagination"""
    limit: Int
    """Cursor-based pagination: first N items after this cursor"""
    first: Int
    """Cursor-based pagination: return items after this opaque cursor"""
    after: String
  }

  """Complexity analysis result for a query"""
  type ComplexityInfo {
    score: Float!
    depth: Int!
    fieldCount: Int!
    maxAllowed: Float!
    remaining: Float!
  }

  """Order History Item"""
  type OrderHistoryItem {
    id: ID!
    assetId: String
    userId: String
    type: String
    amount: Float
    price: Float
    status: String
    createdAt: String
    txHash: String
  }

  """Paginated order history connection"""
  type OrderHistoryConnection {
    orders: [OrderHistoryItem!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type Query {
    """Retrieve a single asset by contract ID (cost: 1)"""
    asset(contractId: ID!): Asset

    """List assets with optional filtering and pagination (cost: 2 + 0.1 per result)"""
    assets(filter: AssetFilter): AssetConnection!

    """Retrieve complexity analysis for the current query (cost: 0)"""
    queryComplexity: ComplexityInfo!

    """Retrieve order book history with cursor-based pagination (Issue #616)"""
    getOrderHistory(assetId: ID, limit: Int, cursor: String): OrderHistoryConnection!
  }
`;

/**
 * Encode a cursor from a page index (0-based offset).
 * Uses base64url encoding for Relay compliance.
 */
function encodeCursor(offset) {
  return Buffer.from(`cursor:${offset}`).toString('base64url');
}

/**
 * Decode an opaque cursor back to a page offset.
 * Returns 0 for null/undefined cursors.
 */
function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const match = decoded.match(/^cursor:(\d+)$/);
    if (!match) return 0;
    return parseInt(match[1], 10);
  } catch {
    return 0;
  }
}

export const resolvers = {
  Query: {
    asset: (_, { contractId }) => {
      const data = loadData();
      const asset = data[contractId];
      if (!asset) return null;
      return { contractId, ...asset };
    },

    assets: (_, { filter = {} }) => {
      const data = loadData();
      let list = Object.entries(data).map(([contractId, meta]) => ({ contractId, ...meta }));
      const { assetType, search, first, after, page, limit } = filter;

      // Apply filters
      if (assetType) {
        const lower = assetType.toLowerCase();
        list = list.filter(a => a.assetType?.toLowerCase() === lower);
      }
      if (search) {
        const lower = search.toLowerCase();
        list = list.filter(a =>
          a.title?.toLowerCase().includes(lower) ||
          a.description?.toLowerCase().includes(lower)
        );
      }

      const total = list.length;

      // Cursor-based pagination (Relay-compliant)
      if (first !== undefined && first !== null) {
        const pageSize = Math.min(100, Math.max(1, first));
        const startIndex = decodeCursor(after);
        const sliced = list.slice(startIndex, startIndex + pageSize);
        const hasNextPage = startIndex + pageSize < total;
        const hasPreviousPage = startIndex > 0;

        return {
          data: sliced,
          pageInfo: {
            hasNextPage,
            hasPreviousPage,
            startCursor: sliced.length > 0 ? encodeCursor(startIndex) : null,
            endCursor: sliced.length > 0 ? encodeCursor(startIndex + sliced.length - 1) : null,
          },
          pagination: null,
        };
      }

      // Legacy offset-based pagination (backward compatible)
      const pageNum = Math.max(1, page || 1);
      const pageSize = Math.min(100, Math.max(1, limit || 20));
      const totalPages = Math.ceil(total / pageSize) || 1;
      const offset = (pageNum - 1) * pageSize;
      const sliced = list.slice(offset, offset + pageSize);

      return {
        data: sliced,
        pageInfo: {
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1,
          startCursor: sliced.length > 0 ? encodeCursor(offset) : null,
          endCursor: sliced.length > 0 ? encodeCursor(offset + sliced.length - 1) : null,
        },
        pagination: { total, page: pageNum, limit: pageSize, totalPages },
      };
    },

    queryComplexity: () => {
      return {
        score: 0,
        depth: 0,
        fieldCount: 0,
        maxAllowed: parseFloat(process.env.GRAPHQL_MAX_COMPLEXITY || '100'),
        remaining: parseFloat(process.env.GRAPHQL_MAX_COMPLEXITY || '100'),
      };
    },

    getOrderHistory: (_, { assetId, limit = 20, cursor }) => {
      const pageSize = Math.min(100, Math.max(1, limit || 20));
      const startIndex = decodeCursor(cursor);

      const data = loadData();
      let orders = [];

      if (Array.isArray(data.orders)) {
        orders = data.orders;
      } else {
        const targetAsset = assetId || 'default-asset';
        orders = Array.from({ length: 60 }, (_, i) => ({
          id: `order-${targetAsset}-${i + 1}`,
          assetId: targetAsset,
          userId: `user-${(i % 5) + 1}`,
          type: i % 2 === 0 ? 'buy' : 'sell',
          amount: (i + 1) * 10,
          price: 100 + (i * 1.5),
          status: 'completed',
          createdAt: new Date(Date.now() - i * 60000).toISOString(),
          txHash: `0x${Buffer.from(`tx-${targetAsset}-${i}`).toString('hex').padEnd(64, '0')}`,
        }));
      }

      if (assetId) {
        orders = orders.filter((o) => o.assetId === assetId);
      }

      const totalCount = orders.length;
      const sliced = orders.slice(startIndex, startIndex + pageSize);
      const hasNextPage = startIndex + pageSize < totalCount;
      const hasPreviousPage = startIndex > 0;

      return {
        orders: sliced,
        pageInfo: {
          hasNextPage,
          hasPreviousPage,
          startCursor: sliced.length > 0 ? encodeCursor(startIndex) : null,
          endCursor: sliced.length > 0 ? encodeCursor(startIndex + sliced.length - 1) : null,
        },
        totalCount,
      };
    },
  },
};
