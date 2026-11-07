/**
 * Query Versioning and Migration System
 * Manages query versions, migrations, and rollback capabilities
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('QueryVersioning');

/**
 * Query Version Manager
 */
export class QueryVersionManager {
  constructor(store) {
    this.store = store;
    this.migrationQueue = [];
  }

  /**
   * Get all versions of a query
   */
  async getQueryVersions(queryId, includeInactive = false) {
    try {
      const versions = await this.store.getQueryVersions(queryId);

      if (!includeInactive) {
        return versions.filter(v => v.isActive);
      }

      return versions;
    } catch (error) {
      logger.error('Failed to get query versions', { queryId, error: error.message });
      throw error;
    }
  }

  /**
   * Get specific version
   */
  async getVersion(queryId, version) {
    try {
      const versionRecord = await this.store.getQueryVersion(queryId, version);
      if (!versionRecord) {
        return { success: false, error: 'Version not found' };
      }

      return { success: true, version: versionRecord };
    } catch (error) {
      logger.error('Failed to get version', { queryId, version, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Rollback to previous version
   */
  async rollbackToVersion(queryId, targetVersion, metadata = {}) {
    try {
      logger.info('Rolling back query', { queryId, targetVersion });

      // Get current query
      const currentQuery = await this.store.getQuery(queryId);
      if (!currentQuery) {
        return { success: false, error: 'Query not found' };
      }

      // Get target version
      const targetVersionRecord = await this.store.getQueryVersion(queryId, targetVersion);
      if (!targetVersionRecord) {
        return { success: false, error: 'Target version not found' };
      }

      // Create version record for current state
      const rollbackRecord = {
        id: this.generateId(),
        queryId,
        version: currentQuery.version,
        queryString: currentQuery.queryString,
        complexity: currentQuery.complexity,
        maxDepth: currentQuery.maxDepth,
        fieldCount: currentQuery.fieldCount,
        estimatedCost: currentQuery.estimatedCost,
        changelog: `Rolled back from version ${currentQuery.version}`,
        createdAt: currentQuery.updatedAt,
        createdBy: currentQuery.updatedBy,
        replacedAt: new Date(),
        isActive: false,
      };

      await this.store.saveQueryVersion(rollbackRecord);

      // Restore target version
      const updatedQuery = {
        ...currentQuery,
        queryString: targetVersionRecord.queryString,
        complexity: targetVersionRecord.complexity,
        maxDepth: targetVersionRecord.maxDepth,
        fieldCount: targetVersionRecord.fieldCount,
        estimatedCost: targetVersionRecord.estimatedCost,
        version: currentQuery.version + 1,
        updatedAt: new Date(),
        updatedBy: metadata.updatedBy || 'system',
        previousVersions: [
          ...currentQuery.previousVersions,
          rollbackRecord.id,
        ],
      };

      await this.store.updateQuery(queryId, updatedQuery);

      logger.info('Query rollback successful', {
        queryId,
        fromVersion: currentQuery.version,
        toVersion: targetVersion,
        newVersion: updatedQuery.version,
      });

      return {
        success: true,
        queryId,
        previousVersion: currentQuery.version,
        restoredVersion: targetVersion,
        newVersion: updatedQuery.version,
      };
    } catch (error) {
      logger.error('Query rollback failed', { queryId, targetVersion, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(queryId, version1, version2) {
    try {
      const ver1 = await this.store.getQueryVersion(queryId, version1);
      const ver2 = await this.store.getQueryVersion(queryId, version2);

      if (!ver1 || !ver2) {
        return { success: false, error: 'One or both versions not found' };
      }

      return {
        success: true,
        version1: ver1,
        version2: ver2,
        differences: {
          queryString: ver1.queryString !== ver2.queryString,
          complexity: ver1.complexity !== ver2.complexity,
          maxDepth: ver1.maxDepth !== ver2.maxDepth,
          fieldCount: ver1.fieldCount !== ver2.fieldCount,
          estimatedCost: ver1.estimatedCost !== ver2.estimatedCost,
        },
        complexityDiff: ver2.complexity - ver1.complexity,
        depthDiff: ver2.maxDepth - ver1.maxDepth,
        fieldCountDiff: ver2.fieldCount - ver1.fieldCount,
      };
    } catch (error) {
      logger.error('Version comparison failed', { queryId, version1, version2, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Create migration plan
   */
  async createMigrationPlan(fromQueryId, toQueryId) {
    try {
      const fromQuery = await this.store.getQuery(fromQueryId);
      const toQuery = await this.store.getQuery(toQueryId);

      if (!fromQuery || !toQuery) {
        return { success: false, error: 'One or both queries not found' };
      }

      const plan = {
        id: this.generateId(),
        fromQueryId,
        toQueryId,
        status: 'planned',
        createdAt: new Date(),
        steps: [
          {
            step: 1,
            action: 'deprecate',
            queryId: fromQueryId,
            description: `Deprecate ${fromQuery.operationName}`,
          },
          {
            step: 2,
            action: 'notify',
            description: 'Notify users of migration',
          },
          {
            step: 3,
            action: 'monitor',
            description: 'Monitor migration metrics',
          },
          {
            step: 4,
            action: 'complete',
            description: 'Mark migration complete',
          },
        ],
        metrics: {
          fromComplexity: fromQuery.complexity,
          toComplexity: toQuery.complexity,
          complexityImprovement: ((fromQuery.complexity - toQuery.complexity) / fromQuery.complexity) * 100,
        },
      };

      await this.store.saveMigrationPlan(plan);

      logger.info('Migration plan created', { fromQueryId, toQueryId });

      return { success: true, plan };
    } catch (error) {
      logger.error('Migration plan creation failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute migration
   */
  async executeMigration(planId) {
    try {
      const plan = await this.store.getMigrationPlan(planId);
      if (!plan) {
        return { success: false, error: 'Migration plan not found' };
      }

      logger.info('Executing migration', { planId });

      // Update plan status
      plan.status = 'executing';
      plan.startedAt = new Date();
      await this.store.updateMigrationPlan(planId, plan);

      // Execute steps
      for (const step of plan.steps) {
        switch (step.action) {
          case 'deprecate':
            // Deprecate old query
            break;
          case 'notify':
            // Send notifications
            break;
          case 'monitor':
            // Monitor metrics
            break;
          case 'complete':
            // Mark as complete
            break;
        }
      }

      plan.status = 'completed';
      plan.completedAt = new Date();
      await this.store.updateMigrationPlan(planId, plan);

      logger.info('Migration completed', { planId });

      return { success: true, plan };
    } catch (error) {
      logger.error('Migration execution failed', { planId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get version history
   */
  async getVersionHistory(queryId, limit = 10) {
    try {
      const versions = await this.store.getQueryVersions(queryId);
      return versions.slice(0, limit);
    } catch (error) {
      logger.error('Failed to get version history', { queryId, error: error.message });
      throw error;
    }
  }

  /**
   * Generate version report
   */
  async generateVersionReport(queryId) {
    try {
      const versions = await this.store.getQueryVersions(queryId);
      const query = await this.store.getQuery(queryId);

      return {
        queryId,
        operationName: query.operationName,
        totalVersions: versions.length,
        currentVersion: query.version,
        versionHistory: versions.map(v => ({
          version: v.version,
          createdAt: v.createdAt,
          complexity: v.complexity,
          fieldCount: v.fieldCount,
          maxDepth: v.maxDepth,
          changelog: v.changelog,
        })),
        complexityTrend: this.calculateTrend(versions.map(v => v.complexity)),
      };
    } catch (error) {
      logger.error('Report generation failed', { queryId, error: error.message });
      throw error;
    }
  }

  /**
   * Calculate trend in metrics
   */
  calculateTrend(values) {
    if (values.length < 2) return 'stable';

    const recent = values.slice(-5);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const firstHalf = recent.slice(0, Math.ceil(recent.length / 2));
    const secondHalf = recent.slice(Math.ceil(recent.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg > firstAvg * 1.1) return 'increasing';
    if (secondAvg < firstAvg * 0.9) return 'decreasing';
    return 'stable';
  }

  /**
   * Generate ID
   */
  generateId() {
    const { randomUUID } = require('crypto');
    return randomUUID();
  }
}

export default QueryVersionManager;
