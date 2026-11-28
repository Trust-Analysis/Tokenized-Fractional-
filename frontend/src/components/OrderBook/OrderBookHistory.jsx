// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/components/OrderBook/OrderBookHistory.jsx
 *
 * Order Book History component implementing cursor-based infinite scrolling
 * using Apollo's fetchMore and the browser's IntersectionObserver.
 * Issue #616 & Issue #619.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_ORDER_HISTORY } from '../../graphql/queries';
import { formatOrderTimestamp } from '../../utils/i18nFormatters';
import Spinner from '../Spinner/Spinner';
import styles from './OrderBookHistory.module.css';

const DEFAULT_LIMIT = 20;

export default function OrderBookHistory({ assetId }) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const bottomSentinelRef = useRef(null);

  const { data, loading, error, fetchMore } = useQuery(GET_ORDER_HISTORY, {
    variables: { assetId, limit: DEFAULT_LIMIT },
    notifyOnNetworkStatusChange: true,
  });

  const orderHistory = data?.getOrderHistory;
  const orders = orderHistory?.orders || [];
  const pageInfo = orderHistory?.pageInfo;
  const hasNextPage = pageInfo?.hasNextPage;
  const endCursor = pageInfo?.endCursor;

  // Fetch more handler using Apollo Client's fetchMore
  const handleFetchMore = useCallback(() => {
    if (!hasNextPage || isLoadingMore || !endCursor) return;

    setIsLoadingMore(true);
    fetchMore({
      variables: {
        assetId,
        limit: DEFAULT_LIMIT,
        cursor: endCursor,
      },
    })
      .catch((err) => {
        console.error('Error fetching more order history:', err);
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  }, [hasNextPage, isLoadingMore, endCursor, assetId, fetchMore]);

  // IntersectionObserver to trigger infinite scroll fetch when scrolling to bottom
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry && firstEntry.isIntersecting) {
          handleFetchMore();
        }
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, handleFetchMore]);

  if (loading && orders.length === 0) {
    return (
      <div className={styles.historyContainer}>
        <div className={styles.header}>
          <span className={styles.title}>Order History</span>
        </div>
        <div className={styles.empty}>
          <Spinner size="sm" label="Loading order history…" />
        </div>
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className={styles.historyContainer}>
        <div className={styles.header}>
          <span className={styles.title}>Order History</span>
        </div>
        <div className={styles.error}>Failed to load order history</div>
      </div>
    );
  }

  return (
    <div className={styles.historyContainer}>
      <div className={styles.header}>
        <span className={styles.title}>Order History</span>
        {orderHistory?.totalCount != null && (
          <span className={styles.totalBadge}>{orderHistory.totalCount} total</span>
        )}
      </div>

      <div className={styles.tableHeader}>
        <span>Price</span>
        <span>Amount</span>
        <span>Side</span>
        <span>Time</span>
      </div>

      <div className={styles.scrollList} tabIndex={0} aria-label="Order book transaction history list">
        {orders.length === 0 ? (
          <div className={styles.empty}>No transaction history</div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className={styles.orderRow}>
              <span className={order.type === 'buy' ? styles.buy : styles.sell}>
                {order.price?.toFixed(2)}
              </span>
              <span>{order.amount}</span>
              <span className={order.type === 'buy' ? styles.buy : styles.sell}>
                {order.type?.toUpperCase()}
              </span>
              <span className={styles.time} title={order.createdAt}>
                {formatOrderTimestamp(order.createdAt)}
              </span>
            </div>
          ))
        )}

        {/* Sentinel element to trigger intersection observer fetch */}
        <div ref={bottomSentinelRef} className={styles.sentinel}>
          {isLoadingMore && (
            <div className={styles.loadingMore}>
              <Spinner size="xs" label="Loading more orders…" />
            </div>
          )}
        </div>

        {!hasNextPage && orders.length > 0 && (
          <div className={styles.endMessage}>All historical orders loaded</div>
        )}
      </div>
    </div>
  );
}
