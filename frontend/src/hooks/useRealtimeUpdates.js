import { useCallback } from 'react';
import { useGraphQLSubscription } from './useGraphQLSubscription';
import { WS_EVENT_TYPES } from './useWebSocket';
import useLiveUpdatesStore from '../store/useLiveUpdatesStore';
import { setQueryData, applySubscriptionDelta } from '../services/queryCache';
import { API_URL } from '../constants/app';

/**
 * Subscribes to real-time marketplace events and keeps the local query cache
 * and live indicators up to date (Issues #425, #426).
 */
export function useRealtimeUpdates({ publicKey, addToast }) {
  const markAssetLive = useLiveUpdatesStore((state) => state.markAssetLive);
  const updateAssetTimestamp = useLiveUpdatesStore((state) => state.updateAssetTimestamp);

  const handleSubscriptionEvent = useCallback(
    (message) => {
      if (!message.type || !message.data) return;

      const cacheKey = `graphql:${message.type}`;
      const contractId = message.data.contractId || message.data.vaultId || message.data.id;

      switch (message.type) {
        case WS_EVENT_TYPES.PRICE_UPDATED:
          setQueryData(`${cacheKey}:price:${contractId}`, {
            price: message.data.price,
            lastUpdated: Date.now(),
          });
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.AVAILABILITY_CHANGED:
          applySubscriptionDelta(`${cacheKey}:availability:${contractId}`, {
            availableShares: message.data.availableShares,
            totalShares: message.data.totalShares,
          });
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.ASSET_UPDATED:
          setQueryData(`${cacheKey}:asset:${contractId}`, message.data);
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.SHARE_PURCHASED:
          if (publicKey && message.data.buyerAddress !== publicKey) {
            console.log('Share purchase detected:', message.data);
          }
          if (contractId) {
            markAssetLive(contractId);
            updateAssetTimestamp(contractId);
          }
          break;

        case WS_EVENT_TYPES.MARKETPLACE_PAUSED:
          addToast({ message: 'Marketplace has been paused', type: 'warning' });
          break;

        case WS_EVENT_TYPES.MARKETPLACE_UNPAUSED:
          addToast({ message: 'Marketplace is now available', type: 'success' });
          break;

        default:
          console.log('Unknown WebSocket event:', message.type);
      }
    },
    [publicKey, addToast, markAssetLive, updateAssetTimestamp],
  );

  const wsUrl = `ws://${new URL(API_URL).host}/ws`;
  const { connected: wsConnected } = useGraphQLSubscription(wsUrl, {
    enabled: process.env.NODE_ENV !== 'test',
    reconnectAttempts: 5,
    reconnectDelay: 3000,
    onEvent: handleSubscriptionEvent,
  });

  return { wsConnected };
}

export default useRealtimeUpdates;
