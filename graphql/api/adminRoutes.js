/**
 * Admin Management API for Persisted Queries
 * Provides comprehensive query management, monitoring, and analytics
 */

import express from 'express';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AdminAPI');

/**
 * Create admin routes for persisted query management
 */
export function createAdminRoutes(manager, lookup, versioning) {
  const router = express.Router();

  // Middleware for admin authentication
  const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // ────────────────────────────────────────────────────────────────
  // Query Management Endpoints
  // ────────────────────────────────────────────────────────────────

  /**
   * GET /admin/queries - List all queries
   */
  router.get('/queries', requireAdmin, async (req, res) => {
    try {
      const filters = {
        isActive: req.query.active !== 'false',
        isDeprecated: req.query.deprecated === 'true',
        category: req.query.category,
        tags: req.query.tags?.split(','),
      };

      const queries = await manager.store.searchQueries(filters);

      return res.json({
        count: queries.length,
        queries: queries.map(q => ({
          id: q.id,
          operationName: q.operationName,
          category: q.category,
          version: q.version,
          complexity: q.complexity,
          executionCount: q.executionCount,
          isActive: q.isActive,
          isDeprecated: q.isDeprecated,
          createdAt: q.createdAt,
          updatedAt: q.updatedAt,
        })),
      });
    } catch (error) {
      logger.error('Query listing failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /admin/queries/:queryId - Get query details
   */
  router.get('/queries/:queryId', requireAdmin, async (req, res) => {
    try {
      const query = await manager.store.getQuery(req.params.queryId);
      if (!query) {
        return res.status(404).json({ error: 'Query not found' });
      }

      const versions = await versioning.getQueryVersions(req.params.queryId, true);
      const logs = await manager.store.getExecutionLogs(req.params.queryId, 100);
      const metrics = await manager.store.getMetrics(req.params.queryId);

      return res.json({
        query,
        versions: versions.length,
        recentExecutions: logs.slice(0, 10),
        metrics,
      });
    } catch (error) {
      logger.error('Query details retrieval failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/queries - Register new query
   */
  router.post('/queries', requireAdmin, async (req, res) => {
    try {
      const { queryString, operationName, category, description, tags } = req.body;

      if (!queryString) {
        return res.status(400).json({ error: 'queryString is required' });
      }

      const result = await manager.registerQuery(queryString, {
        operationName,
        category,
        description,
        tags,
        createdBy: req.user.id,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      logger.info('Query registered via admin API', { queryId: result.queryId });
      return res.status(201).json(result);
    } catch (error) {
      logger.error('Query registration failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /admin/queries/:queryId - Update query
   */
  router.put('/queries/:queryId', requireAdmin, async (req, res) => {
    try {
      const { queryString, changelog } = req.body;

      if (!queryString) {
        return res.status(400).json({ error: 'queryString is required' });
      }

      const result = await manager.updateQuery(req.params.queryId, queryString, {
        changelog,
        updatedBy: req.user.id,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      logger.info('Query updated via admin API', { queryId: req.params.queryId });
      return res.json(result);
    } catch (error) {
      logger.error('Query update failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /admin/queries/:queryId - Deactivate query
   */
  router.delete('/queries/:queryId', requireAdmin, async (req, res) => {
    try {
      const query = await manager.store.getQuery(req.params.queryId);
      if (!query) {
        return res.status(404).json({ error: 'Query not found' });
      }

      query.isActive = false;
      query.updatedAt = new Date();
      query.updatedBy = req.user.id;

      await manager.store.updateQuery(req.params.queryId, query);

      logger.info('Query deactivated via admin API', { queryId: req.params.queryId });
      return res.json({ success: true, message: 'Query deactivated' });
    } catch (error) {
      logger.error('Query deactivation failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Versioning Endpoints
  // ────────────────────────────────────────────────────────────────

  /**
   * GET /admin/queries/:queryId/versions - List versions
   */
  router.get('/queries/:queryId/versions', requireAdmin, async (req, res) => {
    try {
      const versions = await versioning.getQueryVersions(req.params.queryId, true);
      return res.json({ count: versions.length, versions });
    } catch (error) {
      logger.error('Version listing failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/queries/:queryId/versions/:version/rollback - Rollback
   */
  router.post('/queries/:queryId/versions/:version/rollback', requireAdmin, async (req, res) => {
    try {
      const result = await versioning.rollbackToVersion(
        req.params.queryId,
        parseInt(req.params.version),
        { updatedBy: req.user.id }
      );

      if (!result.success) {
        return res.status(400).json(result);
      }

      logger.info('Query rolled back via admin API', result);
      return res.json(result);
    } catch (error) {
      logger.error('Query rollback failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/queries/:queryId/deprecate - Deprecate query
   */
  router.post('/queries/:queryId/deprecate', requireAdmin, async (req, res) => {
    try {
      const { reason, replacement } = req.body;

      const result = await manager.deprecateQuery(
        req.params.queryId,
        reason,
        replacement
      );

      if (!result.success) {
        return res.status(400).json(result);
      }

      logger.info('Query deprecated via admin API', { queryId: req.params.queryId });
      return res.json(result);
    } catch (error) {
      logger.error('Query deprecation failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Analytics & Monitoring Endpoints
  // ────────────────────────────────────────────────────────────────

  /**
   * GET /admin/analytics/queries - Query analytics dashboard
   */
  router.get('/analytics/queries', requireAdmin, async (req, res) => {
    try {
      const queries = await manager.store.searchQueries({ isActive: true });

      const analytics = {
        totalQueries: queries.length,
        totalExecutions: queries.reduce((sum, q) => sum + q.executionCount, 0),
        averageComplexity: queries.reduce((sum, q) => sum + q.complexity, 0) / queries.length,
        deprecatedCount: queries.filter(q => q.isDeprecated).length,
        byCategory: {},
      };

      // Group by category
      for (const query of queries) {
        if (!analytics.byCategory[query.category]) {
          analytics.byCategory[query.category] = {
            count: 0,
            totalExecutions: 0,
            avgComplexity: 0,
          };
        }
        analytics.byCategory[query.category].count++;
        analytics.byCategory[query.category].totalExecutions += query.executionCount;
        analytics.byCategory[query.category].avgComplexity += query.complexity;
      }

      return res.json(analytics);
    } catch (error) {
      logger.error('Analytics retrieval failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /admin/analytics/execution-log - Execution logs
   */
  router.get('/analytics/execution-log', requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
      const logs = await manager.store.getExecutionLogs(null, limit);

      return res.json({
        count: logs.length,
        logs: logs.map(log => ({
          queryId: log.queryId,
          executionTime: log.executionTime,
          status: log.status,
          executedAt: log.executedAt,
          cacheHit: log.cacheHit,
        })),
      });
    } catch (error) {
      logger.error('Execution log retrieval failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /admin/cache/statistics - Cache statistics
   */
  router.get('/cache/statistics', requireAdmin, async (req, res) => {
    try {
      const stats = lookup.getLookupStatistics();
      return res.json(stats);
    } catch (error) {
      logger.error('Cache statistics retrieval failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/cache/warm - Warm cache
   */
  router.post('/cache/warm', requireAdmin, async (req, res) => {
    try {
      const result = await lookup.warmCache(req.body.limit || 100);
      return res.json(result);
    } catch (error) {
      logger.error('Cache warming failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/cache/clear - Clear cache
   */
  router.post('/cache/clear', requireAdmin, async (req, res) => {
    try {
      const result = await lookup.clearCache();
      return res.json(result);
    } catch (error) {
      logger.error('Cache clearing failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /admin/queries/batch - Batch register queries
   */
  router.post('/queries/batch', requireAdmin, async (req, res) => {
    try {
      const { queries } = req.body;

      if (!Array.isArray(queries)) {
        return res.status(400).json({ error: 'queries must be an array' });
      }

      const result = await manager.batchRegisterQueries(queries);

      return res.json(result);
    } catch (error) {
      logger.error('Batch registration failed', { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAdminRoutes;
