// GraphQL Query Complexity Analyzer
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
