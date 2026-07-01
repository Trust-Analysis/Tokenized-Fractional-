import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * WebSocket Event Types
 */
export const WS_EVENT_TYPES = {
  SHARE_PURCHASED: 'share_purchased',
  PRICE_UPDATED: 'price_updated',
  ASSET_LISTED: 'asset_listed',
  ASSET_UPDATED: 'asset_updated',
  AVAILABILITY_CHANGED: 'availability_changed',
  MARKETPLACE_PAUSED: 'marketplace_paused',
  MARKETPLACE_UNPAUSED: 'marketplace_unpaused',
  CONNECTION_ESTABLISHED: 'connection_established',
  SUBSCRIPTION_CONFIRMED: 'subscription_confirmed',
  ERROR: 'error',
};

/**
 * useWebSocket Hook
 * Manages WebSocket connection and event subscriptions
 *
 * @param {string} wsUrl - WebSocket server URL (e.g., 'ws://localhost:3001/ws')
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {Function} options.onEvent - Callback for all events
 * @param {Function} options.onError - Callback for errors
 * @param {number} options.reconnectAttempts - Max reconnection attempts (default: 5)
 * @param {number} options.reconnectDelay - Delay between reconnects in ms (default: 3000)
 *
 * @returns {Object} WebSocket control methods and state
 */
export function useWebSocket(wsUrl, options = {}) {
  const {
    enabled = true,
    onEvent,
    onError,
    reconnectAttempts = 5,
    reconnectDelay = 3000,
  } = options;

  const wsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const subscriptionsRef = useRef(new Set());

  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState(null);

  /**
   * Send subscription message
   */
  const subscribe = useCallback((topic) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot subscribe to topic:', topic);
      return;
    }

    if (subscriptionsRef.current.has(topic)) {
      return; // Already subscribed
    }

    wsRef.current.send(
      JSON.stringify({
        action: 'subscribe',
        topic,
      })
    );

    subscriptionsRef.current.add(topic);
  }, []);

  /**
   * Send unsubscription message
   */
  const unsubscribe = useCallback((topic) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        action: 'unsubscribe',
        topic,
      })
    );

    subscriptionsRef.current.delete(topic);
  }, []);

  /**
   * Send ping to keep connection alive
   */
  const ping = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'ping' }));
    }
  }, []);

  /**
   * Establish WebSocket connection
   */
  const connect = useCallback(() => {
    if (!enabled || wsRef.current) {
      return;
    }

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected:', wsUrl);
        reconnectCountRef.current = 0;
        setConnected(true);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle connection established
          if (message.type === WS_EVENT_TYPES.CONNECTION_ESTABLISHED) {
            setClientId(message.clientId);
            console.log('WebSocket client ID:', message.clientId);
          }

          // Call event handler
          if (onEvent) {
            onEvent(message);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (onError) {
          onError(error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        wsRef.current = null;
        subscriptionsRef.current.clear();

        // Attempt reconnection
        if (reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          console.log(
            `Attempting to reconnect... (${reconnectCountRef.current}/${reconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        } else {
          console.error('Max reconnection attempts reached');
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      if (onError) {
        onError(error);
      }
    }
  }, [enabled, wsUrl, onEvent, onError, reconnectAttempts, reconnectDelay]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
    setClientId(null);
    subscriptionsRef.current.clear();
  }, []);

  /**
   * Initialize connection on mount
   */
  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  /**
   * Keep-alive ping every 30 seconds
   */
  useEffect(() => {
    if (!connected) return;

    const pingInterval = setInterval(() => {
      ping();
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [connected, ping]);

  return {
    connected,
    clientId,
    subscribe,
    unsubscribe,
    ping,
    disconnect,
  };
}

/**
 * Higher-order hook for asset-specific subscriptions
 */
export function useAssetWebSocket(wsUrl, contractId, onEvent, options = {}) {
  const { subscribe, unsubscribe, ...wsState } = useWebSocket(wsUrl, {
    onEvent,
    ...options,
  });

  /**
   * Subscribe to asset-specific topic
   */
  useEffect(() => {
    if (contractId && wsState.connected) {
      subscribe(`asset:${contractId}`);

      return () => {
        unsubscribe(`asset:${contractId}`);
      };
    }
  }, [contractId, wsState.connected, subscribe, unsubscribe]);

  return wsState;
}

/**
 * Higher-order hook for marketplace-wide updates
 */
export function useMarketplaceWebSocket(wsUrl, onEvent, options = {}) {
  const { subscribe, unsubscribe, ...wsState } = useWebSocket(wsUrl, {
    onEvent,
    ...options,
  });

  /**
   * Subscribe to marketplace topics
   */
  useEffect(() => {
    if (wsState.connected) {
      subscribe('marketplace-status');
      subscribe('share-purchases');
      subscribe('assets');

      return () => {
        unsubscribe('marketplace-status');
        unsubscribe('share-purchases');
        unsubscribe('assets');
      };
    }
  }, [wsState.connected, subscribe, unsubscribe]);

  return wsState;
}
