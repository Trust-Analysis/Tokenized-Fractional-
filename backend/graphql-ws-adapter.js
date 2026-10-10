/**
 * GraphQL WebSocket Subscription Handler with Optimization
 * 
 * Integrates graphql-ws library with Apollo Server for real-time subscriptions
 * over WebSocket connections with advanced optimization features:
 * - Connection pooling
 * - Exponential backoff reconnection
 * - Payload filtering
 * - Bandwidth optimization
 * - Health monitoring
 * - Rate limiting
 * - Lifecycle management
 * - Subscription resumption
 * - Performance metrics
 */

import { WebSocketServer } from 'ws';
import { makeServer } from 'graphql-ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { logger } from './index.js';
import {
  optimizationManager,
  OPTIMIZATION_CONFIG,
} from './subscription-optimization.js';

let wsHandler = null;
let wss = null;

/**
 * Initialize GraphQL subscriptions WebSocket server with optimization
 * @param {http.Server} httpServer - HTTP server instance
 * @param {ApolloServer} apolloServer - Apollo Server instance
 * @returns {Object} WebSocket server handler
 */
export function initializeGraphQLSubscriptions(httpServer, apolloServer) {
  // Create WebSocket server for subscriptions
  wss = new WebSocketServer({
    server: httpServer,
    path: '/graphql/subscriptions',
    maxPayload: 10 * 1024 * 1024, // 10MB max payload
  });

  // Track client connections for optimization
  const clientConnections = new Map();

  // Use graphql-ws to handle the WebSocket subprotocol with optimization
  const wsHandler = useServer(
    {
      schema: apolloServer.schema,
      execute: apolloServer.executeOperation ? 
        (args) => apolloServer.executeOperation(args) :
        null,
      subscribe: apolloServer.subscribe ||
        apolloServer.executeOperation,
      
      // Enhanced connection handling with optimization
      onConnect(ctx) {
        const clientId = ctx.connectionParams?.clientId || 
                         `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        logger.info({ clientId }, 'GraphQL subscription client connected');
        
        // Start health monitoring
        optimizationManager.healthMonitor.startMonitoring(clientId, ctx.ws);
        
        // Track connection
        clientConnections.set(ctx, clientId);
        
        // Record connection metric
        optimizationManager.metricsCollector.incrementCounter('connections');
        
        return { ...ctx, clientId };
      },
      
      onDisconnect(ctx, code, reason) {
        const clientId = clientConnections.get(ctx);
        
        if (clientId) {
          logger.info({ clientId, code, reason }, 'GraphQL subscription client disconnected');
          
          // Stop health monitoring
          optimizationManager.healthMonitor.stopMonitoring(clientId);
          
          // Clear reconnection state
          optimizationManager.reconnectionManager.clearReconnection(clientId);
          
          // Untrack connection
          clientConnections.delete(ctx);
          
          // Record disconnection metric
          optimizationManager.metricsCollector.incrementCounter('disconnections');
        }
      },
      
      onError(ctx, msg, errors) {
        const clientId = clientConnections.get(ctx);
        logger.error({ clientId, errors, msg }, 'GraphQL subscription error');
        
        // Record error metric
        optimizationManager.metricsCollector.incrementCounter('errors');
      },
      
      // Handle subscription lifecycle
      onNext(ctx, message) {
        const clientId = clientConnections.get(ctx);
        if (clientId) {
          // Update subscription activity
          optimizationManager.lifecycleManager.updateActivity(message.id);
          
          // Record message metric
          optimizationManager.metricsCollector.incrementCounter('messages_sent');
        }
      },
      
      onComplete(ctx) {
        const clientId = clientConnections.get(ctx);
        if (clientId) {
          logger.debug({ clientId }, 'GraphQL subscription completed');
          
          // Record completion metric
          optimizationManager.metricsCollector.incrementCounter('subscriptions_completed');
        }
      },
    },
    wss,
  );

  // Add connection state monitoring
  wss.on('connection', (ws, req) => {
    const clientId = req.headers['x-client-id'] || 
                      `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info({ clientId, ip: req.socket.remoteAddress }, 'WebSocket connection established');
    
    // Handle heartbeat responses
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'heartbeat' || message.type === 'pong') {
          optimizationManager.healthMonitor.handleHeartbeatResponse(clientId);
        }
      } catch (error) {
        // Ignore non-JSON messages
      }
    });
    
    // Handle connection errors
    ws.on('error', (error) => {
      logger.error({ clientId, error: error.message }, 'WebSocket connection error');
      optimizationManager.metricsCollector.incrementCounter('connection_errors');
    });
  });

  // Add periodic stats logging
  setInterval(() => {
    const stats = optimizationManager.getStats();
    logger.info(
      {
        connections: stats.connectionPool.activeConnections,
        subscriptions: stats.lifecycle.activeSubscriptions,
        healthRate: stats.healthMonitor.healthRate,
        filterRate: stats.payloadFilter.filterRate,
      },
      'GraphQL subscription optimization stats'
    );
  }, 60000); // Every minute

  logger.info('GraphQL WebSocket subscriptions with optimization initialized at /graphql/subscriptions');

  return wsHandler;
}

/**
 * Get optimization statistics
 * @returns {Object} Optimization statistics
 */
export function getOptimizationStats() {
  return optimizationManager.getStats();
}

/**
 * Get the WebSocket handler for cleanup
 * @returns {Object} WebSocket handler
 */
export function getWebSocketHandler() {
  return wsHandler;
}

/**
 * Close WebSocket subscription handler and cleanup optimization
 */
export async function closeGraphQLSubscriptions() {
  if (wsHandler) {
    await wsHandler.dispose();
    logger.info('GraphQL WebSocket subscriptions closed');
  }
  
  if (wss) {
    wss.close();
    logger.info('WebSocket server closed');
  }
  
  // Close optimization manager
  optimizationManager.close();
  logger.info('Optimization manager closed');
}
