/**
 * Edge case handling for compression
 */
export class EdgeCaseHandler {
  constructor(options = {}) {
    this.skipCompressed = options.skipCompressed !== false;
    this.maxMemoryUsage = options.maxMemoryUsage || 100 * 1024 * 1024; // 100MB
    this.currentMemoryUsage = 0;
    this.compressedContentTypes = options.compressedContentTypes || this.getDefaultCompressedTypes();
  }

  /**
   * Get default compressed content types
   */
  getDefaultCompressedTypes() {
    return [
      'application/gzip',
      'application/zip',
      'application/x-gzip',
      'application/x-compress',
      'application/x-zip-compressed',
      'application/x-7z-compressed',
      'application/x-rar-compressed',
      'application/x-tar',
      'application/x-bzip2',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/aac',
      'audio/flac'
    ];
  }

  /**
   * Check if content is already compressed
   */
  isAlreadyCompressed(contentType, contentEncoding) {
    // Check content type
    if (this.compressedContentTypes.includes(contentType)) {
      return true;
    }

    // Check content encoding header
    if (contentEncoding) {
      const encodings = contentEncoding.split(',').map(e => e.trim().toLowerCase());
      const compressedEncodings = ['gzip', 'deflate', 'br', 'compress', 'identity'];
      
      for (const encoding of encodings) {
        if (compressedEncodings.includes(encoding)) {
          return true;
        }
      }
    }

    // Check file extension
    const compressedExtensions = ['.gz', '.zip', '.rar', '.7z', '.tar', '.bz2', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mp3', '.wav'];
    for (const ext of compressedExtensions) {
      if (contentType?.includes(ext)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if content should be skipped based on size
   */
  shouldSkipBySize(contentSize, threshold) {
    return contentSize < threshold;
  }

  /**
   * Check memory usage before compression
   */
  checkMemoryUsage(requiredMemory) {
    if (this.currentMemoryUsage + requiredMemory > this.maxMemoryUsage) {
      throw new Error('Memory limit exceeded for compression');
    }
    return true;
  }

  /**
   * Allocate memory for compression
   */
  allocateMemory(size) {
    this.checkMemoryUsage(size);
    this.currentMemoryUsage += size;
  }

  /**
   * Free memory after compression
   */
  freeMemory(size) {
    this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - size);
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    return {
      current: this.currentMemoryUsage,
      max: this.maxMemoryUsage,
      utilization: this.currentMemoryUsage / this.maxMemoryUsage
    };
  }

  /**
   * Reset memory tracking
   */
  resetMemoryUsage() {
    this.currentMemoryUsage = 0;
  }

  /**
   * Validate content for compression
   */
  validateContent(content, contentType, contentEncoding, size) {
    const issues = [];

    // Check if already compressed
    if (this.skipCompressed && this.isAlreadyCompressed(contentType, contentEncoding)) {
      issues.push({
        type: 'already_compressed',
        message: 'Content is already compressed',
        severity: 'warning'
      });
    }

    // Check if content is empty
    if (!content || content.length === 0) {
      issues.push({
        type: 'empty_content',
        message: 'Content is empty',
        severity: 'error'
      });
    }

    // Check if content is too large
    if (size > this.maxMemoryUsage) {
      issues.push({
        type: 'size_exceeded',
        message: `Content size (${size}) exceeds memory limit (${this.maxMemoryUsage})`,
        severity: 'error'
      });
    }

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues
    };
  }

  /**
   * Handle compression error gracefully
   */
  handleCompressionError(error, context = {}) {
    const errorTypes = {
      'Memory limit exceeded': {
        type: 'memory_error',
        recoverable: false,
        message: 'Compression failed due to memory limit'
      },
      'Unsupported compression algorithm': {
        type: 'algorithm_error',
        recoverable: true,
        message: 'Compression algorithm not supported, trying fallback'
      },
      'Compression failed': {
        type: 'compression_error',
        recoverable: true,
        message: 'Compression failed, returning uncompressed content'
      }
    };

    const errorInfo = errorTypes[error.message] || {
      type: 'unknown_error',
      recoverable: false,
      message: error.message
    };

    return {
      ...errorInfo,
      originalError: error,
      context
    };
  }

  /**
   * Add custom compressed content type
   */
  addCompressedContentType(contentType) {
    if (!this.compressedContentTypes.includes(contentType)) {
      this.compressedContentTypes.push(contentType);
    }
  }

  /**
   * Remove compressed content type
   */
  removeCompressedContentType(contentType) {
    const index = this.compressedContentTypes.indexOf(contentType);
    if (index > -1) {
      this.compressedContentTypes.splice(index, 1);
    }
  }

  /**
   * Set memory limit
   */
  setMemoryLimit(limit) {
    this.maxMemoryUsage = limit;
  }

  /**
   * Get compressed content types
   */
  getCompressedContentTypes() {
    return [...this.compressedContentTypes];
  }

  /**
   * Check if response is streaming
   */
  isStreamingResponse(response) {
    return response && typeof response.pipe === 'function';
  }

  /**
   * Check if response has already been compressed
   */
  isResponseCompressed(headers) {
    const contentEncoding = headers.get('content-encoding') || headers['content-encoding'];
    return contentEncoding && contentEncoding !== 'identity';
  }

  /**
   * Sanitize headers for compressed response
   */
  sanitizeHeaders(headers, algorithm) {
    const sanitized = { ...headers };

    // Remove content-length as it will change after compression
    delete sanitized['content-length'];
    delete sanitized['Content-Length'];

    // Set content-encoding
    sanitized['content-encoding'] = algorithm;

    // Ensure vary header includes accept-encoding
    const vary = sanitized['vary'] || sanitized['Vary'] || '';
    if (!vary.includes('accept-encoding')) {
      sanitized['vary'] = vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding';
    }

    return sanitized;
  }
}
