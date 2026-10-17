// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/timeWindowService.js — Time-locked purchase window event logging & analytics
 *
 * Handles:
 * - Logging time window lifecycle events (created, updated, cancelled, bought, expired)
 * - Querying time window analytics (volume, participation, utilization)
 * - Time window governance tracking (who performed what action, when)
 */

import { randomUUID } from 'crypto';

/** Time window event types */
export const TIME_WINDOW_EVENTS = {
  CREATED: 'window.created',
  UPDATED: 'window.updated',
  CANCELLED: 'window.cancelled',
  PURCHASED: 'window.purchased',
  EXPIRED: 'window.expired',
  RECURRING_STARTED: 'window.recurring.started',
};

/**
 * Time Window Service
 */
export class TimeWindowService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
  }

  /**
   * Log a time window event
   *
   * @param {Object} data
   * @param {string} data.eventType - One of TIME_WINDOW_EVENTS
   * @param {string} data.contractId - RWA contract ID
   * @param {string|number} data.windowId - Time window identifier
   * @param {string} [data.adminAddress] - Admin who performed the action
   * @param {string} [data.buyerAddress] - Buyer (for purchase events)
   * @param {Object} [data.details] - Event-specific details
   * @returns {Promise<Object>} Created event record
   */
  async logEvent(data) {
    try {
      const [event] = await this.db('time_window_events').insert({
        event_id: `twe_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        event_type: data.eventType,
        contract_id: data.contractId,
        window_id: String(data.windowId),
        admin_address: data.adminAddress || null,
        buyer_address: data.buyerAddress || null,
        details: data.details || {},
        created_at: new Date(),
      }).returning('*');

      this.logger.info({
        eventId: event.event_id,
        eventType: data.eventType,
        contractId: data.contractId,
        windowId: data.windowId,
      }, 'Time window event logged');

      return event;
    } catch (error) {
      this.logger.error({ error: error.message, data }, 'Failed to log time window event');
      return null;
    }
  }

  /**
   * Get events for a specific time window
   *
   * @param {string} contractId
   * @param {string|number} windowId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<Object[]>}
   */
  async getWindowEvents(contractId, windowId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    return this.db('time_window_events')
      .where('contract_id', contractId)
      .where('window_id', String(windowId))
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get all events for an asset's time windows
   *
   * @param {string} contractId
   * @param {Object} [options]
   * @param {string} [options.eventType] - Filter by event type
   * @param {string} [options.from] - Start date ISO string
   * @param {string} [options.to] - End date ISO string
   * @param {number} [options.limit=100]
   * @param {number} [options.offset=0]
   * @returns {Promise<Object[]>}
   */
  async getAssetWindowEvents(contractId, options = {}) {
    const { eventType, from, to, limit = 100, offset = 0 } = options;

    let query = this.db('time_window_events')
      .where('contract_id', contractId);

    if (eventType) {
      query = query.where('event_type', eventType);
    }
    if (from) {
      query = query.where('created_at', '>=', new Date(from));
    }
    if (to) {
      query = query.where('created_at', '<=', new Date(to));
    }

    return query.orderBy('created_at', 'desc').limit(limit).offset(offset);
  }

  /**
   * Compute analytics for a specific time window
   *
   * @param {string} contractId
   * @param {string|number} windowId
   * @returns {Promise<Object>}
   */
  async getWindowAnalytics(contractId, windowId) {
    const purchaseEvents = await this.db('time_window_events')
      .where('contract_id', contractId)
      .where('window_id', String(windowId))
      .where('event_type', TIME_WINDOW_EVENTS.PURCHASED);

    const totalPurchases = purchaseEvents.length;
    const uniqueBuyers = new Set(purchaseEvents.map(e => e.buyer_address).filter(Boolean)).size;
    const totalSharesSold = purchaseEvents.reduce((sum, e) => {
      const shares = e.details?.shares || 0;
      return sum + shares;
    }, 0);
    const totalVolume = purchaseEvents.reduce((sum, e) => {
      const amount = e.details?.totalAmount || 0;
      return sum + amount;
    }, 0);

    const averageSharesPerBuyer = uniqueBuyers > 0 ? totalSharesSold / uniqueBuyers : 0;
    const averageVolumePerPurchase = totalPurchases > 0 ? totalVolume / totalPurchases : 0;

    return {
      contractId,
      windowId,
      totalPurchases,
      uniqueBuyers,
      totalSharesSold,
      totalVolume,
      averageSharesPerBuyer: Math.round(averageSharesPerBuyer * 100) / 100,
      averageVolumePerPurchase: Math.round(averageVolumePerPurchase * 100) / 100,
    };
  }

  /**
   * Compute aggregate analytics across all time windows for an asset
   *
   * @param {string} contractId
   * @returns {Promise<Object>}
   */
  async getAssetTimeWindowAnalytics(contractId) {
    const allEvents = await this.db('time_window_events')
      .where('contract_id', contractId)
      .orderBy('created_at', 'asc');

    const purchaseEvents = allEvents.filter(e => e.event_type === TIME_WINDOW_EVENTS.PURCHASED);
    const createdEvents = allEvents.filter(e => e.event_type === TIME_WINDOW_EVENTS.CREATED);
    const cancelledEvents = allEvents.filter(e => e.event_type === TIME_WINDOW_EVENTS.CANCELLED);

    const totalWindows = createdEvents.length;
    const cancelledWindows = cancelledEvents.length;
    const activeWindows = totalWindows - cancelledWindows;

    const totalPurchases = purchaseEvents.length;
    const uniqueBuyers = new Set(purchaseEvents.map(e => e.buyer_address).filter(Boolean)).size;
    const totalSharesSold = purchaseEvents.reduce((sum, e) => sum + (e.details?.shares || 0), 0);
    const totalVolume = purchaseEvents.reduce((sum, e) => sum + (e.details?.totalAmount || 0), 0);

    const uniqueWindowIds = new Set(allEvents.map(e => e.window_id));
    const windowsWithPurchases = new Set(purchaseEvents.map(e => e.window_id));

    return {
      contractId,
      totalWindows,
      activeWindows,
      cancelledWindows,
      totalPurchases,
      uniqueBuyers,
      totalSharesSold,
      totalVolume,
      windowsUtilizationRate: totalWindows > 0
        ? Math.round((windowsWithPurchases.size / totalWindows) * 100)
        : 0,
      averagePurchasesPerWindow: totalWindows > 0
        ? Math.round((totalPurchases / totalWindows) * 100) / 100
        : 0,
    };
  }

  /**
   * Get time window usage trends over time
   *
   * @param {string} contractId
   * @param {Object} [options]
   * @param {number} [options.days=30]
   * @returns {Promise<Object[]>}
   */
  async getWindowTrends(contractId, options = {}) {
    const { days = 30 } = options;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await this.db('time_window_events')
      .where('contract_id', contractId)
      .where('created_at', '>=', fromDate)
      .orderBy('created_at', 'asc');

    const dailyMap = {};
    for (const event of events) {
      const date = event.created_at.toISOString().slice(0, 10);
      if (!dailyMap[date]) {
        dailyMap[date] = { date, purchases: 0, sharesSold: 0, volume: 0, events: 0 };
      }
      dailyMap[date].events += 1;
      if (event.event_type === TIME_WINDOW_EVENTS.PURCHASED) {
        dailyMap[date].purchases += 1;
        dailyMap[date].sharesSold += event.details?.shares || 0;
        dailyMap[date].volume += event.details?.totalAmount || 0;
      }
    }

    return Object.values(dailyMap);
  }
}

  /**
   * Get events for a time window using cursor-based pagination
   *
   * @param {string} contractId
   * @param {string|number} windowId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {string} [options.after] - Cursor for forward pagination
   * @param {string} [options.before] - Cursor for backward pagination
   * @returns {Promise<{data: Object[], pagination: Object}>}
   */
  async getWindowEventsCursor(contractId, windowId, options = {}) {
    const { limit = 50, after, before } = options;

    let query = this.db('time_window_events')
      .where('contract_id', contractId)
      .where('window_id', String(windowId));

    const countQuery = this.db('time_window_events')
      .where('contract_id', contractId)
      .where('window_id', String(windowId))
      .count('* as total').first();

    const [{ total }] = await countQuery;
    const totalCount = parseInt(total);

    if (after) {
      const cursor = Buffer.from(after, 'base64url').toString('utf-8');
      const [eventId, createdAt] = cursor.split(':');
      query = query.where(function () {
        this.where('created_at', '<', new Date(createdAt))
          .orWhere(function () {
            this.where('created_at', '=', new Date(createdAt))
              .andWhere('event_id', '<', eventId);
          });
      });
    }

    if (before) {
      const cursor = Buffer.from(before, 'base64url').toString('utf-8');
      const [eventId, createdAt] = cursor.split(':');
      query = query.where(function () {
        this.where('created_at', '>', new Date(createdAt))
          .orWhere(function () {
            this.where('created_at', '=', new Date(createdAt))
              .andWhere('event_id', '>', eventId);
          });
      });
    }

    const orderDir = before ? 'asc' : 'desc';
    const events = await query
      .orderBy('created_at', orderDir)
      .orderBy('event_id', orderDir)
      .limit(limit + 1);

    const hasMore = events.length > limit;
    if (hasMore) events.pop();

    if (before) events.reverse();

    const data = events;
    const hasNext = after ? hasMore : (!before && hasMore);
    const hasPrev = before ? hasMore : false;

    const pagination = {
      limit,
      total: totalCount,
      hasNext,
      hasPrev,
    };

    if (hasNext && data.length > 0) {
      const last = data[data.length - 1];
      pagination.nextCursor = Buffer.from(`${last.event_id}:${last.created_at.toISOString()}`).toString('base64url');
    }

    if (hasPrev && data.length > 0) {
      const first = data[0];
      pagination.prevCursor = Buffer.from(`${first.event_id}:${first.created_at.toISOString()}`).toString('base64url');
    }

    return { data, pagination };
  }

  /**
   * Get all events for an asset's time windows using cursor-based pagination
   *
   * @param {string} contractId
   * @param {Object} [options]
   * @param {string} [options.eventType] - Filter by event type
   * @param {string} [options.from] - Start date ISO string
   * @param {string} [options.to] - End date ISO string
   * @param {number} [options.limit=100]
   * @param {string} [options.after] - Cursor for forward pagination
   * @param {string} [options.before] - Cursor for backward pagination
   * @returns {Promise<{data: Object[], pagination: Object}>}
   */
  async getAssetWindowEventsCursor(contractId, options = {}) {
    const { eventType, from, to, limit = 100, after, before } = options;

    let query = this.db('time_window_events')
      .where('contract_id', contractId);

    let countQuery = this.db('time_window_events')
      .where('contract_id', contractId);

    if (eventType) {
      query = query.where('event_type', eventType);
      countQuery = countQuery.where('event_type', eventType);
    }
    if (from) {
      query = query.where('created_at', '>=', new Date(from));
      countQuery = countQuery.where('created_at', '>=', new Date(from));
    }
    if (to) {
      query = query.where('created_at', '<=', new Date(to));
      countQuery = countQuery.where('created_at', '<=', new Date(to));
    }

    const [{ total }] = await countQuery.count('* as total').first();
    const totalCount = parseInt(total);

    if (after) {
      const cursor = Buffer.from(after, 'base64url').toString('utf-8');
      const [eventId, createdAt] = cursor.split(':');
      query = query.where(function () {
        this.where('created_at', '<', new Date(createdAt))
          .orWhere(function () {
            this.where('created_at', '=', new Date(createdAt))
              .andWhere('event_id', '<', eventId);
          });
      });
    }

    if (before) {
      const cursor = Buffer.from(before, 'base64url').toString('utf-8');
      const [eventId, createdAt] = cursor.split(':');
      query = query.where(function () {
        this.where('created_at', '>', new Date(createdAt))
          .orWhere(function () {
            this.where('created_at', '=', new Date(createdAt))
              .andWhere('event_id', '>', eventId);
          });
      });
    }

    const orderDir = before ? 'asc' : 'desc';
    const events = await query
      .orderBy('created_at', orderDir)
      .orderBy('event_id', orderDir)
      .limit(limit + 1);

    const hasMore = events.length > limit;
    if (hasMore) events.pop();

    if (before) events.reverse();

    const data = events;
    const hasNext = after ? hasMore : (!before && hasMore);
    const hasPrev = before ? hasMore : false;

    const pagination = {
      limit,
      total: totalCount,
      hasNext,
      hasPrev,
    };

    if (hasNext && data.length > 0) {
      const last = data[data.length - 1];
      pagination.nextCursor = Buffer.from(`${last.event_id}:${last.created_at.toISOString()}`).toString('base64url');
    }

    if (hasPrev && data.length > 0) {
      const first = data[0];
      pagination.prevCursor = Buffer.from(`${first.event_id}:${first.created_at.toISOString()}`).toString('base64url');
    }

    return { data, pagination };
  }

  /**
   * Factory function
   * @param {import('knex').Knex} db
   * @param {Object} logger
   * @returns {TimeWindowService}
   */
  static create(db, logger) {
    return new TimeWindowService(db, logger);
  }
}

export function createTimeWindowService(db, logger) {
  return new TimeWindowService(db, logger);
}
