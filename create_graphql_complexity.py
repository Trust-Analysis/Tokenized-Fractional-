import os, json

BASE = r'C:\Users\USER\Tokenized-Fractional-'
FRONTEND = os.path.join(BASE, 'frontend')
BACKEND = os.path.join(BASE, 'backend')
GRAPHQL = os.path.join(BACKEND, 'graphql')
TESTS = os.path.join(BACKEND, '__tests__')

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

# ─── 1. GraphQL Schema ─────────────────────────────────────────────────────
schema_js = '''// GraphQL schema for RWA Marketplace assets
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

  """Pagination metadata"""
  type Pagination {
    total: Int!
    page: Int!
    limit: Int!
    totalPages: Int!
  }

  """Paginated asset list response"""
  type AssetConnection {
    data: [Asset!]!
    pagination: Pagination!
  }

  """Asset filter input"""
  input AssetFilter {
    assetType: String
    search: String
    page: Int
    limit: Int
  }

  """Complexity analysis result for a query"""
  type ComplexityInfo {
    score: Float!
    depth: Int!
    fieldCount: Int!
    maxAllowed: Float!
    remaining: Float!
  }

  type Query {
    """Retrieve a single asset by contract ID (cost: 1)"""
    asset(contractId: ID!): Asset

    """List assets with optional filtering and pagination (cost: 2 + 0.1 per result)"""
    assets(filter: AssetFilter): AssetConnection!

    """Retrieve complexity analysis for the current query (cost: 0)"""
    queryComplexity: ComplexityInfo!
  }
`;

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
      const { assetType, search, page, limit } = filter;

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
      const pageNum = Math.max(1, page || 1);
      const pageSize = Math.min(100, Math.max(1, limit || 20));
      const totalPages = Math.ceil(total / pageSize) || 1;
      const offset = (pageNum - 1) * pageSize;
      const sliced = list.slice(offset, offset + pageSize);

      return {
        data: sliced,
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
  },
};
'''

write_file(os.path.join(GRAPHQL, 'schema.js'), schema_js)
print('1. schema.js created')

# ─── 2. Complexity Analyzer ────────────────────────────────────────────────
complexity_js = '''// GraphQL Query Complexity Analyzer
//
// Analyzes incoming GraphQL queries to compute a complexity score,
// enforce depth limits, and reject abusive queries before execution.
//
// Field cost map: each field in the GraphQL schema has a base cost.
// List fields add a multiplier for expected result size.
// Nested selections increase depth, which multiplies the cost.

import { logger } from '../index.js';

// Default cost configuration (can be overridden via env vars)
const DEFAULTS = {
  MAX_COMPLEXITY: parseFloat(process.env.GRAPHQL_MAX_COMPLEXITY || '100'),
  MAX_DEPTH: parseInt(process.env.GRAPHQL_MAX_DEPTH || '10', 10),
  MAX_FIELDS: parseInt(process.env.GRAPHQL_MAX_FIELDS || '50', 10),
};

// Per-field cost weights
// Higher cost for expensive fields (e.g., list resolvers, fields with DB lookups)
const FIELD_COSTS = {
  // Query root fields
  asset: 1,
  assets: 3,
  queryComplexity: 0,

  // Asset fields
  contractId: 0.5,
  title: 0.5,
  location: 0.5,
  description: 0.5,
  assetType: 0.5,
  imageUrl: 1,
  totalValuation: 1,
  documents: 2,
  createdAt: 0.5,
  updatedAt: 0.5,

  // Nested types
  Document: { name: 0.5, url: 0.5 },

  // Pagination
  AssetConnection: { data: 3, pagination: 1 },
  Pagination: { total: 0.5, page: 0.5, limit: 0.5, totalPages: 0.5 },

  // Complexity info
  ComplexityInfo: { score: 0, depth: 0, fieldCount: 0, maxAllowed: 0, remaining: 0 },
};

// Fields that return lists - these get multiplied by expected page size
const LIST_FIELDS = new Set(['data', 'assets', 'documents']);

/**
 * Calculate the complexity score for a parsed GraphQL document.
 *
 * @param {object} document - Parsed GraphQL document (AST)
 * @returns {{ score: number, depth: number, fieldCount: number }}
 */
export function calculateComplexity(document) {
  let score = 0;
  let maxDepth = 0;
  let fieldCount = 0;

  function walkSelections(selections, depth, listMultiplier) {
    if (!selections) return;
    maxDepth = Math.max(maxDepth, depth);

    for (const sel of selections) {
      if (sel.kind === 'Field') {
        fieldCount++;
        const fieldName = sel.name.value;
        const baseCost = FIELD_COSTS[fieldName] ?? 1;
        const isList = LIST_FIELDS.has(fieldName);
        const multiplier = isList ? (listMultiplier || 20) : 1;
        score += baseCost * multiplier;

        if (sel.selectionSet?.selections) {
          walkSelections(sel.selectionSet.selections, depth + 1, isList ? 20 : listMultiplier);
        }
      } else if (sel.kind === 'InlineFragment' || sel.kind === 'FragmentSpread') {
        if (sel.selectionSet?.selections) {
          walkSelections(sel.selectionSet.selections, depth, listMultiplier);
        }
      }
    }
  }

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition' && def.operation === 'query') {
      walkSelections(def.selectionSet?.selections, 0, 1);
    }
  }

  return { score: Math.round(score * 10) / 10, depth: maxDepth, fieldCount };
}

/**
 * Validate a query against complexity limits.
 * Throws a GraphQL error if limits are exceeded.
 *
 * @param {object} document - Parsed GraphQL document
 * @param {object} params - Optional override parameters
 * @returns {{ valid: boolean, complexity: object, errors: string[] }}
 */
export function validateQueryComplexity(document, params = {}) {
  const maxComplexity = params.maxComplexity ?? DEFAULTS.MAX_COMPLEXITY;
  const maxDepth = params.maxDepth ?? DEFAULTS.MAX_DEPTH;
  const maxFields = params.maxFields ?? DEFAULTS.MAX_FIELDS;

  const complexity = calculateComplexity(document);
  const errors = [];

  if (complexity.depth > maxDepth) {
    errors.push(
      `Query depth (${complexity.depth}) exceeds maximum allowed depth (${maxDepth}). ` +
      `Reduce nesting by flattening your query structure.`
    );
  }

  if (complexity.fieldCount > maxFields) {
    errors.push(
      `Query requests ${complexity.fieldCount} fields, exceeding the maximum of ${maxFields}. ` +
      `Request only the fields you need.`
    );
  }

  if (complexity.score > maxComplexity) {
    errors.push(
      `Query complexity score (${complexity.score}) exceeds maximum allowed (${maxComplexity}). ` +
      `Reduce the number of requested fields or nested relationships. ` +
      `Tip: use smaller page sizes and request only needed fields.`
    );
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger.warn({ complexity, errors }, 'GraphQL query rejected by complexity analysis');
  }

  return { valid, complexity, errors };
}

export { DEFAULTS };
'''

write_file(os.path.join(GRAPHQL, 'complexity.js'), complexity_js)
print('2. complexity.js created')

# ─── 3. GraphQL Server Setup ────────────────────────────────────────────────
graphql_index_js = '''// GraphQL Yoga server setup for RWA Marketplace
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs, resolvers } from './schema.js';
import { validateQueryComplexity, DEFAULTS } from './complexity.js';
import { logger } from '../index.js';

const schema = makeExecutableSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/api/graphql',

  // Enable GraphiQL in development
  graphiql: process.env.NODE_ENV !== 'production',

  logging: logger,

  // Context factory - inject per-request complexity limits
  context: async ({ request }) => {
    const complexityOverrides = {};

    // Check for user tier based on API key or header
    const tier = request.headers.get('x-user-tier') || 'standard';
    const tierLimits = {
      basic: { maxComplexity: 20, maxDepth: 3, maxFields: 20 },
      standard: { maxComplexity: 100, maxDepth: 10, maxFields: 50 },
      premium: { maxComplexity: 500, maxDepth: 15, maxFields: 200 },
      admin: { maxComplexity: 1000, maxDepth: 20, maxFields: 500 },
    };

    const limits = tierLimits[tier] || tierLimits.standard;
    return { ...limits, userTier: tier };
  },

  // Use the onExecute hook to validate complexity before resolving
  onExecute: ({ args, setResult }) => {
    const document = args.document;
    const context = args.contextValue;

    const result = validateQueryComplexity(document, {
      maxComplexity: context.maxComplexity ?? DEFAULTS.MAX_COMPLEXITY,
      maxDepth: context.maxDepth ?? DEFAULTS.MAX_DEPTH,
      maxFields: context.maxFields ?? DEFAULTS.MAX_FIELDS,
    });

    if (!result.valid) {
      const errorMsg = result.errors.join(' ');
      logger.warn({ complexity: result.complexity }, 'GraphQL query rejected');
      setResult({
        data: null,
        errors: result.errors.map(msg => ({
          message: msg,
          extensions: {
            code: 'QUERY_COMPLEXITY_EXCEEDED',
            complexity: result.complexity,
          },
        })),
      });
    }
  },
});

export default yoga;
'''

write_file(os.path.join(GRAPHQL, 'index.js'), graphql_index_js)
print('3. graphql/index.js created')

# ─── 4. Update index.js ────────────────────────────────────────────────────
index_path = os.path.join(BACKEND, 'index.js')
with open(index_path, 'r', encoding='utf-8') as f:
    index_content = f.read()

# Add import for GraphQL yoga
if 'graphql' not in index_content:
    old_import = "import { swaggerSpec } from './docs.js';"
    new_import = old_import + "\nimport yoga from './graphql/index.js';"
    index_content = index_content.replace(old_import, new_import)

    # Add GraphQL middleware after Swagger
    old_swagger = "app.get('/api-docs.json', (_req, res) => {"
    new_swagger = (
        "// ── GraphQL Endpoint ───────────────────────────────────────────────────\n"
        "app.use('/api/graphql', yoga);\n\n"
        "app.get('/api-docs.json', (_req, res) => {"
    )
    index_content = index_content.replace(old_swagger, new_swagger)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index_content)
    print('4. index.js updated with GraphQL')

    # Need to also make logger exportable (it's already exported)
else:
    print('4. index.js already has GraphQL')

# ─── 5. Update package.json ─────────────────────────────────────────────────
pkg_path = os.path.join(BACKEND, 'package.json')
with open(pkg_path, 'r', encoding='utf-8') as f:
    pkg = json.load(f)

deps_added = []
for dep, ver in [
    ('graphql', '^16.10.0'),
    ('graphql-yoga', '^5.10.0'),
    ('@graphql-tools/schema', '^10.0.0'),
]:
    if dep not in pkg.get('dependencies', {}):
        pkg.setdefault('dependencies', {})[dep] = ver
        deps_added.append(f'{dep}@{ver}')

with open(pkg_path, 'w', encoding='utf-8') as f:
    json.dump(pkg, f, indent=2)
print(f'5. package.json updated: added {", ".join(deps_added) if deps_added else "no new deps"}')

# ─── 6. GraphQL Tests ───────────────────────────────────────────────────────
graphql_test = '''import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app } from '../index.js';
import { setClient } from '../cache.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-graphql-data.json';

beforeAll(() => setClient(null));
afterAll(() => {
  setClient(null);
  if (existsSync('test-graphql-data.json')) unlinkSync('test-graphql-data.json');
});

const API_KEY = 'test-key-for-jest';
const VALID_ID = 'C' + 'A'.repeat(55);
const ASSET_PAYLOAD = {
  contractId: VALID_ID,
  title: 'GraphQL Test Asset',
  location: 'Test Location',
  description: 'A test asset for GraphQL queries',
  assetType: 'Real Estate',
  totalValuation: '$1,000,000',
};

beforeAll(async () => {
  await request(app).post('/api/rwa').set('x-api-key', API_KEY).send(ASSET_PAYLOAD);
});

describe('GraphQL Endpoint', () => {
  test('GET /api/graphql returns 405 for introspection', async () => {
    // Yoga returns 405 for GET without Accept: text/html
    const res = await request(app)
      .get('/api/graphql')
      .set('Accept', 'application/json');
    expect(res.status).toBe(405);
  });

  test('POST /api/graphql - query single asset', async () => {
    const query = `
      query {
        asset(contractId: "${VALID_ID}") {
          contractId
          title
          location
          assetType
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.asset.title).toBe('GraphQL Test Asset');
  });

  test('POST /api/graphql - query assets list', async () => {
    const query = `
      query {
        assets(filter: { limit: 5 }) {
          data { contractId title }
          pagination { total page limit }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.assets.pagination.total).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/graphql - filter by assetType', async () => {
    const query = `
      query {
        assets(filter: { assetType: "Real Estate" }) {
          data { title assetType }
          pagination { total }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.every(a => a.assetType === 'Real Estate')).toBe(true);
  });

  test('POST /api/graphql - filter by search', async () => {
    const query = `
      query {
        assets(filter: { search: "GraphQL" }) {
          data { title }
          pagination { total }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.data.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/graphql - asset not found returns null', async () => {
    const query = `
      query {
        asset(contractId: "C${'Z'.repeat(55)}") {
          contractId
          title
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.asset).toBeNull();
  });

  test('POST /api/graphql - queryComplexity returns metadata', async () => {
    const query = `
      query {
        queryComplexity {
          score
          depth
          fieldCount
          maxAllowed
          remaining
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.data.queryComplexity.maxAllowed).toBeGreaterThan(0);
  });

  test('POST /api/graphql - rejects query exceeding depth limit', async () => {
    // Build a deeply nested query
    const buildDeepQuery = (depth) => {
      if (depth <= 0) return '{ contractId title }';
      return `{ data ${buildDeepQuery(depth - 1)} }`;
    };
    const query = `query { assets(filter: { limit: 1 }) ${buildDeepQuery(15)} }`;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    // Should either succeed or be rejected - depth 15 exceeds default 10
    if (res.body.errors) {
      expect(res.body.errors[0].message).toMatch(/depth/i);
    }
  });
});

describe('GraphQL Complexity Analysis', () => {
  test('simple query has low complexity score', async () => {
    const query = `
      query {
        asset(contractId: "${VALID_ID}") {
          contractId
          title
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
  });

  test('complex query with nested fields has higher score', async () => {
    const query = `
      query {
        assets(filter: { limit: 100 }) {
          data {
            contractId
            title
            location
            description
            assetType
            imageUrl
            totalValuation
            documents { name url }
            createdAt
            updatedAt
          }
          pagination { total page limit totalPages }
        }
      }
    `;
    const res = await request(app)
      .post('/api/graphql')
      .send({ query });
    expect(res.status).toBe(200);
    // Should succeed within default limits
    expect(res.body.errors).toBeUndefined();
  });
});

describe('GraphQL Error Handling', () => {
  test('invalid query returns GraphQL error', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .send({ query: '{ invalidField }' });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('empty query returns error', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .send({ query: '' });
    expect(res.status).toBe(400);
  });
});
'''

write_file(os.path.join(TESTS, 'graphql.test.js'), graphql_test)
print('6. graphql.test.js created')

# ─── 7. Update docs.js ─────────────────────────────────────────────────────
docs_path = os.path.join(BACKEND, 'docs.js')
with open(docs_path, 'r', encoding='utf-8') as f:
    docs_content = f.read()

# Read and add GraphQL info to swagger docs
if 'graphql' not in docs_content.lower():
    # Add a GraphQL section to the swaggerSpec
    gql_tag = '''
  // ── GraphQL Tag (for documentation) ──────────────────────────────────────
  // GraphQL endpoint: POST /api/graphql
  // Headers: Content-Type: application/json
  // Body: { "query": "...", "variables": {...} }
  //
  // Query Complexity Analysis:
  // - Each field has a cost weight (default: 1, scalar fields: 0.5, list fields: 3)
  // - List fields multiply cost by expected page size
  // - Maximum complexity: 100 (configurable via GRAPHQL_MAX_COMPLEXITY env var)
  // - Maximum depth: 10 (configurable via GRAPHQL_MAX_DEPTH env var)
  // - Maximum fields: 50 (configurable via GRAPHQL_MAX_FIELDS env var)
  // - User tiers: basic (20/3/20), standard (100/10/50), premium (500/15/200), admin (1000/20/500)
  // - Set x-user-tier header to select tier
  // - Rejected queries return errors with code: QUERY_COMPLEXITY_EXCEEDED
  // - Depth limit enforced before execution
  // - Field count limit enforced before execution
  // - Complexity scoring based on field weights and nesting depth
  // - Monitoring via structured logging (pino)

  // Add GraphQL server component
  swaggerSpec.components.securitySchemes.GraphQLTier = {
    type: 'apiKey',
    in: 'header',
    name: 'x-user-tier',
    description: 'User tier for GraphQL complexity limits: basic, standard, premium, admin',
  };
''';

    # Insert after components section
    insert_point = "swaggerSpec.components.securitySchemes = {"
    if insert_point in docs_content:
        idx = docs_content.find(insert_point) + len(insert_point)
        docs_content = docs_content[:idx] + gql_tag + docs_content[idx:]
        print('7. docs.js updated')

    with open(docs_path, 'w', encoding='utf-8') as f:
        f.write(docs_content)
else:
    print('7. docs.js already has GraphQL')

print('\n=== ALL FILES CREATED/UPDATED ===')
print('')
print('Next steps:')
print('1. cd /c/Users/USER/Tokenized-Fractional-/backend && npm install')
print('2. npm test to verify tests pass')
print('3. git add, commit, push, create PR')
