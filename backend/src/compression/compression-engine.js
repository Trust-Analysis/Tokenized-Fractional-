import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);
const brotliCompress = promisify(zlib.brotliCompress);

/**
 * Compression engine supporting multiple algorithms
 */
export class CompressionEngine {
  constructor() {
    this.algorithms = {
      gzip: {
        compress: async (data, level) => gzip(data, { level }),
        decompress: async (data) => promisify(zlib.gunzip)(data),
        encoding: 'gzip'
      },
      deflate: {
        compress: async (data, level) => deflate(data, { level }),
        decompress: async (data) => promisify(zlib.inflate)(data),
        encoding: 'deflate'
      },
      br: {
        compress: async (data, level) => brotliCompress(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: level
          }
        }),
        decompress: async (data) => promisify(zlib.brotliDecompress)(data),
        encoding: 'br'
      }
    };
  }

  /**
   * Compress data using specified algorithm
   */
  async compress(data, algorithm = 'gzip', level = 6) {
    if (!this.algorithms[algorithm]) {
      throw new Error(`Unsupported compression algorithm: ${algorithm}`);
    }

    try {
      const compressed = await this.algorithms[algorithm].compress(data, level);
      return {
        data: compressed,
        algorithm,
        originalSize: data.length,
        compressedSize: compressed.length,
        ratio: compressed.length / data.length
      };
    } catch (error) {
      throw new Error(`Compression failed: ${error.message}`);
    }
  }

  /**
   * Decompress data using specified algorithm
   */
  async decompress(data, algorithm) {
    if (!this.algorithms[algorithm]) {
      throw new Error(`Unsupported compression algorithm: ${algorithm}`);
    }

    try {
      const decompressed = await this.algorithms[algorithm].decompress(data);
      return decompressed;
    } catch (error) {
      throw new Error(`Decompression failed: ${error.message}`);
    }
  }

  /**
   * Get supported algorithms
   */
  getSupportedAlgorithms() {
    return Object.keys(this.algorithms);
  }

  /**
   * Get encoding name for HTTP headers
   */
  getEncodingName(algorithm) {
    return this.algorithms[algorithm]?.encoding || algorithm;
  }

  /**
   * Check if algorithm is supported
   */
  isSupported(algorithm) {
    return algorithm in this.algorithms;
  }

  /**
   * Get default compression level for algorithm
   */
  getDefaultLevel(algorithm) {
    const defaults = {
      gzip: 6,
      deflate: 6,
      br: 4
    };
    return defaults[algorithm] || 6;
  }

  /**
   * Validate compression level
   */
  validateLevel(algorithm, level) {
    const ranges = {
      gzip: { min: 0, max: 9 },
      deflate: { min: 0, max: 9 },
      br: { min: 0, max: 11 }
    };

    const range = ranges[algorithm];
    if (!range) return true;

    return level >= range.min && level <= range.max;
  }
}
