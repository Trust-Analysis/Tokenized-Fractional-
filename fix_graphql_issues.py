import os

BASE = r'C:\Users\USER\Tokenized-Fractional-'
BACKEND = os.path.join(BASE, 'backend')
GRAPHQL = os.path.join(BACKEND, 'graphql')

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

# ─── 1. Update index.js to use logger from logger.js ──────────────────────
index_path = os.path.join(BACKEND, 'index.js')
with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the pino import and logger creation
content = content.replace(
    "import pino from 'pino';",
    "import { logger } from './logger.js';"
)
content = content.replace(
    "import pinoHttp from 'pino-http';",
    "import pinoHttp from 'pino-http';"
)
# Remove the logger definition (multi-line)
old_logger = '''const isDev = process.env.NODE_ENV === 'development';
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  ...(isDev && { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }),
});'''
content = content.replace(old_logger, '')

# Also update pino-http usage - remove the 'logger,' from pinoHttp and keep logger import
content = content.replace(
    "import { logger } from './logger.js';",
    "import { logger } from './logger.js';\nimport pino from 'pino';"
)
# Actually no, remove the extra pino import. Let me fix:
content = content.replace(
    "import { logger } from './logger.js';\nimport pino from 'pino';",
    "import { logger } from './logger.js';"
)

# Remove duplicate logger definition (there might be another one)
content = content.replace("export const logger = pino({\n  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),\n  ...(isDev && { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }),\n});", "")

# Ensure pino is imported (needed for pinoHttp transport?)
# pinoHttp can work without explicit pino import in newer versions
content = content.replace("import pino from 'pino';", "")

with open(index_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('1. index.js updated to use logger.js')

# ─── 2. Fix complexity.js - export validation rule for graphql-js ─────────
write_file(os.path.join(GRAPHQL, 'complexity.js'), '''// GraphQL Query Complexity Analyzer
//
// Analyzes incoming GraphQL queries to compute a complexity score,
// enforce depth limits, and reject abusive queries before execution.
//
// This module exports:
//   1. calculateComplexity(ast) - compute score/depth/fieldCount from a parsed AST
//   2. complexityValidationRule - a graphql-js validation rule that rejects
//      queries exceeding configurable limits before execution.
//
// Field cost map: each field has a base cost; list fields multiply by page size.

import { GraphQLError } from 'graphql';

// Default cost configuration (can be overridden via env vars on import)
const DEFAULTS = {
  MAX_COMPLEXITY: parseFloat(process.env.GRAPHQL_MAX_COMPLEXITY || '100'),
  MAX_DEPTH: parseInt(process.env.GRAPHQL_MAX_DEPTH || '10', 10),
  MAX_FIELDS: parseInt(process.env.GRAPHQL_MAX_FIELDS || '50', 10),
};

// Per-field cost weights
const FIELD_COSTS = {
  asset: 1, assets: 3, queryComplexity: 0,
  contractId: 0.5, title: 0.5, location: 0.5,
  description: 0.5, assetType: 0.5, imageUrl: 1,
  totalValuation: 1, documents: 2, createdAt: 0.5, updatedAt: 0.5,
};

const LIST_FIELDS = new Set(['data', 'assets', 'documents']);

/**
 * Walk a selection set and accumulate complexity metrics.
 */
function walkSelections(selections, depth, listMultiplier, state) {
  if (!selections) return;
  state.depth = Math.max(state.depth, depth);

  for (const sel of selections) {
    if (sel.kind === 'Field') {
      state.fieldCount++;
      const name = sel.name.value;
      const baseCost = FIELD_COSTS[name] ?? 1;
      const isList = LIST_FIELDS.has(name);
      const mult = isList ? (listMultiplier || 20) : 1;
      state.score += baseCost * mult;

      if (sel.selectionSet?.selections) {
        walkSelections(sel.selectionSet.selections, depth + 1, isList ? 20 : listMultiplier, state);
      }
    } else if (sel.kind === 'InlineFragment' || sel.kind === 'FragmentSpread') {
      if (sel.selectionSet?.selections) {
        walkSelections(sel.selectionSet.selections, depth, listMultiplier, state);
      }
    }
  }
}

/**
 * Calculate complexity score from a parsed GraphQL document AST.
 */
export function calculateComplexity(document) {
  const state = { score: 0, depth: 0, fieldCount: 0 };
  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition' && def.operation === 'query') {
      walkSelections(def.selectionSet?.selections, 0, 1, state);
    }
  }
  state.score = Math.round(state.score * 10) / 10;
  return state;
}

/**
 * GraphQL-js custom validation rule that rejects queries exceeding
 * complexity, depth, or field-count limits.
 *
 * Usage:
 *   import { complexityValidationRule } from './complexity.js';
 *   const yoga = createYoga({
 *     schema,
 *     validationRules: [complexityValidationRule({ maxComplexity: 100 })],
 *   });
 */
export function complexityValidationRule(options = {}) {
  const maxComplexity = options.maxComplexity ?? DEFAULTS.MAX_COMPLEXITY;
  const maxDepth = options.maxDepth ?? DEFAULTS.MAX_DEPTH;
  const maxFields = options.maxFields ?? DEFAULTS.MAX_FIELDS;

  return function validationRule(context) {
    return {
      OperationDefinition: {
        leave(node) {
          if (node.operation !== 'query') return;

          // Build a fake document with just this operation for analysis
          const fakeDoc = { kind: 'Document', definitions: [node] };
          const complexity = calculateComplexity(fakeDoc);

          if (complexity.depth > maxDepth) {
            context.reportError(new GraphQLError(
              `Query depth (${complexity.depth}) exceeds maximum allowed (${maxDepth}). Reduce nesting.`,
              { nodes: node }
            ));
          }
          if (complexity.fieldCount > maxFields) {
            context.reportError(new GraphQLError(
              `Query requests ${complexity.fieldCount} fields (max: ${maxFields}). Request only needed fields.`,
              { nodes: node }
            ));
          }
          if (complexity.score > maxComplexity) {
            context.reportError(new GraphQLError(
              `Query complexity score (${complexity.score}) exceeds maximum allowed (${maxComplexity}). ` +
              `Reduce requested fields or use smaller page sizes.`,
              { nodes: node }
            ));
          }
        },
      },
    };
  };
}

export { DEFAULTS };
''')
print('2. complexity.js rewritten with graphql-js validation rule')

# ─── 3. Fix graphql/index.js - use validation rules instead of onExecute ──
write_file(os.path.join(GRAPHQL, 'index.js'), '''// GraphQL Yoga server setup for RWA Marketplace
import { createYoga, createSchema } from 'graphql-yoga';
import { typeDefs, resolvers } from './schema.js';
import { complexityValidationRule, DEFAULTS } from './complexity.js';

// User tier → complexity limit mapping
const TIER_LIMITS = {
  basic: { maxComplexity: 20, maxDepth: 3, maxFields: 20 },
  standard: { maxComplexity: 100, maxDepth: 10, maxFields: 50 },
  premium: { maxComplexity: 500, maxDepth: 15, maxFields: 200 },
  admin: { maxComplexity: 1000, maxDepth: 20, maxFields: 500 },
};

function buildValidationRules(tier) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.standard;
  const rule = complexityValidationRule(limits);
  return [rule];
}

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',

  // Build validation rules per-request based on user tier header
  validationRules: ({ request }) => {
    const tier = request.headers.get('x-user-tier') || 'standard';
    return buildValidationRules(tier);
  },
});

export default yoga;
''')
print('3. graphql/index.js rewritten with validation rules')

# ─── 4. Fix docs.js ──────────────────────────────────────────────────────
docs_path = os.path.join(BACKEND, 'docs.js')
with open(docs_path, 'r', encoding='utf-8') as f:
    docs_content = f.read()

# Remove bad insertion and add proper property
# Find where securitySchemes is defined and add GraphQLTier as a proper property
old_security = 'swaggerSpec.components.securitySchemes = {'
insert_after = '''  // ── GraphQL Tier (query complexity limits) ──────────────────────────────
  // GraphQL endpoint: POST /api/graphql
  // Headers: Content-Type: application/json
  // Body: { "query": "...", "variables": {...} }
  // Complexity limits vary by user tier (set via x-user-tier header):
  //   basic:    max score=20,  max depth=3,  max fields=20
  //   standard: max score=100, max depth=10, max fields=50 (default)
  //   premium:  max score=500, max depth=15, max fields=200
  //   admin:    max score=1000,max depth=20, max fields=500
  // Rejected queries return GraphQL errors with readable messages.
  // Depth limit, field count, and complexity score all enforced pre-execution.
  GraphQLTier: {
    type: 'apiKey',
    in: 'header',
    name: 'x-user-tier',
    description: 'User tier for GraphQL complexity limits: basic, standard, premium, admin',
  },
  ApiKeyAuth: {'''

# Replace the ApiKeyAuth start to add GraphQLTier before it
old_auth = '  ApiKeyAuth: {'
docs_content = docs_content.replace(
    '  ApiKeyAuth: {',
    '''  GraphQLTier: {
    type: 'apiKey',
    in: 'header',
    name: 'x-user-tier',
    description: 'User tier for GraphQL complexity limits: basic, standard, premium, admin',
  },
  ApiKeyAuth: {'''
)

# Also remove any previously inserted bad content (the gql_tag from first run)
# Find any GraphQL tag lines that aren't proper properties
lines = docs_content.split('\n')
filtered = []
skip_block = False
for line in lines:
    if 'swaggerSpec.components.securitySchemes.GraphQLTier' in line:
        skip_block = True
        continue
    if skip_block and line.strip().endswith('};'):
        skip_block = False
        continue
    if skip_block:
        continue
    filtered.append(line)
docs_content = '\n'.join(filtered)

with open(docs_path, 'w', encoding='utf-8') as f:
    f.write(docs_content)
print('4. docs.js fixed')

# ─── 5. Add GraphQL section to docs.js README comment at top ──────────────
# Find the README comment section and append GraphQL info
readme_marker = '// Swagger/OpenAPI specification for RWA Marketplace metadata API'
gql_readme = '''
// GraphQL Endpoint
// =================
// POST /api/graphql
//
// The GraphQL endpoint provides the same asset data as the REST API with
// built-in query complexity analysis to prevent denial-of-service attacks.
//
// Features:
// - Asset queries with filtering, search, and pagination
// - Per-field complexity scoring (scalars: 0.5, objects: 1, lists: 3)
// - Depth limit enforcement (default: 10 levels)
// - Field count limits (default: 50 fields per query)
// - Configurable user tiers via x-user-tier header
// - Clear error messages when limits are exceeded
// - Full GraphiQL IDE available in non-production environments
//
// Complexity Limits:
//   GRAPHQL_MAX_COMPLEXITY (env) - Maximum complexity score (default: 100)
//   GRAPHQL_MAX_DEPTH (env)      - Maximum query depth (default: 10)
//   GRAPHQL_MAX_FIELDS (env)     - Maximum requested fields (default: 50)'''

docs_content = docs_content.replace(readme_marker, readme_marker + gql_readme)
with open(docs_path, 'w', encoding='utf-8') as f:
    f.write(docs_content)
print('5. docs.js readme updated')

# ─── 6. Clean up create_graphql_complexity.py created files ──────────────
# Need to verify index.js is still valid
print('\n=== ALL FIXES APPLIED ===')
