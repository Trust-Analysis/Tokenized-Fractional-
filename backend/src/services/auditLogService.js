import { randomUUID } from 'crypto';

const MAX_IN_MEMORY_ENTRIES = 1000;

export function createAuditLogService(db = null) {
  const inMemoryLogs = [];
  const useDb = db && typeof db.insert === 'function';

  async function logAction(action, userId, details = {}, req = null) {
    const entry = {
      id: `audit_${Date.now()}_${randomUUID().slice(0, 8)}`,
      action,
      userId,
      timestamp: new Date().toISOString(),
      details: typeof details === 'object' ? details : { message: details },
      ip: req?.ip || req?.connection?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
      requestId: req?.requestId || null,
    };

    if (useDb) {
      try {
        await db('audit_logs').insert(entry);
      } catch (err) {
        inMemoryLogs.push({ ...entry, fallback: true });
        if (inMemoryLogs.length > MAX_IN_MEMORY_ENTRIES) {
          inMemoryLogs.splice(0, inMemoryLogs.length - MAX_IN_MEMORY_ENTRIES);
        }
      }
    } else {
      inMemoryLogs.push(entry);
      if (inMemoryLogs.length > MAX_IN_MEMORY_ENTRIES) {
        inMemoryLogs.splice(0, inMemoryLogs.length - MAX_IN_MEMORY_ENTRIES);
      }
    }

    return entry;
  }

  async function getLogs(filters = {}) {
    const {
      action: filterAction,
      userId,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = filters;

    let entries;

    if (useDb) {
      try {
        let query = db('audit_logs').orderBy('timestamp', 'desc');
        if (filterAction) query = query.where('action', filterAction);
        if (userId) query = query.where('userId', userId);
        if (startDate) query = query.where('timestamp', '>=', startDate);
        if (endDate) query = query.where('timestamp', '<=', endDate);
        const result = await query.clone().limit(limit).offset(offset);
        const [{ count }] = await query.clone().clearSelect().count('* as count');
        return { entries: result, total: Number(count), limit, offset };
      } catch {
        entries = [...inMemoryLogs];
      }
    } else {
      entries = [...inMemoryLogs];
    }

    if (filterAction) {
      entries = entries.filter((e) => e.action === filterAction);
    }
    if (userId) {
      entries = entries.filter((e) => e.userId === userId);
    }
    if (startDate) {
      entries = entries.filter((e) => e.timestamp >= startDate);
    }
    if (endDate) {
      entries = entries.filter((e) => e.timestamp <= endDate);
    }

    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = entries.length;
    entries = entries.slice(offset, offset + limit);

    return { entries, total, limit, offset };
  }

  return { logAction, getLogs };
}
