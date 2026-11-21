// GraphQL Yoga server setup for RWA Marketplace
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
