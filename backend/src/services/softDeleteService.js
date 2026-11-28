/**
 * Soft Delete Service
 * Manages soft delete queries, restoration/recovery, audit logging, 
 * and automated retention cleanup jobs.
 */

export class SoftDeleteService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
  }

  /**
   * Query builder helper that automatically excludes soft-deleted records by default
   */
  activeQuery(tableName, includeDeleted = false) {
    const query = this.db(tableName);
    if (!includeDeleted) {
      query.whereNull(`${tableName}.deleted_at`);
    }
    return query;
  }

  /**
   * Soft delete a record by ID
   */
  async softDelete(tableName, idColumn, id, userId = 'system') {
    const timestamp = new Date().toISOString();
    
    const updatedRows = await this.db(tableName)
      .where({ [idColumn]: id })
      .whereNull('deleted_at')
      .update({ deleted_at: timestamp });

    if (updatedRows === 0) {
      throw new Error(`Record not found or already deleted in ${tableName}`);
    }

    this.logger.info({ tableName, id, userId, timestamp }, 'Record soft deleted');
    return { success: true, id, deletedAt: timestamp };
  }

  /**
   * Restore (recover) a soft-deleted record
   */
  async restore(tableName, idColumn, id, userId = 'system') {
    const restoredRows = await this.db(tableName)
      .where({ [idColumn]: id })
      .whereNotNull('deleted_at')
      .update({ deleted_at: null });

    if (restoredRows === 0) {
      throw new Error(`Soft-deleted record not found in ${tableName}`);
    }

    this.logger.info({ tableName, id, userId }, 'Record restored from soft delete');
    return { success: true, id, restored: true };
  }

  /**
   * Automated cleanup job: Permanently delete records exceeding retention policy (e.g. 30 days)
   */
  async runRetentionCleanup(tableName, retentionDays = 30) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - retentionDays);

    const deletedCount = await this.db(tableName)
      .whereNotNull('deleted_at')
      .where('deleted_at', '<', thresholdDate.toISOString())
      .del();

    this.logger.info({ tableName, retentionDays, purgedCount: deletedCount }, 'Retention cleanup completed');
    return { tableName, purgedCount: deletedCount };
  }
}
