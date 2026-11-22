import { useEffect, useRef, useCallback } from 'react';
import { useMarketplaceWebSocket, WS_EVENT_TYPES } from './useWebSocket';
import { setQueryData, applySubscriptionDelta } from '../services/queryCache';

const SUBSCRIPTION_TOPIC_MAP = {
  [WS_EVENT_TYPES.PRICE_UPDATED]: 'asset-prices',
  [WS_EVENT_TYPES.SHARE_PURCHASED]: 'share-activity',
  [WS_EVENT_TYPES.AVAILABILITY_CHANGED]: 'availability',
  [WS_EVENT_TYPES.ASSET_UPDATED]: 'asset-metadata',
};

export function useGraphQLSubscription(wsUrl, options = {}) {
  const { enabled = true, cachePrefix = 'graphql', onEvent } = options;

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleSubscriptionEvent = useCallback(
    (message) => {
      if (!message.type || !message.data) return;

      const cacheKey = `${cachePrefix}:${SUBSCRIPTION_TOPIC_MAP[message.type] || message.type}`;

      if (message.type === WS_EVENT_TYPES.PRICE_UPDATED) {
        const vaultId = message.data.vaultId || message.data.contractId;
        if (vaultId) {
          const specificKey = `${cacheKey}:${vaultId}`;
          applySubscriptionDelta(specificKey, {
            price: message.data.price,
            pricePerShare: message.data.price,
            lastUpdated: Date.now(),
          });
          setQueryData(specificKey, {
            vaultId,
            price: message.data.price,
            lastUpdated: Date.now(),
          });
        }
      }

      if (message.type === WS_EVENT_TYPES.AVAILABILITY_CHANGED) {
        const vaultId = message.data.vaultId || message.data.contractId;
        if (vaultId) {
          const specificKey = `${cacheKey}:${vaultId}`;
          applySubscriptionDelta(specificKey, {
            availableShares: message.data.availableShares,
            totalShares: message.data.totalShares,
            lastUpdated: Date.now(),
          });
        }
      }

      if (message.type === WS_EVENT_TYPES.ASSET_UPDATED) {
        const assetId = message.data.contractId || message.data.id;
        if (assetId) {
          const specificKey = `${cacheKey}:${assetId}`;
          applySubscriptionDelta(specificKey, {
            ...message.data,
            lastUpdated: Date.now(),
          });
        }
      }

      if (onEventRef.current) {
        onEventRef.current(message);
      }
    },
    [cachePrefix],
  );

  const wsResult = useMarketplaceWebSocket(wsUrl, handleSubscriptionEvent, {
    enabled,
    ...options,
  });

  return {
    ...wsResult,
    subscribeToAsset: (assetId) => wsResult.subscribe(`asset:${assetId}`),
  };
}
