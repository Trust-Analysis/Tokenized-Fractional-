/**
 * Gateway Monitoring and Observability Integration
 * Supports CloudWatch, Prometheus, ELK Stack, and DataDog
 */

import * as CloudWatch from 'aws-sdk/clients/cloudwatch';
import pino from 'pino';

/**
 * Metrics collector for gateway operations
 */
export class MetricsCollector {
  constructor(options = {}) {
    this.namespace = options.namespace || 'RWA-Gateway';
    this.region = options.region || 'us-east-1';
    this.environment = options.environment || 'production';
    this.cloudwatch = options.cloudwatch || new CloudWatch({ region: this.region });
    this.metrics = [];
  }

  /**
   * Record metric
   */
  recordMetric(metricName, value, unit = 'Count', dimensions = {}) {
    const metric = {
      MetricName: metricName,
      Value: value,
      Unit: unit,
      Timestamp: new Date(),
      Namespace: this.namespace,
      Dimensions: [
        { Name: 'Environment', Value: this.environment },
        ...Object.entries(dimensions).map(([name, value]) => ({ Name: name, Value: value })),
      ],
    };

    this.metrics.push(metric);

    if (this.metrics.length >= 20) {
      this.flush();
    }
  }

  /**
   * Flush metrics to CloudWatch
   */
  async flush() {
    if (this.metrics.length === 0) return;

    try {
      // CloudWatch accepts max 20 metrics per request
      const batches = [];
      for (let i = 0; i < this.metrics.length; i += 20) {
        batches.push(this.metrics.slice(i, i + 20));
      }

      for (const batch of batches) {
        await this.cloudwatch.putMetricData({
          Namespace: this.namespace,
          MetricData: batch,
        }).promise();
      }

      this.metrics = [];
    } catch (error) {
      console.error('Failed to send metrics to CloudWatch:', error);
    }
  }

  /**
   * Record API request
   */
  recordApiRequest(endpoint, statusCode, duration, size) {
    this.recordMetric('ApiRequests', 1, 'Count', {
      Endpoint: endpoint,
      Status: statusCode >= 400 ? 'Error' : 'Success',
    });

    this.recordMetric('ResponseTime', duration, 'Milliseconds', { Endpoint: endpoint });
    this.recordMetric('ResponseSize', size, 'Bytes', { Endpoint: endpoint });
  }

  /**
   * Record rate limit event
   */
  recordRateLimit(userId, endpoint) {
    this.recordMetric('RateLimitExceeded', 1, 'Count', {
      UserId: userId,
      Endpoint: endpoint,
    });
  }

  /**
   * Record error
   */
  recordError(endpoint, errorType) {
    this.recordMetric('Errors', 1, 'Count', {
      Endpoint: endpoint,
      ErrorType: errorType,
    });
  }
}

/**
 * Prometheus metrics exporter
 */
export class PrometheusExporter {
  constructor() {
    this.metrics = new Map();
    this.histograms = new Map();
    this.counters = new Map();
  }

  /**
   * Increment counter
   */
  incrementCounter(name, value = 1, labels = {}) {
    const key = this.labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  /**
   * Record histogram
   */
  recordHistogram(name, value, labels = {}) {
    const key = this.labelKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
  }

  /**
   * Generate Prometheus exposition format
   */
  generate() {
    let output = '';

    // Export counters
    for (const [key, value] of this.counters) {
      output += `${key} ${value}\n`;
    }

    // Export histogram metrics
    for (const [key, values] of this.histograms) {
      const sorted = values.sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;

      output += `${key}_total ${sum}\n`;
      output += `${key}_count ${count}\n`;
      output += `${key}_sum ${sum}\n`;
      output += `${key}_bucket{le="0.1"} ${sorted.filter(v => v <= 0.1).length}\n`;
      output += `${key}_bucket{le="1"} ${sorted.filter(v => v <= 1).length}\n`;
      output += `${key}_bucket{le="10"} ${sorted.filter(v => v <= 10).length}\n`;
      output += `${key}_bucket{le="+Inf"} ${count}\n`;
    }

    return output;
  }

  labelKey(name, labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

/**
 * Distributed tracing with correlation IDs
 */
export class TraceCollector {
  constructor() {
    this.traces = new Map();
  }

  /**
   * Start trace
   */
  startTrace(traceId, spanId) {
    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        startTime: Date.now(),
        spans: [],
      });
    }
    return { traceId, spanId };
  }

  /**
   * End trace
   */
  endTrace(traceId) {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;
    }
    return trace;
  }

  /**
   * Add span
   */
  addSpan(traceId, spanId, operationName, duration, status = 'ok') {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.push({
        spanId,
        operationName,
        duration,
        status,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Monitoring middleware
 */
export function createMonitoringMiddleware(metricsCollector, prometheusExporter, logger) {
  return (req, res, next) => {
    const startTime = Date.now();
    const startSize = req.socket.bytesRead;

    // Track response
    const originalSend = res.send.bind(res);
    res.send = function(data) {
      const duration = Date.now() - startTime;
      const endpoint = `${req.method}:${req.path}`;
      const size = typeof data === 'string' ? Buffer.byteLength(data) : 0;

      // Record metrics
      metricsCollector.recordApiRequest(endpoint, res.statusCode, duration, size);
      prometheusExporter.recordHistogram('api_request_duration_ms', duration, {
        method: req.method,
        endpoint,
        status: res.statusCode,
      });

      // Log
      logger.info({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
      });

      return originalSend(data);
    };

    next();
  };
}

/**
 * Error tracking middleware
 */
export function createErrorTrackingMiddleware(metricsCollector, logger) {
  return (err, req, res, next) => {
    const endpoint = `${req.method}:${req.path}`;

    // Record error
    metricsCollector.recordError(endpoint, err.name || 'UnknownError');

    // Log error
    logger.error({
      error: err.message,
      stack: err.stack,
      endpoint,
      requestId: req.requestId,
    });

    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
      requestId: req.requestId,
    });
  };
}

/**
 * Health check endpoint
 */
export function createHealthCheck(dependencies = {}) {
  return async (req, res) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {},
    };

    // Check dependencies
    for (const [name, check] of Object.entries(dependencies)) {
      try {
        const result = await check();
        health.checks[name] = { status: 'ok', ...result };
      } catch (error) {
        health.checks[name] = { status: 'error', error: error.message };
        health.status = 'unhealthy';
      }
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  };
}

/**
 * Request logging middleware
 */
export function createRequestLogger(logger) {
  return (req, res, next) => {
    const startTime = Date.now();

    // Log incoming request
    logger.info({
      event: 'request_received',
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.requestId,
    });

    // Log response
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.info({
        event: 'request_completed',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
      });
    });

    next();
  };
}

/**
 * Alert manager for critical events
 */
export class AlertManager {
  constructor(options = {}) {
    this.alertThresholds = options.alertThresholds || {
      errorRate: 0.05, // 5%
      p99Latency: 5000, // 5 seconds
      rateLimitExceeded: 100, // per minute
    };
    this.onAlert = options.onAlert || console.error;
  }

  /**
   * Check and alert on metrics
   */
  checkMetrics(metrics) {
    if (metrics.errorRate > this.alertThresholds.errorRate) {
      this.onAlert({
        type: 'HIGH_ERROR_RATE',
        message: `Error rate exceeded threshold: ${(metrics.errorRate * 100).toFixed(2)}%`,
        severity: 'high',
        value: metrics.errorRate,
      });
    }

    if (metrics.p99Latency > this.alertThresholds.p99Latency) {
      this.onAlert({
        type: 'HIGH_LATENCY',
        message: `P99 latency exceeded threshold: ${metrics.p99Latency}ms`,
        severity: 'medium',
        value: metrics.p99Latency,
      });
    }

    if (metrics.rateLimitExceeded > this.alertThresholds.rateLimitExceeded) {
      this.onAlert({
        type: 'EXCESSIVE_RATE_LIMITING',
        message: `Rate limit exceeded events: ${metrics.rateLimitExceeded}/min`,
        severity: 'medium',
        value: metrics.rateLimitExceeded,
      });
    }
  }
}
