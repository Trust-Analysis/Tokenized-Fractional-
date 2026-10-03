/**
 * Compression statistics monitoring and reporting
 */
export class CompressionStatistics {
  constructor() {
    this.reset();
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.stats = {
      totalRequests: 0,
      compressedRequests: 0,
      skippedRequests: 0,
      totalBytes: 0,
      compressedBytes: 0,
      skippedBytes: 0,
      algorithmUsage: {
        br: 0,
        gzip: 0,
        deflate: 0
      },
      contentTypeStats: {},
      compressionTime: [],
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Record a compression request
   */
  recordRequest(size, compressed, algorithm, contentType, duration, cached = false) {
    this.stats.totalRequests++;
    this.stats.totalBytes += size;

    if (compressed) {
      this.stats.compressedRequests++;
      this.stats.compressedBytes += compressed;
      this.stats.algorithmUsage[algorithm]++;
      
      if (contentType) {
        if (!this.stats.contentTypeStats[contentType]) {
          this.stats.contentTypeStats[contentType] = {
            count: 0,
            totalBytes: 0,
            compressedBytes: 0
          };
        }
        this.stats.contentTypeStats[contentType].count++;
        this.stats.contentTypeStats[contentType].totalBytes += size;
        this.stats.contentTypeStats[contentType].compressedBytes += compressed;
      }
    } else {
      this.stats.skippedRequests++;
      this.stats.skippedBytes += size;
    }

    if (duration) {
      this.stats.compressionTime.push(duration);
      // Keep only last 1000 measurements
      if (this.stats.compressionTime.length > 1000) {
        this.stats.compressionTime.shift();
      }
    }

    if (cached) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
  }

  /**
   * Record an error
   */
  recordError() {
    this.stats.errors++;
  }

  /**
   * Get overall compression ratio
   */
  getCompressionRatio() {
    if (this.stats.totalBytes === 0) return 0;
    return this.stats.compressedBytes / this.stats.totalBytes;
  }

  /**
   * Get compression percentage
   */
  getCompressionPercentage() {
    const ratio = this.getCompressionRatio();
    return ((1 - ratio) * 100).toFixed(2);
  }

  /**
   * Get average compression time
   */
  getAverageCompressionTime() {
    if (this.stats.compressionTime.length === 0) return 0;
    const sum = this.stats.compressionTime.reduce((a, b) => a + b, 0);
    return sum / this.stats.compressionTime.length;
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate() {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    if (total === 0) return 0;
    return this.stats.cacheHits / total;
  }

  /**
   * Get all statistics
   */
  getStats() {
    return {
      ...this.stats,
      compressionRatio: this.getCompressionRatio(),
      compressionPercentage: this.getCompressionPercentage(),
      averageCompressionTime: this.getAverageCompressionTime(),
      cacheHitRate: this.getCacheHitRate(),
      bytesSaved: this.stats.totalBytes - this.stats.compressedBytes - this.stats.skippedBytes
    };
  }

  /**
   * Get statistics summary
   */
  getSummary() {
    const stats = this.getStats();
    
    return {
      totalRequests: stats.totalRequests,
      compressedRequests: stats.compressedRequests,
      compressionRate: ((stats.compressedRequests / stats.totalRequests) * 100).toFixed(2) + '%',
      totalBytes: this.formatBytes(stats.totalBytes),
      compressedBytes: this.formatBytes(stats.compressedBytes),
      bytesSaved: this.formatBytes(stats.bytesSaved),
      compressionRatio: stats.compressionPercentage + '%',
      algorithmUsage: stats.algorithmUsage,
      averageCompressionTime: stats.averageCompressionTime.toFixed(2) + 'ms',
      cacheHitRate: (stats.cacheHitRate * 100).toFixed(2) + '%',
      errors: stats.errors
    };
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get content type statistics
   */
  getContentTypeStats() {
    const result = {};
    
    for (const [contentType, stats] of Object.entries(this.stats.contentTypeStats)) {
      result[contentType] = {
        count: stats.count,
        totalBytes: this.formatBytes(stats.totalBytes),
        compressedBytes: this.formatBytes(stats.compressedBytes),
        compressionRatio: ((1 - stats.compressedBytes / stats.totalBytes) * 100).toFixed(2) + '%'
      };
    }
    
    return result;
  }

  /**
   * Export statistics as JSON
   */
  exportJSON() {
    return JSON.stringify(this.getStats(), null, 2);
  }

  /**
   * Export statistics as CSV
   */
  exportCSV() {
    const stats = this.getStats();
    const lines = [
      'Metric,Value',
      `Total Requests,${stats.totalRequests}`,
      `Compressed Requests,${stats.compressedRequests}`,
      `Skipped Requests,${stats.skippedRequests}`,
      `Total Bytes,${stats.totalBytes}`,
      `Compressed Bytes,${stats.compressedBytes}`,
      `Compression Ratio,${stats.compressionRatio}`,
      `Average Compression Time,${stats.averageCompressionTime}`,
      `Cache Hit Rate,${stats.cacheHitRate}`,
      `Errors,${stats.errors}`
    ];
    
    return lines.join('\n');
  }
}
