/**
 * Client capability detection and compression negotiation
 */
export class ClientNegotiator {
  constructor() {
    this.clientCapabilities = new Map();
  }

  /**
   * Parse Accept-Encoding header
   */
  parseAcceptEncoding(header) {
    if (!header) {
      return ['gzip', 'deflate']; // Default fallback
    }

    const encodings = [];
    const parts = header.split(',').map(p => p.trim());

    for (const part of parts) {
      // Handle quality values (e.g., "gzip;q=1.0")
      const [encoding, qualityPart] = part.split(';');
      const quality = qualityPart 
        ? parseFloat(qualityPart.split('=')[1]) 
        : 1.0;

      if (quality > 0) {
        encodings.push({
          encoding: encoding.toLowerCase(),
          quality
        });
      }
    }

    // Sort by quality (descending)
    encodings.sort((a, b) => b.quality - a.quality);

    return encodings.map(e => e.encoding);
  }

  /**
   * Get supported compression algorithms from client
   */
  getClientAlgorithms(acceptEncoding) {
    const parsed = this.parseAcceptEncoding(acceptEncoding);
    
    // Filter to supported algorithms
    const supported = ['br', 'gzip', 'deflate', 'identity', '*'];
    
    return parsed.filter(algo => {
      if (algo === '*') return true;
      return supported.includes(algo);
    });
  }

  /**
   * Select best algorithm for client
   */
  selectBestAlgorithm(acceptEncoding, availableAlgorithms) {
    const clientAlgos = this.getClientAlgorithms(acceptEncoding);
    
    // If client accepts *, use first available
    if (clientAlgos.includes('*')) {
      return availableAlgorithms[0];
    }

    // Find first matching algorithm
    for (const clientAlgo of clientAlgos) {
      if (availableAlgorithms.includes(clientAlgo)) {
        return clientAlgo;
      }
    }

    return null;
  }

  /**
   * Cache client capabilities
   */
  cacheCapabilities(clientId, acceptEncoding) {
    const algorithms = this.getClientAlgorithms(acceptEncoding);
    this.clientCapabilities.set(clientId, {
      algorithms,
      timestamp: Date.now()
    });
  }

  /**
   * Get cached capabilities
   */
  getCachedCapabilities(clientId) {
    const cached = this.clientCapabilities.get(clientId);
    
    if (!cached) {
      return null;
    }

    // Cache expires after 1 hour
    if (Date.now() - cached.timestamp > 3600000) {
      this.clientCapabilities.delete(clientId);
      return null;
    }

    return cached.algorithms;
  }

  /**
   * Generate Vary header value
   */
  generateVaryHeader() {
    return 'Accept-Encoding';
  }

  /**
   * Generate Content-Encoding header
   */
  generateContentEncoding(algorithm) {
    return algorithm;
  }

  /**
   * Clear capability cache
   */
  clearCache() {
    this.clientCapabilities.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.clientCapabilities.size,
      entries: Array.from(this.clientCapabilities.entries()).map(([id, data]) => ({
        id,
        algorithms: data.algorithms,
        age: Date.now() - data.timestamp
      }))
    };
  }
}
