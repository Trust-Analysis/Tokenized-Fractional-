import { CompressionEngine } from './compression-engine.js';
import { StrategySelector } from './strategy-selector.js';
import { ClientNegotiator } from './client-negotiator.js';
import { CompressionCache } from './cache.js';
import { CompressionStatistics } from './statistics.js';
import { StreamingCompression } from './streaming.js';
import { EdgeCaseHandler } from './edge-cases.js';
import { PreCompression } from './pre-compression.js';

// Global instances
let compressionEngine = null;
let strategySelector = null;
let clientNegotiator = null;
let compressionCache = null;
let statistics = null;
let streamingCompression = null;
let edgeCaseHandler = null;
let preCompression = null;
let middlewareOptions = null;

/**
 * Initialize compression middleware with options
 */
function initialize(options = {}) {
  middlewareOptions = {
    algorithms: ['br', 'gzip', 'deflate'],
    threshold: 1024,
    levels: {
      br: 4,
      gzip: 6,
      deflate: 6
    },
    cache: {
      enabled: false,
      maxSize: 100 * 1024 * 1024,
      maxAge: 3600
    },
    contentStrategies: {},
    statistics: true,
    skipCompressed: true,
    streaming: true,
    preCompression: {
      enabled: false,
      cacheDir: '.compression-cache'
    },
    maxMemoryUsage: 100 * 1024 * 1024,
    ...options
  };

  // Initialize components
  compressionEngine = new CompressionEngine();
  strategySelector = new StrategySelector({
    contentStrategies: middlewareOptions.contentStrategies,
    threshold: middlewareOptions.threshold,
    levels: middlewareOptions.levels
  });
  clientNegotiator = new ClientNegotiator();
  
  if (middlewareOptions.cache.enabled) {
    compressionCache = new CompressionCache(middlewareOptions.cache);
  }
  
  statistics = new CompressionStatistics();
  streamingCompression = new StreamingCompression();
  edgeCaseHandler = new EdgeCaseHandler({
    skipCompressed: middlewareOptions.skipCompressed,
    maxMemoryUsage: middlewareOptions.maxMemoryUsage
  });
  
  if (middlewareOptions.preCompression.enabled) {
    preCompression = new PreCompression(middlewareOptions.preCompression);
  }

  return middlewareOptions;
}

/**
 * Main compression middleware for Express/Node.js
 */
export function compressionMiddleware(options = {}) {
  initialize(options);

  return async (req, res, next) => {
    const startTime = Date.now();
    let originalWrite = res.write;
    let originalEnd = res.end;
    let chunks = [];
    let shouldCompress = false;
    let selectedAlgorithm = null;
    let selectedLevel = null;

    // Get client's accepted encodings
    const acceptEncoding = req.headers['accept-encoding'];
    const clientAlgorithms = clientNegotiator.getClientAlgorithms(acceptEncoding);

    // Cache client capabilities
    const clientId = req.ip + req.headers['user-agent'];
    clientNegotiator.cacheCapabilities(clientId, acceptEncoding);

    // Intercept response
    res.write = function(chunk) {
      chunks.push(chunk);
      return true;
    };

    res.end = async function(chunk) {
      if (chunk) {
        chunks.push(chunk);
      }

      // Combine chunks
      const body = Buffer.concat(chunks);
      const contentType = res.getHeader('content-type') || 'application/octet-stream';
      const contentLength = body.length;

      // Check edge cases
      const validation = edgeCaseHandler.validateContent(body, contentType, null, contentLength);
      if (!validation.valid) {
        // Send uncompressed response
        res.setHeader('Content-Length', contentLength);
        originalWrite.call(res, body);
        originalEnd.call(res);
        return;
      }

      // Select compression strategy
      const strategy = strategySelector.selectStrategy(contentType, contentLength, clientAlgorithms);

      if (strategy.shouldCompress) {
        shouldCompress = true;
        selectedAlgorithm = strategy.algorithm;
        selectedLevel = strategy.level;

        // Check cache first
        let compressedResult = null;
        let cached = false;

        if (compressionCache) {
          const cacheKey = compressionCache.generateKey(body, contentType, selectedAlgorithm, selectedLevel);
          compressedResult = compressionCache.get(cacheKey);
          if (compressedResult) {
            cached = true;
          }
        }

        // Compress if not cached
        if (!compressedResult) {
          try {
            edgeCaseHandler.allocateMemory(contentLength);
            compressedResult = await compressionEngine.compress(body, selectedAlgorithm, selectedLevel);
            edgeCaseHandler.freeMemory(contentLength);

            // Cache the result
            if (compressionCache) {
              const cacheKey = compressionCache.generateKey(body, contentType, selectedAlgorithm, selectedLevel);
              compressionCache.set(cacheKey, compressedResult, compressedResult.compressedSize);
            }
          } catch (error) {
            const errorInfo = edgeCaseHandler.handleCompressionError(error);
            console.error('Compression error:', errorInfo.message);
            
            // Fall back to uncompressed
            res.setHeader('Content-Length', contentLength);
            originalWrite.call(res, body);
            originalEnd.call(res);
            
            statistics.recordRequest(contentLength, null, null, contentType, Date.now() - startTime, false);
            statistics.recordError();
            return;
          }
        }

        // Set compression headers
        res.setHeader('Content-Encoding', selectedAlgorithm);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', compressedResult.compressedSize);

        // Send compressed response
        originalWrite.call(res, compressedResult.data);
        originalEnd.call(res);

        // Record statistics
        statistics.recordRequest(
          contentLength,
          compressedResult.compressedSize,
          selectedAlgorithm,
          contentType,
          Date.now() - startTime,
          cached
        );
      } else {
        // Send uncompressed response
        res.setHeader('Content-Length', contentLength);
        res.setHeader('Vary', 'Accept-Encoding');
        originalWrite.call(res, body);
        originalEnd.call(res);

        statistics.recordRequest(contentLength, null, null, contentType, Date.now() - startTime, false);
      }
    };

    next();
  };
}

/**
 * Streaming compression middleware
 */
export function streamingCompressionMiddleware(options = {}) {
  initialize(options);

  return (req, res, next) => {
    if (!middlewareOptions.streaming) {
      return next();
    }

    const acceptEncoding = req.headers['accept-encoding'];
    const clientAlgorithms = clientNegotiator.getClientAlgorithms(acceptEncoding);
    
    const bestAlgorithm = clientNegotiator.selectBestAlgorithm(
      acceptEncoding,
      middlewareOptions.algorithms
    );

    if (!bestAlgorithm) {
      return next();
    }

    const contentType = res.getHeader('content-type');
    const strategy = strategySelector.selectStrategy(contentType || 'text/plain', 0, clientAlgorithms);

    if (strategy.shouldCompress) {
      const level = strategy.level;
      const { stream, streamId } = streamingCompression.createStreamingHandler(bestAlgorithm, level);

      res.setHeader('Content-Encoding', bestAlgorithm);
      res.setHeader('Vary', 'Accept-Encoding');

      // Remove content-length header as it will change
      res.removeHeader('Content-Length');

      // Pipe response through compression
      const originalWrite = res.write;
      const originalEnd = res.end;

      res.write = function(chunk) {
        stream.write(chunk);
      };

      res.end = function(chunk) {
        if (chunk) {
          stream.write(chunk);
        }
        stream.end();
      };

      stream.on('data', (chunk) => {
        originalWrite.call(res, chunk);
      });

      stream.on('end', () => {
        originalEnd.call(res);
      });

      stream.on('error', (err) => {
        console.error('Streaming compression error:', err);
        statistics.recordError();
      });
    }

    next();
  };
}

/**
 * Get compression statistics
 */
export function getStatistics() {
  if (!statistics) {
    return null;
  }
  return statistics.getStats();
}

/**
 * Get statistics summary
 */
export function getStatisticsSummary() {
  if (!statistics) {
    return null;
  }
  return statistics.getSummary();
}

/**
 * Get content type statistics
 */
export function getContentTypeStats() {
  if (!statistics) {
    return null;
  }
  return statistics.getContentTypeStats();
}

/**
 * Reset statistics
 */
export function resetStatistics() {
  if (statistics) {
    statistics.reset();
  }
}

/**
 * Clear compression cache
 */
export function clearCache() {
  if (compressionCache) {
    compressionCache.clear();
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  if (!compressionCache) {
    return null;
  }
  return compressionCache.getStats();
}

/**
 * Pre-compress static files
 */
export async function preCompressFiles(files) {
  if (!preCompression) {
    preCompression = new PreCompression(middlewareOptions?.preCompression || {});
  }
  return await preCompression.preCompressFiles(files);
}

/**
 * Pre-compress a single file
 */
export async function preCompressFile(filePath, contentType) {
  if (!preCompression) {
    preCompression = new PreCompression(middlewareOptions?.preCompression || {});
  }
  return await preCompression.preCompressFile(filePath, contentType);
}

/**
 * Get pre-compression statistics
 */
export function getPreCompressionStats() {
  if (!preCompression) {
    return null;
  }
  return preCompression.getStats();
}

/**
 * Invalidate pre-compressed file
 */
export function invalidatePreCompressed(filePath) {
  if (preCompression) {
    preCompression.invalidate(filePath);
  }
}

/**
 * Get streaming statistics
 */
export function getStreamingStats() {
  if (!streamingCompression) {
    return null;
  }
  return streamingCompression.getStreamStats();
}

/**
 * Get memory usage statistics
 */
export function getMemoryStats() {
  if (!edgeCaseHandler) {
    return null;
  }
  return edgeCaseHandler.getMemoryUsage();
}

/**
 * Add custom content-type strategy
 */
export function addStrategy(contentType, strategy) {
  if (strategySelector) {
    strategySelector.setStrategy(contentType, strategy);
  }
}

/**
 * Remove content-type strategy
 */
export function removeStrategy(contentType) {
  if (strategySelector) {
    strategySelector.removeStrategy(contentType);
  }
}

/**
 * Get all strategies
 */
export function getStrategies() {
  if (strategySelector) {
    return strategySelector.getAllStrategies();
  }
  return {};
}

/**
 * Export individual components for advanced usage
 */
export { CompressionEngine } from './compression-engine.js';
export { StrategySelector } from './strategy-selector.js';
export { ClientNegotiator } from './client-negotiator.js';
export { CompressionCache } from './cache.js';
export { CompressionStatistics } from './statistics.js';
export { StreamingCompression } from './streaming.js';
export { EdgeCaseHandler } from './edge-cases.js';
export { PreCompression } from './pre-compression.js';
