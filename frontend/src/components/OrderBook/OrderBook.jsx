// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/components/OrderBook/OrderBook.jsx — Order book with DOM virtualization.
 *
 * Displays buy/sell orders with pulsing badge for pending transactions.
 *
 * Issue #594: Use the project's existing VirtualList component so only the
 * visible rows are rendered. This keeps scrolling smooth at 60fps even when
 * the order book contains thousands of bids/asks.
 */

import React from 'react';
import { useQuery } from '@apollo/client';
import { GET_ORDER_BOOK } from '../../graphql/queries';
import Card from '../Card/Card';
import VirtualList from '../VirtualList/VirtualList';
import OrderBookSkeleton from '../Skeleton/OrderBookSkeleton';
import { formatOrderTimestamp } from '../../utils/i18nFormatters';
import styles from './OrderBook.module.css';

const ORDER_ROW_HEIGHT = 56;
const ORDER_LIST_HEIGHT = 420;

export default function OrderBook({ assetId }) {
  const { data, loading, error } = useQuery(GET_ORDER_BOOK, {
    variables: { assetId },
    pollInterval: 5000, // Poll for updates every 5 seconds
  });

  if (loading) {
    return (
      <Card className={styles.orderBook}>
        <div className={styles.header}>Order Book</div>
        {/* Issue #572: skeleton rows prevent layout shift once data loads */}
        <OrderBookSkeleton rows={6} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={styles.orderBook}>
        <div className={styles.header}>Order Book</div>
        <div className={styles.error}>Failed to load orders</div>
      </Card>
    );
  }

  const { buyOrders = [], sellOrders = [] } = data?.orderBook || {};

  return (
    <Card className={styles.orderBook}>
      <div className={styles.header}>Order Book</div>

      {/* Buy Orders */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>Buy Orders</div>
        {buyOrders.length === 0 ? (
          <div className={styles.empty}>No buy orders</div>
        ) : (
          <VirtualList
            items={buyOrders}
            itemHeight={ORDER_ROW_HEIGHT}
            height={ORDER_LIST_HEIGHT}
            className={styles.virtualList}
            overscan={6}
            variableHeight={false}
            keyExtractor={(order) => order.id}
            renderItem={({ item }) => <OrderRow order={item} type="buy" />}
            aria-label="Buy order book"
          />
        )}
      </div>

      {/* Sell Orders */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>Sell Orders</div>
        {sellOrders.length === 0 ? (
          <div className={styles.empty}>No sell orders</div>
        ) : (
          <VirtualList
            items={sellOrders}
            itemHeight={ORDER_ROW_HEIGHT}
            height={ORDER_LIST_HEIGHT}
            className={styles.virtualList}
            overscan={6}
            variableHeight={false}
            keyExtractor={(order) => order.id}
            renderItem={({ item }) => <OrderRow order={item} type="sell" />}
            aria-label="Sell order book"
          />
        )}
      </div>
    </Card>
  );
}

function OrderRow({ order, type }) {
  const isPending = order.status === 'pending';
  const isOptimistic = order.isOptimistic;

  return (
    <div
      className={`${styles.orderRow} ${styles[type]} ${isPending ? styles.pending : ''}`}
    >
      <div className={styles.orderInfo}>
        <span className={styles.orderAmount}>{order.amount} shares</span>
        <span className={styles.orderPrice}>
          {(order.price / 1e7).toFixed(7)} XLM
        </span>
      </div>

      {(isPending || isOptimistic) && (
        <div className={styles.badgeContainer}>
          <span className={styles.pulsingBadge}>
            {isOptimistic ? 'Optimistic' : 'Pending'}
          </span>
        </div>
      )}

      <div className={styles.orderMeta}>
        <span className={styles.orderTime}>
          {formatOrderTimestamp(order.createdAt)}
        </span>
        {order.txHash && (
          <a
            href={`https://stellar.expert/tx/${order.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            View Tx
          </a>
        )}
      </div>
    </div>
  );
}