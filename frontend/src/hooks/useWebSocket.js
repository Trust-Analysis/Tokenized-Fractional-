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
  TIME_WINDOW_CREATED: 'time_window_created',
  TIME_WINDOW_UPDATED: 'time_window_updated',
  TIME_WINDOW_CANCELLED: 'time_window_cancelled',
  TIME_WINDOW_PURCHASED: 'time_window_purchased',
  TIME_WINDOW_EXPIRED: 'time_window_expired',
  CONNECTION_ESTABLISHED: 'connection_established',
  SUBSCRIPTION_CONFIRMED: 'subscription_confirmed',
  ERROR: 'error',
};

/**
 * useWebSocket Hook
 * Manages WebSocket connection and event subscriptions with exponential backoff reconnection
 *
 * @param {string} wsUrl - WebSocket server URL (e.g., 'ws://localhost:3001/ws')
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {Function} options.onEvent - Callback for all events
 * @param {Function} options.onError - Callback for errors
 * @param {Function} options.onReconnect - Callback when attempting to reconnect
 * @param {number} options.reconnectAttempts - Max reconnection attempts (default: Infinity for unlimited)
 * @param {number} options.initialDelay - Initial reconnect delay in ms (default: 1000)
 * @param {number} options.maxDelay - Max reconnect delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Exponential backoff multiplier (default: 1.5)
 * @param {boolean} options.enablePing - Enable keep-alive ping (default: true)
 * @param {number} options.pingInterval - Ping interval in ms (default: 30000)
 *
 * @returns {Object} WebSocket control methods and state
 */
export function useWebSocket(wsUrl, options = {}) {
  const {
    enabled = true,
    onEvent,
    onError,
    onReconnect,
    reconnectAttempts = Infinity,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 1.5,
    enablePing = true,
    pingInterval = 30000,
  } = options;

  const wsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const subscriptionsRef = useRef(new Set());
  const pingTimeoutRef = useRef(null);
  const manualDisconnectRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  /**
   * Calculate exponential backoff delay with jitter
   */
  const calculateBackoffDelay = useCallback(
    (attemptNumber) => {
      const exponentialDelay = initialDelay * backoffMultiplier ** (attemptNumber - 1);
      const cappedDelay = Math.min(exponentialDelay, maxDelay);
      // Add jitter: ±10% random variance
      const jitter = cappedDelay * 0.1 * (Math.random() - 0.5) * 2;
      return Math.max(0, Math.round(cappedDelay + jitter));
    },
    [initialDelay, maxDelay, backoffMultiplier],
  );

  /**
   * Send subscription message
   */
  const subscribe = useCallback((topic) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot subscribe to topic:', topic);
      return false;
    }

    if (subscriptionsRef.current.has(topic)) {
      return true; // Already subscribed
    }

    try {
      wsRef.current.send(
        JSON.stringify({
          action: 'subscribe',
          topic,
        }),
      );
      subscriptionsRef.current.add(topic);
      return true;
    } catch (error) {
      console.error('Failed to subscribe to topic:', topic, error);
      return false;
    }
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
      }),
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
   * Restore all active subscriptions after reconnection
   */
  const resubscribeToTopics = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    subscriptionsRef.current.forEach((topic) => {
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'subscribe',
            topic,
          }),
        );
      } catch (error) {
        console.error('Failed to resubscribe to topic:', topic, error);
      }
    });
  }, []);

  /**
   * Establish WebSocket connection with exponential backoff
   */
  const connect = useCallback(() => {
    if (!enabled || wsRef.current) {
      return;
    }

    // Skip if manually disconnected
    if (manualDisconnectRef.current) {
      return;
    }

    try {
      console.log(`[WebSocket] Connecting to ${wsUrl}...`);
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('[WebSocket] Connected:', wsUrl);
        reconnectCountRef.current = 0;
        manualDisconnectRef.current = false;
        setConnected(true);
        setReconnecting(false);
        setConnectionAttempts(0);

        // Restore subscriptions after successful connection
        resubscribeToTopics();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle connection established
          if (message.type === WS_EVENT_TYPES.CONNECTION_ESTABLISHED) {
            setClientId(message.clientId);
            console.log('[WebSocket] Client ID:', message.clientId);
          }

          // Call event handler
          if (onEvent) {
            onEvent(message);
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setConnected(false);
        if (onError) {
          onError(error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setConnected(false);
        wsRef.current = null;

        // Don't reconnect if manually disconnected
        if (manualDisconnectRef.current) {
          subscriptionsRef.current.clear();
          return;
        }

        // Attempt automatic reconnection with exponential backoff
        if (reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          const delay = calculateBackoffDelay(reconnectCountRef.current);

          console.log(
            `[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectCountRef.current}/${reconnectAttempts === Infinity ? '∞' : reconnectAttempts})`,
          );

          setReconnecting(true);
          setConnectionAttempts(reconnectCountRef.current);

          if (onReconnect) {
            onReconnect({
              attempt: reconnectCountRef.current,
              delay,
              nextDelay: calculateBackoffDelay(reconnectCountRef.current + 1),
            });
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('[WebSocket] Max reconnection attempts reached');
          subscriptionsRef.current.clear();
          setReconnecting(false);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setConnected(false);
      if (onError) {
        onError(error);
      }
    }
  }, [
    enabled,
    wsUrl,
    onEvent,
    onError,
    onReconnect,
    reconnectAttempts,
    calculateBackoffDelay,
    resubscribeToTopics,
  ]);

  /**
   * Disconnect from WebSocket (manual disconnect, prevents reconnection)
   */
  const disconnect = useCallback(() => {
    console.log('[WebSocket] Manual disconnect');
    manualDisconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
    setReconnecting(false);
    setClientId(null);
    setConnectionAttempts(0);
    subscriptionsRef.current.clear();
  }, []);

  /**
   * Initialize connection on mount, reset on dependency changes
   */
  useEffect(() => {
    manualDisconnectRef.current = false;
    if (enabled) {
      connect();
    }

    return () => {
      // On unmount, stop reconnection but don't block future reconnects
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);

  /**
   * Keep-alive ping with dynamic interval
   */
  useEffect(() => {
    if (!connected || !enablePing || manualDisconnectRef.current) return;

    const schedulePing = () => {
      pingTimeoutRef.current = setTimeout(() => {
        ping();
        schedulePing();
      }, pingInterval);
    };

    schedulePing();

    return () => {
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
        pingTimeoutRef.current = null;
      }
    };
  }, [connected, enablePing, pingInterval, ping]);

  return {
    connected,
    clientId,
    reconnecting,
    connectionAttempts,
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
      subscribe('time-windows');

      return () => {
        unsubscribe('marketplace-status');
        unsubscribe('share-purchases');
        unsubscribe('assets');
        unsubscribe('time-windows');
      };
    }
  }, [wsState.connected, subscribe, unsubscribe]);

  return wsState;
}
