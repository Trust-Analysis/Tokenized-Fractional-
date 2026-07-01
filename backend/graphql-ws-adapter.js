/**
 * GraphQL WebSocket Subscription Handler
 *
 * Integrates graphql-ws library with Apollo Server for real-time subscriptions
 * over WebSocket connections.
 */

import { WebSocketServer } from 'ws';
import { makeServer } from 'graphql-ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { logger } from './index.js';

const wsHandler = null;

/**
 * Initialize GraphQL subscriptions WebSocket server
 * @param {http.Server} httpServer - HTTP server instance
 * @param {ApolloServer} apolloServer - Apollo Server instance
 * @returns {Object} WebSocket server handler
 */
export function initializeGraphQLSubscriptions(httpServer, apolloServer) {
  // Create WebSocket server for subscriptions
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/graphql/subscriptions',
  });

  // Use graphql-ws to handle the WebSocket subprotocol
  const wsHandler = useServer(
    {
      schema: apolloServer.schema,
      execute: apolloServer.executeOperation ? (args) => apolloServer.executeOperation(args) : null,
      subscribe: apolloServer.subscribe || apolloServer.executeOperation,
      // Optional: Add authentication context for subscriptions
      onConnect(ctx) {
        logger.info('GraphQL subscription client connected');
        return ctx;
      },
      onDisconnect() {
        logger.info('GraphQL subscription client disconnected');
      },
      onError(ctx, msg, errors) {
        logger.error({ errors, msg }, 'GraphQL subscription error');
      },
    },
    wss,
  );

  logger.info('GraphQL WebSocket subscriptions initialized at /graphql/subscriptions');

  return wsHandler;
}

/**
 * Get the WebSocket handler for cleanup
 * @returns {Object} WebSocket handler
 */
export function getWebSocketHandler() {
  return wsHandler;
}

/**
 * Close WebSocket subscription handler
 */
export async function closeGraphQLSubscriptions() {
  if (wsHandler) {
    await wsHandler.dispose();
    logger.info('GraphQL WebSocket subscriptions closed');
  }
}
