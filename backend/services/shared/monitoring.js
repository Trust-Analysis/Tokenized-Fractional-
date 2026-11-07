// Federated Query Monitoring
// Monitors performance and metrics for federated GraphQL queries

class FederatedMonitor {
  constructor() {
    this.metrics = {
      queries: new Map(),
      services: new Map(),
      errors: new Map()
    };
    
    this.queryHistory = [];
    this.maxHistorySize = 1000;
    
    // Performance thresholds
    this.thresholds = {
      slowQuery: 1000, // 1 second
      warningQuery: 500, // 500ms
      highErrorRate: 0.1 // 10% error rate
    };
  }

  /**
   * Record query execution
   */
  recordQuery(queryInfo) {
    const {
      operationName,
      query,
      variables,
      duration,
      services,
      errors,
      timestamp
    } = queryInfo;

    const queryKey = this.getQueryKey(query);
    
    // Update query metrics
    if (!this.metrics.queries.has(queryKey)) {
      this.metrics.queries.set(queryKey, {
        operationName: operationName || 'anonymous',
        query,
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errorCount: 0,
        lastExecuted: null,
        services: new Set()
      });
    }

    const metrics = this.metrics.queries.get(queryKey);
    metrics.count++;
    metrics.totalDuration += duration;
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
    metrics.lastExecuted = timestamp || new Date();
    
    if (errors && errors.length > 0) {
      metrics.errorCount += errors.length;
    }

    // Track services used
    if (services) {
      services.forEach(service => metrics.services.add(service));
    }

    // Add to history
    this.queryHistory.push({
      queryKey,
      operationName,
      duration,
      services,
      errors,
      timestamp: timestamp || new Date()
    });

    // Trim history if needed
    if (this.queryHistory.length > this.maxHistorySize) {
      this.queryHistory.shift();
    }

    // Update service metrics
    this.updateServiceMetrics(services, duration, errors);

    return metrics;
  }

  /**
   * Update service-level metrics
   */
  updateServiceMetrics(services, duration, errors) {
    if (!services) return;

    services.forEach(service => {
      if (!this.metrics.services.has(service)) {
        this.metrics.services.set(service, {
          requestCount: 0,
          totalDuration: 0,
          errorCount: 0,
          lastRequest: null
        });
      }

      const metrics = this.metrics.services.get(service);
      metrics.requestCount++;
      metrics.totalDuration += duration;
      metrics.lastRequest = new Date();
      
      if (errors && errors.length > 0) {
        metrics.errorCount += errors.filter(e => e.service === service).length;
      }
    });
  }

  /**
   * Record error
   */
  recordError(errorInfo) {
    const {
      code,
      service,
      operation,
      message,
      timestamp
    } = errorInfo;

    const errorKey = `${code}:${service || 'unknown'}`;
    
    if (!this.metrics.errors.has(errorKey)) {
      this.metrics.errors.set(errorKey, {
        code,
        service,
        count: 0,
        lastOccurred: null,
        operations: new Set()
      });
    }

    const metrics = this.metrics.errors.get(errorKey);
    metrics.count++;
    metrics.lastOccurred = timestamp || new Date();
    
    if (operation) {
      metrics.operations.add(operation);
    }
  }

  /**
   * Get query statistics
   */
  getQueryStats(queryKey) {
    const metrics = this.metrics.queries.get(queryKey);
    if (!metrics) return null;

    const avgDuration = metrics.count > 0 ? metrics.totalDuration / metrics.count : 0;
    const errorRate = metrics.count > 0 ? metrics.errorCount / metrics.count : 0;

    return {
      operationName: metrics.operationName,
      count: metrics.count,
      avgDuration,
      minDuration: metrics.minDuration === Infinity ? 0 : metrics.minDuration,
      maxDuration: metrics.maxDuration,
      errorRate,
      services: Array.from(metrics.services),
      lastExecuted: metrics.lastExecuted
    };
  }

  /**
   * Get service statistics
   */
  getServiceStats(serviceName) {
    const metrics = this.metrics.services.get(serviceName);
    if (!metrics) return null;

    const avgDuration = metrics.requestCount > 0 
      ? metrics.totalDuration / metrics.requestCount 
      : 0;
    const errorRate = metrics.requestCount > 0 
      ? metrics.errorCount / metrics.requestCount 
      : 0;

    return {
      requestCount: metrics.requestCount,
      avgDuration,
      errorRate,
      lastRequest: metrics.lastRequest
    };
  }

  /**
   * Get overall statistics
   */
  getOverallStats() {
    const totalQueries = Array.from(this.metrics.queries.values())
      .reduce((sum, m) => sum + m.count, 0);
    
    const totalErrors = Array.from(this.metrics.queries.values())
      .reduce((sum, m) => sum + m.errorCount, 0);
    
    const totalDuration = Array.from(this.metrics.queries.values())
      .reduce((sum, m) => sum + m.totalDuration, 0);

    const avgQueryDuration = totalQueries > 0 ? totalDuration / totalQueries : 0;
    const overallErrorRate = totalQueries > 0 ? totalErrors / totalQueries : 0;

    const serviceStats = {};
    this.metrics.services.forEach((metrics, service) => {
      serviceStats[service] = this.getServiceStats(service);
    });

    return {
      totalQueries,
      totalErrors,
      avgQueryDuration,
      overallErrorRate,
      serviceStats,
      uniqueQueries: this.metrics.queries.size,
      slowQueries: this.getSlowQueries(),
      highErrorQueries: this.getHighErrorQueries()
    };
  }

  /**
   * Get slow queries
   */
  getSlowQueries() {
    const slowQueries = [];
    
    this.metrics.queries.forEach((metrics, queryKey) => {
      const avgDuration = metrics.count > 0 
        ? metrics.totalDuration / metrics.count 
        : 0;
      
      if (avgDuration > this.thresholds.slowQuery) {
        slowQueries.push({
          queryKey,
          operationName: metrics.operationName,
          avgDuration,
          count: metrics.count
        });
      }
    });

    return slowQueries.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  /**
   * Get queries with high error rates
   */
  getHighErrorQueries() {
    const highErrorQueries = [];
    
    this.metrics.queries.forEach((metrics, queryKey) => {
      const errorRate = metrics.count > 0 
        ? metrics.errorCount / metrics.count 
        : 0;
      
      if (errorRate > this.thresholds.highErrorRate) {
        highErrorQueries.push({
          queryKey,
          operationName: metrics.operationName,
          errorRate,
          errorCount: metrics.errorCount,
          count: metrics.count
        });
      }
    });

    return highErrorQueries.sort((a, b) => b.errorRate - a.errorRate);
  }

  /**
   * Generate query key
   */
  getQueryKey(query) {
    // Normalize query by removing whitespace and comments
    return query
      .replace(/\s+/g, ' ')
      .replace(/#.*$/gm, '')
      .trim()
      .substring(0, 100);
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      queries: new Map(),
      services: new Map(),
      errors: new Map()
    };
    this.queryHistory = [];
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics() {
    return {
      timestamp: new Date().toISOString(),
      overall: this.getOverallStats(),
      queries: Object.fromEntries(
        Array.from(this.metrics.queries.entries()).map(([key, metrics]) => [
          key,
          this.getQueryStats(key)
        ])
      ),
      services: Object.fromEntries(
        Array.from(this.metrics.services.entries()).map(([key, metrics]) => [
          key,
          this.getServiceStats(key)
        ])
      ),
      errors: Object.fromEntries(
        Array.from(this.metrics.errors.entries())
      )
    };
  }

  /**
   * Create Apollo Server plugin for monitoring
   */
  createPlugin() {
    return {
      requestDidStart: () => ({
        didResolveOperation: ({ request }) => {
          return {
            operationName: request.operationName,
            query: request.query,
            variables: request.variables,
            startTime: Date.now()
          };
        },
        willSendResponse: ({ response, context }) => {
          const duration = Date.now() - context.startTime;
          
          // Extract services from response extensions if available
          const services = response.extensions?.services || [];
          const errors = response.errors || [];

          this.recordQuery({
            operationName: context.operationName,
            query: context.query,
            variables: context.variables,
            duration,
            services,
            errors
          });

          // Record errors
          errors.forEach(error => {
            this.recordError({
              code: error.extensions?.code || 'UNKNOWN',
              service: error.extensions?.service,
              operation: context.operationName,
              message: error.message
            });
          });

          // Add monitoring info to response
          response.extensions.monitoring = {
            duration,
            services,
            queryCount: this.metrics.queries.size
          };
        }
      })
    };
  }
}

// Create global monitor instance
const federatedMonitor = new FederatedMonitor();

export { FederatedMonitor, federatedMonitor };
