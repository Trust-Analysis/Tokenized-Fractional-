// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/hooks/useOptimisticOrder.js — Optimistic UI hook for order placement.
 *
 * Provides optimistic updates for placeOrder mutations with automatic rollback
 * on transaction failure and toast notifications.
 */

import { useMutation, useApolloClient } from '@apollo/client';
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { GET_ORDERS } from '../graphql/queries';

// GraphQL mutation for placing an order
const PLACE_ORDER = `
  mutation PlaceOrder($input: PlaceOrderInput!) {
    placeOrder(input: $input) {
      id
      assetId
      userId
      type
      amount
      price
      status
      createdAt
      txHash
    }
  }
`;

/**
 * Hook for optimistic order placement with rollback
 */
export function useOptimisticOrder() {
  const client = useApolloClient();

  const [placeOrder, { loading, error }] = useMutation(PLACE_ORDER, {
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await client.cancelQueries({ query: GET_ORDERS });

      // Snapshot previous cache data
      const cacheData = client.cache.readQuery({
        query: GET_ORDERS,
        variables: { assetId: variables.input.assetId },
      });

      const previousOrders = cacheData?.orders || [];

      // Create optimistic order
      const optimisticOrder = {
        __typename: 'Order',
        id: `temp-${Date.now()}`,
        assetId: variables.input.assetId,
        userId: variables.input.userId,
        type: variables.input.type,
        amount: variables.input.amount,
        price: variables.input.price,
        status: 'pending',
        createdAt: new Date().toISOString(),
        txHash: null,
        isOptimistic: true,
      };

      // Write optimistic data to cache
      client.cache.writeQuery({
        query: GET_ORDERS,
        variables: { assetId: variables.input.assetId },
        data: {
          orders: [...previousOrders, optimisticOrder],
        },
      });

      // Show optimistic toast
      toast.loading('Order placed - awaiting confirmation...', { id: optimisticOrder.id });

      return { previousOrders, optimisticOrder };
    },

    onError: (error, variables, context) => {
      // Rollback to previous state
      if (context?.previousOrders) {
        client.cache.writeQuery({
          query: GET_ORDERS,
          variables: { assetId: variables.input.assetId },
          data: {
            orders: context.previousOrders,
          },
        });
      }

      // Show error toast
      const errorMessage = error.message || 'Transaction failed or reverted on-chain';
      toast.error(errorMessage, { id: context?.optimisticOrder?.id });

      console.error('[Order Error]', error);
    },

    onSuccess: (data, variables, context) => {
      // Remove optimistic toast and show success
      toast.dismiss(context?.optimisticOrder?.id);
      toast.success('Order confirmed!', { id: context?.optimisticOrder?.id });

      // Refetch to get canonical data
      client.refetchQueries({
        include: [GET_ORDERS],
      });
    },
  });

  const executeOrder = useCallback(
    async (orderInput) => {
      try {
        const result = await placeOrder({
          variables: { input: orderInput },
        });
        return result.data?.placeOrder;
      } catch (err) {
        throw err;
      }
    },
    [placeOrder]
  );

  return {
    executeOrder,
    loading,
    error,
  };
}

export default useOptimisticOrder;
