// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/apollo/client.js — Apollo Client setup with optimistic UI support.
 *
 * Configures Apollo Client with caching, error handling, and optimistic updates
 * for order placement mutations.
 */

import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import toast from 'react-hot-toast';

// HTTP link to GraphQL API
const httpLink = new HttpLink({
  uri: import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql',
  credentials: 'include',
});

// Auth link to add headers
const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('auth_token');
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
      'x-request-id': crypto.randomUUID(),
    },
  };
});

// Error handling link with toast notifications
const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  const correlationId = operation.getContext().headers?.['x-request-id'];

  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, extensions }) => {
      console.error(`[GraphQL Error] ${correlationId}:`, message);
      
      if (extensions?.code === 'INTERNAL_SERVER_ERROR') {
        toast.error('Server error occurred. Please try again.');
      } else if (extensions?.code === 'UNAUTHENTICATED') {
        toast.error('Authentication required. Please log in.');
      } else {
        toast.error(message || 'An error occurred');
      }
    });
  }

  if (networkError) {
    console.error(`[Network Error] ${correlationId}:`, networkError.message);
    toast.error('Network error. Please check your connection.');
  }
});

// Cache configuration with optimistic updates
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        orders: {
          keyArgs: ['assetId', 'status'],
          merge(existing = [], incoming) {
            return [...existing, ...incoming];
          },
        },
        getOrderHistory: {
          keyArgs: ['assetId'],
          merge(existing, incoming) {
            if (!existing) return incoming;
            return {
              ...incoming,
              orders: [...(existing.orders || []), ...(incoming.orders || [])],
            };
          },
        },
      },
    },
    Order: {
      keyFields: ['id'],
      fields: {
        status: {
          read(existing) {
            return existing || 'pending';
          },
        },
      },
    },
  },
});

// Apollo Client instance
export const apolloClient = new ApolloClient({
  link: from([authLink, errorLink, httpLink]),
  cache,
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    },
    mutate: {
      errorPolicy: 'all',
    },
  },
});

export default apolloClient;
