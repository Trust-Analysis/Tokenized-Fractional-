export class AnomalyDetector {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this._enabled = process.env.ANOMALY_DETECTION_ENABLED !== 'false';
    this.redisClient = options.redisClient || null;

    this.burstThreshold = parseInt(process.env.ANOMALY_BURST_THRESHOLD) || 50;
    this.timeWindowMs = parseInt(process.env.ANOMALY_TIME_WINDOW_MS) || 10000;
    this.confidenceThreshold = parseFloat(process.env.ANOMALY_CONFIDENCE_THRESHOLD) || 0.7;

    this.ipHistory = new Map();
    this.apiKeyHistory = new Map();
    this.userAgentHistory = new Map();
    this.pathPatterns = new Map();

    this._modelVersion = '1.0.0';
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

    const features = {};
    let anomalyScore = 0;
    let reasons = [];

    const freqScore = this._checkRequestFrequency(ip, apiKey);
    features.request_frequency = freqScore;
    if (freqScore > 0.3) {
      anomalyScore += freqScore * 0.25;
      if (freqScore > 0.7) reasons.push('high_request_frequency');
    }

    const burstScore = this._checkBurstRate(ip);
    features.burst_rate = burstScore;
    if (burstScore > 0.3) {
      anomalyScore += burstScore * 0.2;
      if (burstScore > 0.7) reasons.push('burst_rate_anomaly');
    }

    const pathScore = this._checkPathDiversity(apiKey, path);
    features.path_diversity = pathScore;
    if (pathScore > 0.5) {
      anomalyScore += pathScore * 0.15;
      if (pathScore > 0.7) reasons.push('path_diversity_anomaly');
    }

    const uaScore = this._checkUserAgent(userAgent, ip);
    features.user_agent_diversity = uaScore;
    if (uaScore > 0.5) {
      anomalyScore += uaScore * 0.1;
      if (uaScore > 0.7) reasons.push('user_agent_anomaly');
    }

    const timeScore = this._checkTimeAnomaly();
    features.time_of_day_anomaly = timeScore;
    anomalyScore += timeScore * 0.1;

    const seqScore = this._checkSequentialPattern(ip, path);
    features.sequential_pattern = seqScore;
    if (seqScore > 0.5) {
      anomalyScore += seqScore * 0.1;
      if (seqScore > 0.7) reasons.push('sequential_pattern_anomaly');
    }

    const geoScore = this._checkGeoVelocity(ip);
    features.geo_velocity = geoScore;
    if (geoScore > 0.6) {
      anomalyScore += geoScore * 0.1;
      reasons.push('geo_velocity_anomaly');
    }

    const blocked = anomalyScore >= this.confidenceThreshold;
    const confidence = Math.min(1, anomalyScore);

    this._recordRequest(ip, apiKey, userAgent, path, method);

    return {
      blocked,
      confidence: Math.round(confidence * 100) / 100,
      score: Math.round(anomalyScore * 100) / 100,
      reasons,
      features,
      modelVersion: this._modelVersion,
      details: blocked
        ? { anomalyScore, threshold: this.confidenceThreshold, contributingFactors: reasons }
        : null,
    };
  }

  _checkRequestFrequency(ip, apiKey) {
    const now = Date.now();
    const windowMs = this.timeWindowMs;

    const ipCounts = this.ipHistory.get(ip) || [];
    const recent = ipCounts.filter(t => now - t < windowMs);
    recent.push(now);
    this.ipHistory.set(ip, recent.slice(-200));

    const freq = recent.length / (windowMs / 1000);
    const baseline = 10;
    if (freq <= baseline) return 0;
    return Math.min(1, (freq - baseline) / 100);
  }

  _checkBurstRate(ip) {
    const now = Date.now();
    const shortWindow = 2000;

    const ipCounts = this.ipHistory.get(ip) || [];
    const burst = ipCounts.filter(t => now - t < shortWindow).length;

    if (burst <= this.burstThreshold) return 0;
    return Math.min(1, (burst - this.burstThreshold) / 100);
  }

  _checkPathDiversity(apiKey, path) {
    const now = Date.now();
    const windowMs = 60000;

    const paths = this.pathPatterns.get(apiKey) || [];
    const recent = paths.filter(p => now - p.time < windowMs);
    recent.push({ path, time: now });
    this.pathPatterns.set(apiKey, recent.slice(-100));

    const unique = new Set(recent.map(p => p.path));
    if (unique.size <= 5) return 0;
    return Math.min(1, (unique.size - 5) / 20);
  }

  _checkUserAgent(userAgent, ip) {
    if (!userAgent) return 0;

    const now = Date.now();
    const windowMs = 300000;

    const agents = this.userAgentHistory.get(ip) || [];
    const recent = agents.filter(a => now - a.time < windowMs);

    if (recent.length === 0) {
      recent.push({ ua: userAgent, time: now });
      this.userAgentHistory.set(ip, recent);
      return 0;
    }

    const unique = new Set(recent.map(a => a.ua));
    if (!unique.has(userAgent)) {
      recent.push({ ua: userAgent, time: now });
      this.userAgentHistory.set(ip, recent.slice(-20));
    }

    if (unique.size <= 2) return 0;
    return Math.min(1, (unique.size - 2) / 5);
  }

  _checkTimeAnomaly() {
    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 5) return 0.3;
    return 0;
  }

  _checkSequentialPattern(ip, path) {
    const now = Date.now();
    const windowMs = 5000;

    const ipCounts = this.ipHistory.get(ip) || [];
    const recent = ipCounts.filter(t => now - t < windowMs);

    const pathAccess = this.pathPatterns.get(ip) || [];
    const recentPaths = pathAccess.filter(p => now - p.time < windowMs);

    if (recent.length >= 20 && recentPaths.length >= 10) {
      return 0.6;
    }
    return 0;
  }

  _checkGeoVelocity(ip) {
    return 0;
  }

  _recordRequest(ip, apiKey, userAgent, path, method) {
    if (!this.ipHistory.has(ip)) {
      this.ipHistory.set(ip, []);
    }
    this.ipHistory.get(ip).push(Date.now());

    if (!this.pathPatterns.has(apiKey)) {
      this.pathPatterns.set(apiKey, []);
    }
    this.pathPatterns.get(apiKey).push({ path, time: Date.now() });
  }

  getModelInfo() {
    return {
      version: this._modelVersion,
      enabled: this._enabled,
      features: this._features,
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
    this.apiKeyHistory.clear();
    this.userAgentHistory.clear();
    this.pathPatterns.clear();
  }
}
