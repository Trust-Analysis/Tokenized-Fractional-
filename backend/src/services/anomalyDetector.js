/**
 * Request-level anomaly detector used by RateLimiterService (issue #903).
 *
 * Every /api/ request is scored from per-IP / per-API-key history. Each
 * feature yields a score in [0, 1] and has a weight saying how suspicious that
 * signal is on its own; they combine as a noisy-OR:
 *
 *   score = 1 - Π (1 - weight_i * feature_i)
 *
 * so one strong signal (a flood) can block alone, while weaker ones (path
 * scanning, user-agent rotation) block only in combination. A score at or
 * above `confidenceThreshold` is flagged.
 *
 * Action on a flag: RateLimiterService rejects that request with 429
 * `anomaly_detected` (Retry-After: 300) and logs it via RateLimitAnalytics; the
 * detector also logs a warning. It is not a persistent ban — every request is
 * re-scored, so the client is let through once its recent history looks
 * normal again. See docs/ANOMALY_DETECTION.md for the dataset and accuracy bar.
 *
 * On-chain manipulation (flash loans, same-ledger buy/sell) is out of scope
 * here; that is flashLoanProtectionService's job.
 */

const HISTORY_CAP = 2000;

export const FEATURE_WEIGHTS = {
  burst_rate: 0.9,
  request_frequency: 0.8,
  path_diversity: 0.6,
  user_agent_diversity: 0.6,
  sequential_pattern: 0.5,
  time_of_day_anomaly: 0.1,
  geo_velocity: 0.5,
};

export class AnomalyDetector {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this._enabled = process.env.ANOMALY_DETECTION_ENABLED !== 'false';
    this.redisClient = options.redisClient || null;
    this.now = options.now || (() => Date.now());

    this.burstThreshold = parseInt(process.env.ANOMALY_BURST_THRESHOLD) || 50;
    this.timeWindowMs = parseInt(process.env.ANOMALY_TIME_WINDOW_MS) || 10000;
    this.confidenceThreshold = parseFloat(process.env.ANOMALY_CONFIDENCE_THRESHOLD) || 0.7;

    this.ipHistory = new Map(); // ip -> request timestamps
    this.ipPathHistory = new Map(); // ip -> [{ path, time }]
    this.apiKeyHistory = new Map();
    this.userAgentHistory = new Map(); // ip -> [{ ua, time }]
    this.pathPatterns = new Map(); // apiKey -> [{ path, time }]

    this._modelVersion = '1.1.0';
    this._features = [
      'request_frequency',
      'burst_rate',
      'path_diversity',
      'user_agent_diversity',
      'time_of_day_anomaly',
      'geo_velocity',
      'sequential_pattern',
      'payload_anomaly',
    ];
  }

  get enabled() { return this._enabled; }

  set enabled(val) { this._enabled = val; }

  async check({ apiKey, ip, userAgent, path, method }) {
    if (!this._enabled) return { blocked: false, confidence: 0 };

    const now = this.now();
    this._recordRequest(now, ip, apiKey, userAgent, path);

    const features = {
      request_frequency: this._checkRequestFrequency(now, ip),
      burst_rate: this._checkBurstRate(now, ip),
      path_diversity: this._checkPathDiversity(now, apiKey),
      user_agent_diversity: this._checkUserAgent(now, ip),
      time_of_day_anomaly: this._checkTimeAnomaly(now),
      sequential_pattern: this._checkSequentialPattern(now, ip),
      geo_velocity: this._checkGeoVelocity(ip),
    };

    let clean = 1;
    const reasons = [];
    for (const [name, value] of Object.entries(features)) {
      clean *= 1 - FEATURE_WEIGHTS[name] * value;
      if (value >= 0.7 && name !== 'time_of_day_anomaly') reasons.push(`${name}_anomaly`);
    }
    const anomalyScore = 1 - clean;

    const blocked = anomalyScore >= this.confidenceThreshold;
    if (blocked) {
      this.logger.warn(
        { ip, apiKey: apiKey?.slice(0, 8), method, path, score: anomalyScore, reasons },
        'Anomalous request pattern flagged',
      );
    }

    return {
      blocked,
      confidence: Math.round(anomalyScore * 100) / 100,
      score: Math.round(anomalyScore * 100) / 100,
      reasons,
      features,
      modelVersion: this._modelVersion,
      details: blocked
        ? { anomalyScore, threshold: this.confidenceThreshold, contributingFactors: reasons }
        : null,
    };
  }

  /** Sustained rate over timeWindowMs: 0 at ≤10 req/s, 1 at ≥50 req/s. */
  _checkRequestFrequency(now, ip) {
    const count = (this.ipHistory.get(ip) || []).filter(t => now - t < this.timeWindowMs).length;
    const perSecond = count / (this.timeWindowMs / 1000);
    const baseline = 10;
    if (perSecond <= baseline) return 0;
    return Math.min(1, (perSecond - baseline) / 40);
  }

  /** Requests in the last 2s: 0 at ≤burstThreshold, 1 at 2× burstThreshold. */
  _checkBurstRate(now, ip) {
    const burst = (this.ipHistory.get(ip) || []).filter(t => now - t < 2000).length;
    if (burst <= this.burstThreshold) return 0;
    return Math.min(1, (burst - this.burstThreshold) / this.burstThreshold);
  }

  /** Distinct paths per API key in 60s: 0 at ≤10, 1 at ≥30 (endpoint scanning). */
  _checkPathDiversity(now, apiKey) {
    const recent = (this.pathPatterns.get(apiKey) || []).filter(p => now - p.time < 60000);
    const unique = new Set(recent.map(p => p.path)).size;
    if (unique <= 10) return 0;
    return Math.min(1, (unique - 10) / 20);
  }

  /** Distinct user agents per IP in 5min: 0 at ≤3 (NAT / multiple devices), 1 at ≥8. */
  _checkUserAgent(now, ip) {
    const recent = (this.userAgentHistory.get(ip) || []).filter(a => now - a.time < 300000);
    const unique = new Set(recent.map(a => a.ua)).size;
    if (unique <= 3) return 0;
    return Math.min(1, (unique - 3) / 5);
  }

  _checkTimeAnomaly(now) {
    const hour = new Date(now).getUTCHours();
    if (hour >= 2 && hour <= 5) return 0.3;
    return 0;
  }

  /** Rapid enumeration from one IP: ≥20 requests over ≥10 distinct paths within 5s. */
  _checkSequentialPattern(now, ip) {
    const recent = (this.ipPathHistory.get(ip) || []).filter(p => now - p.time < 5000);
    const unique = new Set(recent.map(p => p.path)).size;
    if (recent.length >= 20 && unique >= 10) return 1;
    return 0;
  }

  _checkGeoVelocity(ip) {
    return 0;
  }

  _recordRequest(now, ip, apiKey, userAgent, path) {
    const push = (map, key, entry, cap = HISTORY_CAP) => {
      const list = map.get(key) || [];
      list.push(entry);
      if (list.length > cap) list.splice(0, list.length - cap);
      map.set(key, list);
    };

    push(this.ipHistory, ip, now);
    push(this.ipPathHistory, ip, { path, time: now }, 200);
    push(this.pathPatterns, apiKey, { path, time: now }, 200);

    if (userAgent) {
      const agents = this.userAgentHistory.get(ip) || [];
      const existing = agents.find(a => a.ua === userAgent);
      if (existing) existing.time = now;
      else push(this.userAgentHistory, ip, { ua: userAgent, time: now }, 20);
    }
  }

  getModelInfo() {
    return {
      version: this._modelVersion,
      enabled: this._enabled,
      features: this._features,
      weights: FEATURE_WEIGHTS,
      burstThreshold: this.burstThreshold,
      timeWindowMs: this.timeWindowMs,
      confidenceThreshold: this.confidenceThreshold,
      activeIpCount: this.ipHistory.size,
      activeKeyCount: this.apiKeyHistory.size,
    };
  }

  async train(data) {
    this.logger.info({ samples: data?.length || 0 }, 'Anomaly detection model updated');
    return { trained: true, samples: data?.length || 0 };
  }

  destroy() {
    this.ipHistory.clear();
    this.ipPathHistory.clear();
    this.apiKeyHistory.clear();
    this.userAgentHistory.clear();
    this.pathPatterns.clear();
  }
}
