// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/graphql/queries.js — GraphQL queries and mutations.
 *
 * Defines GraphQL operations for the marketplace including order management.
 *
 * Issue #1021: The contract previously exposed two overlapping income
 * distribution systems (dividends vs. accumulator-based distribution). The
 * canonical income path is now the accumulator-based distribution
 * (`deposit_distribution` / `claim_distribution`). All dividend-specific
 * queries/mutations have been removed from this module. See
 * `docs/adr/` for the consolidation ADR and migration notes.
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

// Issue #1021: Canonical income distribution (accumulator-based).
// Replaces the deprecated dividend queries/mutations.

/**
 * Query the canonical distribution state for an asset.
 * Returns the accumulator index, total deposited, and per-holder claimable
 * amounts derived from the on-chain accumulator.
 */
export const GET_DISTRIBUTION_STATE = `
  query GetDistributionState($assetId: ID!) {
    distributionState(assetId: $assetId) {
      assetId
      accumulatorIndex
      totalDeposited
      totalClaimed
      lastDepositAt
      updatedAt
    }
  }
`;

/**
 * Query the claimable distribution balance for a specific holder.
 */
export const GET_CLAIMABLE_DISTRIBUTION = `
  query GetClaimableDistribution($assetId: ID!, $holder: String!) {
    claimableDistribution(assetId: $assetId, holder: $holder) {
      assetId
      holder
      claimable
      claimed
      lastClaimedAt
    }
  }
`;

/**
 * Query the distribution history (deposits and claims) for an asset.
 */
export const GET_DISTRIBUTION_HISTORY = `
  query GetDistributionHistory($assetId: ID!, $limit: Int, $cursor: String) {
    distributionHistory(assetId: $assetId, limit: $limit, cursor: $cursor) {
      entries {
        id
        assetId
        holder
        kind
        amount
        accumulatorIndex
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

/**
 * Mutation: claim accrued distribution for the connected holder.
 */
export const CLAIM_DISTRIBUTION = `
  mutation ClaimDistribution($assetId: ID!) {
    claimDistribution(assetId: $assetId) {
      assetId
      holder
      amount
      accumulatorIndex
      txHash
    }
  }
`;

/**
 * Helper: Build variables for the distribution history query.
 * @param {object} opts - { assetId, limit, cursor }
 */
export function buildDistributionHistoryVariables({ assetId, limit = 20, cursor = null } = {}) {
  const variables = { assetId, limit };
  if (cursor) variables.cursor = cursor;
  return variables;
}