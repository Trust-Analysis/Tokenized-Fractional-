/**
 * Compression cache for frequently accessed responses
 */
export class CompressionCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 100 * 1024 * 1024; // 100MB default
    this.maxAge = options.maxAge || 3600; // 1 hour default
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate cache key
   */
  generateKey(content, contentType, algorithm, level) {
    // Simple hash based on content and parameters
    const str = `${contentType}-${algorithm}-${level}-${content.length}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get cached compression
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.maxAge * 1000) {
      this.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Set cached compression
   */
  set(key, data, size) {
    // Check if adding would exceed max size
    if (this.currentSize + size > this.maxSize) {
      this.evict(size);
    }

    this.cache.set(key, {
      data,
      size,
      timestamp: Date.now()
    });

    this.currentSize += size;
  }

  /**
   * Delete cache entry
   */
  delete(key) {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(key);
    }
  }

  /**
   * Evict entries to make room
   */
  evict(requiredSpace) {
    const entries = Array.from(this.cache.entries());
    
    // Sort by access time (LRU)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    let freedSpace = 0;
    for (const [key, entry] of entries) {
      this.delete(key);
      freedSpace += entry.size;
      
      if (freedSpace >= requiredSpace) {
        break;
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.hits + this.misses > 0 
      ? this.hits / (this.hits + this.misses) 
      : 0;

    return {
      size: this.cache.size,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate.toFixed(4),
      utilization: (this.currentSize / this.maxSize).toFixed(4)
    };
  }

  /**
   * Pre-compress static content
   */
  async preCompress(content, contentType, algorithm, level, compressFn) {
    const key = this.generateKey(content, contentType, algorithm, level);
    
    // Check if already cached
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    // Compress and cache
    const compressed = await compressFn(content, algorithm, level);
    this.set(key, compressed, compressed.compressedSize);

    return compressed;
  }

  /**
   * Invalidate cache entries by content type
   */
  invalidateByContentType(contentType) {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.data.contentType === contentType) {
        this.delete(key);
      }
    }
  }

  /**
   * Get cache keys
   */
  getKeys() {
    return Array.from(this.cache.keys());
  }
}
