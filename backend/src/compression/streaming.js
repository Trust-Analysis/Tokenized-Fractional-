import zlib from 'zlib';
import { Transform } from 'stream';

/**
 * Streaming compression support
 */
export class StreamingCompression {
  constructor() {
    this.activeStreams = new Map();
  }

  /**
   * Create a compression transform stream
   */
  createCompressionStream(algorithm, level = 6) {
    let stream;

    switch (algorithm) {
      case 'gzip':
        stream = zlib.createGzip({ level });
        break;
      case 'deflate':
        stream = zlib.createDeflate({ level });
        break;
      case 'br':
        stream = zlib.createBrotliCompress({
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: level
          }
        });
        break;
      default:
        throw new Error(`Unsupported streaming algorithm: ${algorithm}`);
    }

    return stream;
  }

  /**
   * Create a decompression transform stream
   */
  createDecompressionStream(algorithm) {
    let stream;

    switch (algorithm) {
      case 'gzip':
        stream = zlib.createGunzip();
        break;
      case 'deflate':
        stream = zlib.createInflate();
        break;
      case 'br':
        stream = zlib.createBrotliDecompress();
        break;
      default:
        throw new Error(`Unsupported streaming algorithm: ${algorithm}`);
    }

    return stream;
  }

  /**
   * Compress a stream with progress tracking
   */
  compressStream(sourceStream, algorithm, level, onProgress) {
    return new Promise((resolve, reject) => {
      const compressionStream = this.createCompressionStream(algorithm, level);
      const chunks = [];
      let totalBytes = 0;
      let compressedBytes = 0;

      sourceStream.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (onProgress) {
          onProgress({ type: 'input', bytes: chunk.length, total: totalBytes });
        }
      });

      compressionStream.on('data', (chunk) => {
        compressedBytes += chunk.length;
        chunks.push(chunk);
        if (onProgress) {
          onProgress({ type: 'output', bytes: chunk.length, total: compressedBytes });
        }
      });

      compressionStream.on('end', () => {
        resolve({
          data: Buffer.concat(chunks),
          originalSize: totalBytes,
          compressedSize: compressedBytes,
          ratio: compressedBytes / totalBytes
        });
      });

      compressionStream.on('error', reject);
      sourceStream.on('error', reject);

      sourceStream.pipe(compressionStream);
    });
  }

  /**
   * Pipe a stream through compression
   */
  pipeCompressed(sourceStream, destinationStream, algorithm, level) {
    const compressionStream = this.createCompressionStream(algorithm, level);
    
    sourceStream
      .pipe(compressionStream)
      .pipe(destinationStream);

    return compressionStream;
  }

  /**
   * Create a streaming middleware handler
   */
  createStreamingHandler(algorithm, level) {
    const compressionStream = this.createCompressionStream(algorithm, level);
    const streamId = Date.now().toString();

    this.activeStreams.set(streamId, {
      stream: compressionStream,
      startTime: Date.now(),
      algorithm,
      level
    });

    compressionStream.on('end', () => {
      this.activeStreams.delete(streamId);
    });

    compressionStream.on('error', () => {
      this.activeStreams.delete(streamId);
    });

    return {
      stream: compressionStream,
      streamId
    };
  }

  /**
   * Get active stream info
   */
  getStreamInfo(streamId) {
    return this.activeStreams.get(streamId);
  }

  /**
   * Get all active streams
   */
  getActiveStreams() {
    return Array.from(this.activeStreams.entries()).map(([id, info]) => ({
      id,
      ...info,
      age: Date.now() - info.startTime
    }));
  }

  /**
   * Cancel a stream
   */
  cancelStream(streamId) {
    const streamInfo = this.activeStreams.get(streamId);
    if (streamInfo) {
      streamInfo.stream.destroy();
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all streams
   */
  cancelAllStreams() {
    for (const [streamId, streamInfo] of this.activeStreams) {
      streamInfo.stream.destroy();
    }
    this.activeStreams.clear();
  }

  /**
   * Create a chunked compression transform
   */
  createChunkedTransform(algorithm, level, chunkSize = 16384) {
    let buffer = Buffer.alloc(0);
    const compressionStream = this.createCompressionStream(algorithm, level);

    return new Transform({
      transform(chunk, encoding, callback) {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= chunkSize) {
          const toCompress = buffer.slice(0, chunkSize);
          buffer = buffer.slice(chunkSize);
          compressionStream.write(toCompress);
        }

        callback();
      },

      flush(callback) {
        if (buffer.length > 0) {
          compressionStream.write(buffer);
        }
        compressionStream.end();
        compressionStream.on('data', (data) => {
          this.push(data);
        });
        compressionStream.on('end', callback);
      }
    });
  }

  /**
   * Get stream statistics
   */
  getStreamStats() {
    const streams = this.getActiveStreams();
    return {
      activeCount: streams.length,
      streams: streams.map(s => ({
        id: s.id,
        algorithm: s.algorithm,
        level: s.level,
        age: s.age
      }))
    };
  }
}
