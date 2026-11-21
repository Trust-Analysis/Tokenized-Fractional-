import { readFileSync, existsSync, statSync } from 'fs';
import { CompressionEngine } from './compression-engine.js';

/**
 * Pre-compression for static content
 */
export class PreCompression {
  constructor(options = {}) {
    this.compressionEngine = new CompressionEngine();
    this.cacheDir = options.cacheDir || '.compression-cache';
    this.enabled = options.enabled !== false;
    this.algorithms = options.algorithms || ['br', 'gzip'];
    this.levels = options.levels || { br: 4, gzip: 6 };
    this.preCompressedFiles = new Map();
  }

  /**
   * Pre-compress a static file
   */
  async preCompressFile(filePath, contentType) {
    if (!this.enabled) {
      return null;
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = statSync(filePath);
    const content = readFileSync(filePath);

    const results = {};

    for (const algorithm of this.algorithms) {
      try {
        const level = this.levels[algorithm] || 6;
        const compressed = await this.compressionEngine.compress(content, algorithm, level);
        
        results[algorithm] = {
          data: compressed.data,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          ratio: compressed.ratio,
          level
        };
      } catch (error) {
        console.error(`Failed to pre-compress ${filePath} with ${algorithm}:`, error.message);
      }
    }

    // Cache the results
    this.preCompressedFiles.set(filePath, {
      contentType,
      results,
      timestamp: Date.now(),
      originalSize: content.length
    });

    return results;
  }

  /**
   * Pre-compress multiple files
   */
  async preCompressFiles(files) {
    const results = {};

    for (const file of files) {
      try {
        const result = await this.preCompressFile(file.path, file.contentType);
        results[file.path] = result;
      } catch (error) {
        console.error(`Failed to pre-compress ${file.path}:`, error.message);
        results[file.path] = { error: error.message };
      }
    }

    return results;
  }

  /**
   * Get pre-compressed content for a file
   */
  getPreCompressed(filePath, algorithm) {
    const cached = this.preCompressedFiles.get(filePath);
    
    if (!cached) {
      return null;
    }

    const algorithmResult = cached.results[algorithm];
    if (!algorithmResult) {
      return null;
    }

    return {
      data: algorithmResult.data,
      originalSize: algorithmResult.originalSize,
      compressedSize: algorithmResult.compressedSize,
      ratio: algorithmResult.ratio,
      contentType: cached.contentType
    };
  }

  /**
   * Check if file is pre-compressed
   */
  isPreCompressed(filePath, algorithm) {
    const cached = this.preCompressedFiles.get(filePath);
    return cached && cached.results[algorithm];
  }

  /**
   * Get best algorithm for pre-compressed file
   */
  getBestAlgorithm(filePath, clientAlgorithms) {
    const cached = this.preCompressedFiles.get(filePath);
    
    if (!cached) {
      return null;
    }

    // Find the best algorithm that the client supports
    for (const algo of this.algorithms) {
      if (clientAlgorithms.includes(algo) && cached.results[algo]) {
        return algo;
      }
    }

    return null;
  }

  /**
   * Invalidate pre-compressed file
   */
  invalidate(filePath) {
    this.preCompressedFiles.delete(filePath);
  }

  /**
   * Clear all pre-compressed files
   */
  clear() {
    this.preCompressedFiles.clear();
  }

  /**
   * Get pre-compression statistics
   */
  getStats() {
    const stats = {
      totalFiles: this.preCompressedFiles.size,
      totalOriginalSize: 0,
      totalCompressedSize: {},
      algorithmUsage: {},
      files: []
    };

    for (const [filePath, data] of this.preCompressedFiles) {
      stats.totalOriginalSize += data.originalSize;
      
      for (const [algorithm, result] of Object.entries(data.results)) {
        if (!stats.totalCompressedSize[algorithm]) {
          stats.totalCompressedSize[algorithm] = 0;
          stats.algorithmUsage[algorithm] = 0;
        }
        
        stats.totalCompressedSize[algorithm] += result.compressedSize;
        stats.algorithmUsage[algorithm]++;
      }

      stats.files.push({
        path: filePath,
        contentType: data.contentType,
        originalSize: data.originalSize,
        algorithms: Object.keys(data.results),
        timestamp: data.timestamp
      });
    }

    return stats;
  }

  /**
   * Pre-compress string content
   */
  async preCompressContent(content, contentType) {
    if (!this.enabled) {
      return null;
    }

    const buffer = Buffer.from(content);
    const results = {};

    for (const algorithm of this.algorithms) {
      try {
        const level = this.levels[algorithm] || 6;
        const compressed = await this.compressionEngine.compress(buffer, algorithm, level);
        
        results[algorithm] = {
          data: compressed.data,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          ratio: compressed.ratio,
          level
        };
      } catch (error) {
        console.error(`Failed to pre-compress content with ${algorithm}:`, error.message);
      }
    }

    return results;
  }

  /**
   * Watch for file changes and re-compress
   */
  watch(filePath, callback) {
    // This would typically use fs.watch
    // For simplicity, we'll just provide the interface
    console.log(`Watching ${filePath} for changes...`);
    
    // In a real implementation, you would:
    // 1. Use fs.watch to monitor the file
    // 2. On change, invalidate the cache
    // 3. Re-compress the file
    // 4. Call the callback with the new results
  }

  /**
   * Set cache directory
   */
  setCacheDir(dir) {
    this.cacheDir = dir;
  }

  /**
   * Enable or disable pre-compression
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Add algorithm to pre-compression
   */
  addAlgorithm(algorithm, level) {
    if (!this.algorithms.includes(algorithm)) {
      this.algorithms.push(algorithm);
    }
    this.levels[algorithm] = level;
  }

  /**
   * Remove algorithm from pre-compression
   */
  removeAlgorithm(algorithm) {
    const index = this.algorithms.indexOf(algorithm);
    if (index > -1) {
      this.algorithms.splice(index, 1);
    }
    delete this.levels[algorithm];
  }
}
