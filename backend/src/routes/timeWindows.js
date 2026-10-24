// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/timeWindows.js — Modular time window route handlers
 *
 * Public endpoints:
 * - GET /time-windows/:contractId — List time windows for an asset
 * - GET /time-windows/:contractId/:windowId — Get single time window
 * - GET /time-windows/:contractId/:windowId/events — Get events for a window
 * - GET /time-windows/:contractId/:windowId/analytics — Get window analytics
 * - GET /time-windows/:contractId/analytics/aggregate — Aggregate analytics
 * - GET /time-windows/:contractId/analytics/trends — Usage trends
 *
 * Admin endpoints (require x-api-key):
 * - POST /time-windows/:contractId — Create time window metadata
 * - PUT /time-windows/:contractId/:windowId — Update time window metadata
 * - DELETE /time-windows/:contractId/:windowId — Delete time window metadata
 * - POST /time-windows/:contractId/:windowId/log — Manually log an event
 */

import { Router } from 'express';
import { validateContractId } from '../validators/rwaValidator.js';
import { loadData, saveData } from '../services/dataService.js';
import { cacheDel } from '../../cache.js';

/**
 * Factory function to create time window routes
 * @param {Object} timeWindowService - TimeWindowService instance
 * @param {Object} logger
 * @param {Function} adminAuth - Admin auth middleware
 * @returns {Router}
 */
export function createTimeWindowRoutes(timeWindowService, logger, adminAuth) {
  const router = Router();

  // ── GET /:contractId — List time windows ──────────────────────────────────
  /**
   * @openapi
   * /time-windows/{contractId}:
   *   get:
   *     tags: [Time Windows]
   *     summary: List time windows for an asset
   *     description: Returns all time-locked purchase windows associated with a given asset contract ID.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema:
   *           type: string
   *           minLength: 50
   *         description: Asset contract ID
   *     responses:
   *       200:
   *         description: List of time windows
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TimeWindowListResponse'
   *       400:
   *         description: Invalid contract ID
   *       404:
   *         description: Asset not found
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId', (req, res) => {
    try {
      const { contractId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const data = loadData();
      const asset = data[contractId];
      if (!asset) return res.status(404).json({ error: 'Asset not found' });

      const windows = asset.timeWindows || {};
      const list = Object.entries(windows).map(([windowId, meta]) => ({
        windowId,
        ...meta,
      }));

      res.json({ data: list, total: list.length });
    } catch (error) {
      logger?.error({ error: error.message, contractId: req.params.contractId }, 'Failed to list time windows');
      res.status(500).json({ error: 'Failed to list time windows' });
    }
  });

  // ── GET /:contractId/:windowId — Get single time window ───────────────────
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}:
   *   get:
   *     tags: [Time Windows]
   *     summary: Get single time window
   *     description: Returns metadata for a specific time-locked purchase window.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema:
   *           type: string
   *           minLength: 50
   *         description: Asset contract ID
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema:
   *           type: string
   *         description: Time window identifier
   *     responses:
   *       200:
   *         description: Time window metadata
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TimeWindow'
   *       400:
   *         description: Invalid contract ID
   *       404:
   *         description: Asset or time window not found
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/:windowId', (req, res) => {
    try {
      const { contractId, windowId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const data = loadData();
      const asset = data[contractId];
      if (!asset) return res.status(404).json({ error: 'Asset not found' });

      const windowMeta = asset.timeWindows?.[windowId];
      if (!windowMeta) return res.status(404).json({ error: 'Time window not found' });

      res.json({ windowId, ...windowMeta });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get time window');
      res.status(500).json({ error: 'Failed to get time window' });
    }
  });

  // ── GET /:contractId/:windowId/events — Get window events (cursor-based) ──
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}/events:
   *   get:
   *     tags: [Time Window Events]
   *     summary: Get events for a time window (cursor-based)
   *     description: Returns paginated events for a specific time-locked purchase window. Supports cursor-based pagination using event ID + timestamp cursors. Events are ordered by created_at descending.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *         description: Asset contract ID
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema: { type: string }
   *         description: Time window identifier
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50 }
   *         description: Maximum events per page
   *       - in: query
   *         name: after
   *         schema: { type: string }
   *         description: Cursor for forward pagination
   *       - in: query
   *         name: before
   *         schema: { type: string }
   *         description: Cursor for backward pagination
   *     responses:
   *       200:
   *         description: Paginated events
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PaginatedTimeWindowEvents'
   *       400:
   *         description: Invalid contract ID
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/:windowId/events', async (req, res) => {
    try {
      const { contractId, windowId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const { limit, after, before } = req.query;
      const result = await timeWindowService.getWindowEventsCursor(contractId, windowId, {
        limit: limit ? parseInt(limit) : 50,
        after,
        before,
      });

      res.json(result);
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get window events');
      res.status(500).json({ error: 'Failed to get window events' });
    }
  });

  // ── GET /:contractId/:windowId/analytics — Get window analytics ───────────
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}/analytics:
   *   get:
   *     tags: [Time Window Events]
   *     summary: Get analytics for a time window
   *     description: Returns purchase analytics (total purchases, unique buyers, shares sold, volume, averages) for a specific time window.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Window analytics
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TimeWindowAnalyticsResponse'
   *       400:
   *         description: Invalid contract ID
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/:windowId/analytics', async (req, res) => {
    try {
      const { contractId, windowId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const analytics = await timeWindowService.getWindowAnalytics(contractId, windowId);
      res.json({ data: analytics });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get window analytics');
      res.status(500).json({ error: 'Failed to get window analytics' });
    }
  });

  // ── GET /:contractId/analytics/aggregate — Aggregate analytics ────────────
  /**
   * @openapi
   * /time-windows/{contractId}/analytics/aggregate:
   *   get:
   *     tags: [Time Window Events]
   *     summary: Get aggregate analytics across all windows
   *     description: Returns aggregated analytics across all time windows for an asset, including total windows, active vs cancelled, total volume, utilization rate.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Aggregate analytics
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AggregateAnalyticsResponse'
   *       400:
   *         description: Invalid contract ID
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/analytics/aggregate', async (req, res) => {
    try {
      const { contractId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const analytics = await timeWindowService.getAssetTimeWindowAnalytics(contractId);
      res.json({ data: analytics });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get aggregate analytics');
      res.status(500).json({ error: 'Failed to get aggregate analytics' });
    }
  });

  // ── GET /:contractId/analytics/trends — Usage trends ──────────────────────
  /**
   * @openapi
   * /time-windows/{contractId}/analytics/trends:
   *   get:
   *     tags: [Time Window Events]
   *     summary: Get usage trends over time
   *     description: Returns daily aggregated event data (purchases, shares sold, volume) for the specified lookback period.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: days
   *         schema: { type: integer, default: 30, minimum: 1 }
   *         description: Number of days to look back
   *     responses:
   *       200:
   *         description: Daily trend data
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/WindowTrendsResponse'
   *       400:
   *         description: Invalid contract ID
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/analytics/trends', async (req, res) => {
    try {
      const { contractId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const days = req.query.days ? parseInt(req.query.days) : 30;
      const trends = await timeWindowService.getWindowTrends(contractId, { days });
      res.json({ data: trends });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get window trends');
      res.status(500).json({ error: 'Failed to get window trends' });
    }
  });

  // ── GET /:contractId/events — All events for asset's time windows (cursor) ─
  /**
   * @openapi
   * /time-windows/{contractId}/events:
   *   get:
   *     tags: [Time Window Events]
   *     summary: Get all events for an asset's time windows (cursor-based)
   *     description: Returns cursor-paginated events across all time windows for an asset. Supports filtering by eventType, date range (from/to), and cursor pagination.
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: eventType
   *         schema: { type: string }
   *         description: Filter by event type
   *       - in: query
   *         name: from
   *         schema: { type: string, format: date-time }
   *         description: Start date (ISO 8601)
   *       - in: query
   *         name: to
   *         schema: { type: string, format: date-time }
   *         description: End date (ISO 8601)
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 100 }
   *         description: Maximum events per page
   *       - in: query
   *         name: after
   *         schema: { type: string }
   *         description: Cursor for forward pagination
   *       - in: query
   *         name: before
   *         schema: { type: string }
   *         description: Cursor for backward pagination
   *     responses:
   *       200:
   *         description: Paginated events
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PaginatedTimeWindowEvents'
   *       400:
   *         description: Invalid contract ID
   *       500:
   *         description: Internal server error
   */
  router.get('/:contractId/events', async (req, res) => {
    try {
      const { contractId } = req.params;
      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const { eventType, from, to, limit, after, before } = req.query;
      const result = await timeWindowService.getAssetWindowEventsCursor(contractId, {
        eventType,
        from,
        to,
        limit: limit ? parseInt(limit) : 100,
        after,
        before,
      });

      res.json(result);
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to get asset window events');
      res.status(500).json({ error: 'Failed to get asset window events' });
    }
  });

  // ── POST /:contractId — Create time window metadata (admin) ──────────────
  /**
   * @openapi
   * /time-windows/{contractId}:
   *   post:
   *     tags: [Time Windows]
   *     summary: Create time window metadata (admin)
   *     description: Creates a new time-locked purchase window for an asset. Requires admin authentication. Required: windowId, title, description. Logs a window.metadata.created event on success.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TimeWindowInput'
   *     responses:
   *       201:
   *         description: Time window created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TimeWindow'
   *       400:
   *         description: Invalid contract ID or missing required fields
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: Asset not found
   *       500:
   *         description: Internal server error
   */
  router.post('/:contractId', adminAuth, (req, res) => {
    try {
      const { contractId } = req.params;
      const { windowId, title, description, imageUrl, termsUrl } = req.body;

      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      if (!windowId || !title || !description) {
        return res.status(400).json({
          error: 'Missing required fields: windowId, title, description',
        });
      }

      const data = loadData();
      if (!data[contractId]) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      if (!data[contractId].timeWindows) {
        data[contractId].timeWindows = {};
      }

      const now = new Date().toISOString();
      data[contractId].timeWindows[windowId] = {
        title,
        description,
        imageUrl: imageUrl || '',
        termsUrl: termsUrl || '',
        createdAt: data[contractId].timeWindows[windowId]?.createdAt || now,
        updatedAt: now,
      };

      saveData(data);
      cacheDel(`rwa:${contractId}`).catch(() => {});

      timeWindowService.logEvent({
        eventType: 'window.metadata.created',
        contractId,
        windowId,
        details: { title, description },
      }).catch(() => {});

      logger?.info({ contractId, windowId }, 'Time window metadata created');
      res.status(201).json({ windowId, ...data[contractId].timeWindows[windowId] });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to create time window');
      res.status(500).json({ error: 'Failed to create time window' });
    }
  });

  // ── PUT /:contractId/:windowId — Update time window metadata (admin) ──────
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}:
   *   put:
   *     tags: [Time Windows]
   *     summary: Update time window metadata (admin)
   *     description: Updates an existing time window's metadata (title, description, imageUrl, termsUrl). Partial updates supported. Logs a window.metadata.updated event on success.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title: { type: string }
   *               description: { type: string }
   *               imageUrl: { type: string }
   *               termsUrl: { type: string }
   *     responses:
   *       200:
   *         description: Time window updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TimeWindow'
   *       400:
   *         description: Invalid contract ID
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: Asset or time window not found
   *       500:
   *         description: Internal server error
   */
  router.put('/:contractId/:windowId', adminAuth, (req, res) => {
    try {
      const { contractId, windowId } = req.params;
      const { title, description, imageUrl, termsUrl } = req.body;

      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const data = loadData();
      const asset = data[contractId];
      if (!asset) return res.status(404).json({ error: 'Asset not found' });

      if (!asset.timeWindows?.[windowId]) {
        return res.status(404).json({ error: 'Time window not found' });
      }

      const existing = asset.timeWindows[windowId];
      asset.timeWindows[windowId] = {
        ...existing,
        title: title || existing.title,
        description: description || existing.description,
        imageUrl: imageUrl !== undefined ? imageUrl : existing.imageUrl,
        termsUrl: termsUrl !== undefined ? termsUrl : existing.termsUrl,
        updatedAt: new Date().toISOString(),
      };

      saveData(data);
      cacheDel(`rwa:${contractId}`).catch(() => {});

      timeWindowService.logEvent({
        eventType: 'window.metadata.updated',
        contractId,
        windowId,
        details: { title, description },
      }).catch(() => {});

      logger?.info({ contractId, windowId }, 'Time window metadata updated');
      res.json({ windowId, ...asset.timeWindows[windowId] });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to update time window');
      res.status(500).json({ error: 'Failed to update time window' });
    }
  });

  // ── DELETE /:contractId/:windowId — Delete time window metadata (admin) ───
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}:
   *   delete:
   *     tags: [Time Windows]
   *     summary: Delete time window metadata (admin)
   *     description: Deletes a time window and its metadata. Logs a window.metadata.deleted event.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Time window deleted
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DeleteResponse'
   *       400:
   *         description: Invalid contract ID
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: Time window not found
   *       500:
   *         description: Internal server error
   */
  router.delete('/:contractId/:windowId', adminAuth, (req, res) => {
    try {
      const { contractId, windowId } = req.params;

      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      const data = loadData();
      const asset = data[contractId];
      if (!asset?.timeWindows?.[windowId]) {
        return res.status(404).json({ error: 'Time window not found' });
      }

      delete asset.timeWindows[windowId];
      saveData(data);
      cacheDel(`rwa:${contractId}`).catch(() => {});

      timeWindowService.logEvent({
        eventType: 'window.metadata.deleted',
        contractId,
        windowId,
      }).catch(() => {});

      logger?.info({ contractId, windowId }, 'Time window metadata deleted');
      res.json({ message: 'Time window metadata deleted', windowId });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to delete time window');
      res.status(500).json({ error: 'Failed to delete time window' });
    }
  });

  // ── POST /:contractId/:windowId/log — Manually log event (admin) ──────────
  /**
   * @openapi
   * /time-windows/{contractId}/{windowId}/log:
   *   post:
   *     tags: [Time Window Events]
   *     summary: Manually log a time window event (admin)
   *     description: Manually records a time window event (e.g., for backfilling or testing). Requires admin authentication. Only eventType is required; adminAddress, buyerAddress, and details are optional.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: contractId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: windowId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TimeWindowEventInput'
   *     responses:
   *       201:
   *         description: Event logged successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PaginatedTimeWindowEvents'
   *       400:
   *         description: Invalid contract ID or missing eventType
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.post('/:contractId/:windowId/log', adminAuth, async (req, res) => {
    try {
      const { contractId, windowId } = req.params;
      const { eventType, adminAddress, buyerAddress, details } = req.body;

      if (!validateContractId(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID' });
      }

      if (!eventType) {
        return res.status(400).json({ error: 'Missing required field: eventType' });
      }

      const event = await timeWindowService.logEvent({
        eventType,
        contractId,
        windowId,
        adminAddress,
        buyerAddress,
        details,
      });

      if (!event) {
        return res.status(500).json({ error: 'Failed to log event' });
      }

      logger?.info({ contractId, windowId, eventType }, 'Time window event logged manually');
      res.status(201).json({ data: event });
    } catch (error) {
      logger?.error({ error: error.message }, 'Failed to log time window event');
      res.status(500).json({ error: 'Failed to log event' });
    }
  });

  return router;
}
