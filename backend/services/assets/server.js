// Assets Service - Federated GraphQL Server
// This is a standalone federated service for asset management

import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { resolvers, typeDefs } from './resolvers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.ASSETS_SERVICE_PORT || 4001;

// Create Apollo Server with Federation support
const server = new ApolloServer({
  typeDefs,
  resolvers,
  // Federation configuration
  // Note: In production, you would use @apollo/federation package
  // For now, we're using standard Apollo Server with federated schema
});

// Start the server
const { url } = await startStandaloneServer(server, {
  context: async ({ req }) => {
    // Extract authentication information
    const apiKey = req.headers['x-api-key'] || null;
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;
    
    return {
      isAdmin,
      apiKey,
      requestId: req.headers['x-request-id'] || 'unknown'
    };
  },
  listen: { port: PORT }
});

console.log(`🚀 Assets Service ready at ${url}`);
console.log(`📊 Federated schema with @key directive on Asset.entity`);
