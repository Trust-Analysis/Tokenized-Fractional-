/**
 * Intelligent compression strategy selector
 * Selects optimal compression algorithm and level based on content type and size
 */
export class StrategySelector {
  constructor(options = {}) {
    this.contentStrategies = options.contentStrategies || this.getDefaultStrategies();
    this.threshold = options.threshold || 1024;
    this.defaultAlgorithm = options.defaultAlgorithm || 'br';
    this.defaultLevels = options.levels || {
      br: 4,
      gzip: 6,
      deflate: 6
    };
  }

  /**
   * Get default content-type strategies
   */
  getDefaultStrategies() {
    return {
      'application/json': { algorithm: 'br', level: 4, priority: 'high' },
      'text/html': { algorithm: 'gzip', level: 6, priority: 'high' },
      'text/css': { algorithm: 'br', level: 5, priority: 'medium' },
      'application/javascript': { algorithm: 'br', level: 4, priority: 'medium' },
      'text/javascript': { algorithm: 'br', level: 4, priority: 'medium' },
      'text/plain': { algorithm: 'gzip', level: 6, priority: 'low' },
      'text/xml': { algorithm: 'gzip', level: 6, priority: 'medium' },
      'application/xml': { algorithm: 'gzip', level: 6, priority: 'medium' },
      'application/xhtml+xml': { algorithm: 'gzip', level: 6, priority: 'high' },
      'image/svg+xml': { algorithm: 'gzip', level: 6, priority: 'medium' },
      'application/atom+xml': { algorithm: 'gzip', level: 6, priority: 'medium' },
      'application/rss+xml': { algorithm: 'gzip', level: 6, priority: 'medium' },
      'text/markdown': { algorithm: 'gzip', level: 6, priority: 'low' }
    };
  }

  /**
   * Select compression strategy based on content type and size
   */
  selectStrategy(contentType, contentSize, clientAlgorithms) {
    // Check if content is too small to compress
    if (contentSize < this.threshold) {
      return {
        shouldCompress: false,
        reason: 'Content below threshold'
      };
    }

    // Get strategy for content type
    const strategy = this.getStrategyForContentType(contentType);
    
    // Select best algorithm based on client capabilities and strategy
    const algorithm = this.selectBestAlgorithm(
      strategy?.algorithm || this.defaultAlgorithm,
      clientAlgorithms
    );

    if (!algorithm) {
      return {
        shouldCompress: false,
        reason: 'No supported algorithm'
      };
    }

    const level = strategy?.level || this.defaultLevels[algorithm] || 6;

    return {
      shouldCompress: true,
      algorithm,


      level,
      priority: strategy?.priority || 'low',
      contentType
    };
  }

  /**
   * Get strategy for specific content type
   */
  getStrategyForContentType(contentType) {
    if (!contentType) return null;

    // Exact match
    if (this.contentStrategies[contentType]) {
      return this.contentStrategies[contentType];
    }

    // Wildcard match (e.g., application/*)
    const [type] = contentType.split('/');
    if (type) {
      const wildcardKey = `${type}/*`;
      if (this.contentStrategies[wildcardKey]) {
        return this.contentStrategies[wildcardKey];
      }
    }

    // Pattern match (e.g., text/*)
    for (const [key, strategy] of Object.entries(this.contentStrategies)) {
      if (key.includes('*')) {
        const regex = new RegExp(key.replace('*', '.*'));
        if (regex.test(contentType)) {
          return strategy;
        }
      }
    }

    return null;
  }

  /**
   * Select best algorithm based on client capabilities
   */
  selectBestAlgorithm(preferredAlgorithm, clientAlgorithms) {
    if (!clientAlgorithms || clientAlgorithms.length === 0) {
      return null;
    }

    // If client supports preferred algorithm, use it
    if (clientAlgorithms.includes(preferredAlgorithm)) {
      return preferredAlgorithm;
    }

    // Otherwise, use the best supported algorithm by client
    // Priority: br > gzip > deflate
    const priority = ['br', 'gzip', 'deflate'];
    
    for (const algo of priority) {
      if (clientAlgorithms.includes(algo)) {
        return algo;
      }
    }

    // Fallback to first supported algorithm
    return clientAlgorithms[0];
  }

  /**
   * Add or update a content-type strategy
   */
  setStrategy(contentType, strategy) {
    this.contentStrategies[contentType] = strategy;
  }

  /**
   * Remove a content-type strategy
   */
  removeStrategy(contentType) {
    delete this.contentStrategies[contentType];
  }

  /**
   * Get all strategies
   */
  getAllStrategies() {
    return { ...this.contentStrategies };
  }

  /**
   * Update threshold
   */
  setThreshold(threshold) {
    this.threshold = threshold;
  }

  /**
   * Check if content type should be compressed
   */
  shouldCompressContentType(contentType) {
    // Skip already compressed content types
    const compressedTypes = [
      'application/gzip',
      'application/zip',
      'application/x-gzip',
      'application/x-compress',
      'application/x-zip-compressed',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/mpeg',
      'audio/mpeg',
      'audio/mp3'
    ];

    if (compressedTypes.includes(contentType)) {
      return false;
    }

    // Check if we have a strategy for this type
    return this.getStrategyForContentType(contentType) !== null;
  }
}
