// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/graphql/queries.js — GraphQL queries and mutations.
 *
 * Defines GraphQL operations for the marketplace including order management.
 */

export const GET_ORDERS = `
  query GetOrders($assetId: ID!, $status: OrderStatus) {
    orders(assetId: $assetId, status: $status) {
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

export const GET_ORDER_BOOK = `
  query GetOrderBook($assetId: ID!) {
    orderBook(assetId: $assetId) {
      buyOrders {
        id
        userId
        amount
        price
        status
        createdAt
      }
      sellOrders {
        id
        userId
        amount
        price
        status
        createdAt
      }
    }
  }
`;

export const PLACE_ORDER = `
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

export const CANCEL_ORDER = `
  mutation CancelOrder($orderId: ID!) {
    cancelOrder(orderId: $orderId) {
      id
      status
      cancelledAt
    }
  }
`;

// Issue #513: Relay-compliant cursor-based pagination for asset listings
export const GET_ASSETS_PAGINATED = `
  query GetAssetsPaginated($filter: AssetFilter) {
    assets(filter: $filter) {
      data {
        contractId
        title
        location
        description
        assetType
        imageUrl
        totalValuation
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

/**
 * Helper: Build cursor-based pagination variables.
 * @param {object} opts - { first, after, assetType, search }
 */
export function buildAssetsVariables({ first = 20, after = null, assetType = null, search = null } = {}) {
  const filter = { first };
  if (after) filter.after = after;
  if (assetType) filter.assetType = assetType;
  if (search) filter.search = search;
  return { filter };
}

// Issue #616: Infinite Scrolling for Order Book History
export const GET_ORDER_HISTORY = `
  query GetOrderHistory($assetId: ID, $limit: Int, $cursor: String) {
    getOrderHistory(assetId: $assetId, limit: $limit, cursor: $cursor) {
      orders {
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
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;
