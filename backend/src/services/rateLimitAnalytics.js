export class RateLimitAnalytics {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.db = options.db || null;
    this.enabled = process.env.RATE_LIMIT_ANALYTICS_ENABLED !== 'false';

    this.requestLog = [];
    this.blockedLog = [];
    this.eventLog = [];
    this.maxLogSize = parseInt(process.env.RATE_LIMIT_ANALYTICS_MAX_LOG) || 10000;

    this.hourlyBuckets = new Map();
    this.dailyBuckets = new Map();
    this.tierUsage = new Map();
    this._flushInterval = setInterval(() => this._flush(), 60000);
  }

  async logRequest({ apiKey, ip, geo, path, method, tier, windowCount }) {
    if (!this.enabled) return;

    const entry = {
      apiKey: apiKey?.slice(0, 16),
      ip,
      geo,
      path,
      method,
      tier,
      windowCount,
      timestamp: new Date().toISOString(),
    };

    this.requestLog.push(entry);
    if (this.requestLog.length > this.maxLogSize) {
      this.requestLog.shift();
    }

    const hour = this._hourBucket();
    const hourData = this.hourlyBuckets.get(hour) || { total: 0, byTier: {}, byPath: {} };
    hourData.total++;
    hourData.byTier[tier] = (hourData.byTier[tier] || 0) + 1;
    const pathKey = `${method}:${path}`;
    hourData.byPath[pathKey] = (hourData.byPath[pathKey] || 0) + 1;
    this.hourlyBuckets.set(hour, hourData);

    const day = this._dayBucket();
    const dayData = this.dailyBuckets.get(day) || { total: 0, byTier: {} };
    dayData.total++;
    dayData.byTier[tier] = (dayData.byTier[tier] || 0) + 1;
    this.dailyBuckets.set(day, dayData);

    const tierData = this.tierUsage.get(tier) || { total: 0, blocked: 0, keys: new Set() };
    tierData.total++;
    tierData.keys.add(apiKey);
    this.tierUsage.set(tier, tierData);
  }

  async logBlocked({ apiKey, ip, reason, tier, currentCount, limit, confidence, details, country }) {
    if (!this.enabled) return;

    const entry = {
      apiKey: apiKey?.slice(0, 16),
      ip,
      reason,
      tier,
      currentCount,
      limit,
      confidence,
      details,
      country,
      timestamp: new Date().toISOString(),
    };

    this.blockedLog.push(entry);
    if (this.blockedLog.length > this.maxLogSize) {
      this.blockedLog.shift();
    }

    const tierData = this.tierUsage.get(tier) || { total: 0, blocked: 0, keys: new Set() };
    tierData.blocked++;
    this.tierUsage.set(tier, tierData);
  }

  async logEvent(eventType, data) {
    if (!this.enabled) return;

    this.eventLog.push({
      eventType,
      data,
      timestamp: new Date().toISOString(),
    });
    if (this.eventLog.length > 1000) {
      this.eventLog.shift();
    }
  }

  async _flush() {
    if (this.db && this.requestLog.length > 0) {
      try {
        const batch = this.requestLog.splice(0, 100);
        await this.db('rate_limit_requests').insert(
          batch.map(r => ({
            api_key_hash: r.apiKey,
            ip_hash: r.ip,
            path: r.path,
            method: r.method,
            tier: r.tier,
            timestamp: r.timestamp,
          }))
        ).catch(() => {});
      } catch {
        // silent
      }
    }
  }

  _hourBucket() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00`;
  }

  _dayBucket() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  getSummary() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const recentRequests = this.requestLog.filter(r => new Date(r.timestamp).getTime() > hourAgo);
    const recentBlocked = this.blockedLog.filter(r => new Date(r.timestamp).getTime() > hourAgo);

    const tierSummary = {};
    for (const [tier, data] of this.tierUsage) {
      tierSummary[tier] = {
        total: data.total,
        blocked: data.blocked,
        blockRate: data.total > 0 ? Math.round((data.blocked / data.total) * 10000) / 100 : 0,
        activeKeys: data.keys.size,
      };
    }

    const blockedByReason = {};
    for (const entry of this.blockedLog) {
      const reason = entry.reason || 'unknown';
      blockedByReason[reason] = (blockedByReason[reason] || 0) + 1;
    }

    return {
      timeframe: 'last_hour',
      totalRequests: recentRequests.length,
      totalBlocked: recentBlocked.length,
      blockRate: recentRequests.length > 0
        ? Math.round((recentBlocked.length / recentRequests.length) * 10000) / 100
        : 0,
      tierSummary,
      blockedByReason,
      hourlyBuckets: Array.from(this.hourlyBuckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-24),
      dailyBuckets: Array.from(this.dailyBuckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30),
    };
  }

  getDetailedStats(apiKey) {
    const requests = this.requestLog.filter(r => r.apiKey === apiKey?.slice(0, 16));
    const blocked = this.blockedLog.filter(r => r.apiKey === apiKey?.slice(0, 16));

    return {
      totalRequests: requests.length,
      totalBlocked: blocked.length,
      blockRate: requests.length > 0 ? Math.round((blocked.length / requests.length) * 10000) / 100 : 0,
      recentRequests: requests.slice(-50),
      recentBlocked: blocked.slice(-50),
    };
  }

  async exportData(options = {}) {
    const { from, to, format = 'json' } = options;
    let requests = this.requestLog;
    let blocked = this.blockedLog;

    if (from) {
      const fromTime = new Date(from).getTime();
      requests = requests.filter(r => new Date(r.timestamp).getTime() >= fromTime);
      blocked = blocked.filter(r => new Date(r.timestamp).getTime() >= fromTime);
    }
    if (to) {
      const toTime = new Date(to).getTime();
      requests = requests.filter(r => new Date(r.timestamp).getTime() <= toTime);
      blocked = blocked.filter(r => new Date(r.timestamp).getTime() <= toTime);
    }

    if (format === 'csv') {
      const reqCsv = ['apiKey,ip,path,method,tier,timestamp'].concat(
        requests.map(r => `${r.apiKey},${r.ip},${r.path},${r.method},${r.tier},${r.timestamp}`)
      ).join('\n');
      const blockCsv = ['apiKey,ip,reason,tier,timestamp'].concat(
        blocked.map(r => `${r.apiKey},${r.ip},${r.reason},${r.tier},${r.timestamp}`)
      ).join('\n');
      return { requests: reqCsv, blocked: blockCsv };
    }

    return { requests, blocked };
  }

  destroy() {
    if (this._flushInterval) clearInterval(this._flushInterval);
    this.requestLog = [];
    this.blockedLog = [];
    this.eventLog = [];
    this.hourlyBuckets.clear();
    this.dailyBuckets.clear();
    this.tierUsage.clear();
  }
}
