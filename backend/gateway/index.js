// Apollo Gateway - Federated GraphQL Gateway
// This gateway composes multiple federated services into a unified graph

import { ApolloGateway, IntrospectAndCompose, LocalGraphQLDataSource } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Service URLs - in production, these would be environment variables
const serviceList = [
  {
    name: 'assets',
    url: process.env.ASSETS_SERVICE_URL || 'http://localhost:4001'
  },
  {
    name: 'users',
    url: process.env.USERS_SERVICE_URL || 'http://localhost:4002'
  },
  {
    name: 'transactions',
    url: process.env.TRANSACTIONS_SERVICE_URL || 'http://localhost:4003'
  }
];

// Create the gateway
const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: serviceList
  }),
  
  // Health check configuration
  // healthCheck: {
  //   interval: 10000,
  //   timeout: 5000,
  //   threshold: 5
  // },
  
  // Query planning options
  queryPlanner: {
    // Enable query plan caching
    // cache: new InMemoryLRUCache({
    //   maxSize: 100,
    //   ttl: 300000 // 5 minutes
    // })
  }
});

// Create Apollo Server with the gateway
const server = new ApolloServer({
  gateway,
  
  // Subscription support (if needed)
  // subscriptions: {
  //   path: '/graphql'
  // },
  
  // Context function for authentication
  context: async ({ req }) => {
    // Extract authentication information
    const apiKey = req.headers['x-api-key'] || null;
    const authorization = req.headers['authorization'] || null;
    const requestId = req.headers['x-request-id'] || 'unknown';
    
    // Validate API key
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;
    
    return {
      isAdmin,
      apiKey,
      authorization,
      requestId,
      // Add any additional context需要的
      services: {
        assets: process.env.ASSETS_SERVICE_URL || 'http://localhost:4001',
        users: process.env.USERS_SERVICE_URL || 'http://localhost:4002',
        transactions: process.env.TRANSACTIONS_SERVICE_URL || 'http://localhost:4003'
      }
    };
  },
  
  // Format errors
  formatError: (formattedError, error) => {
    // Log the error
    console.error('GraphQL Error:', {
      message: formattedError.message,
      path: formattedError.path,
      extensions: formattedError.extensions
    });
    
    // Return formatted error
    return formattedError;
  },
  
  // Plugins for monitoring
  // plugins: [
  //   {
  //     requestDidStart: () => ({
  //       didResolveOperation: ({ request }) => {
  //         console.log('Query:', request.operationName);
  //       },
  //       willSendResponse: ({ response }) => {
  //         console.log('Response:', response.body.kind);
  //       }
  //     })
  //   }
  // ]
});

const PORT = process.env.GATEWAY_PORT || 4000;

// Start the gateway server
const { url } = await startStandaloneServer(server, {
  context: async ({ req }) => {
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

console.log(`🚀 Apollo Gateway ready at ${url}`);
console.log(`📊 Composed federated graph from ${serviceList.length} services:`);
serviceList.forEach(service => {
  console.log(`   - ${service.name}: ${service.url}`);
});
