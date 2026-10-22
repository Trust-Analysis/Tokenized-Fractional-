/**
 * Issue #901: Compression correctness validation
 *
 * Round-trip (compress → decompress → byte-identical) property-based tests
 * covering every supported compression strategy (gzip, deflate, br) across a
 * wide range of payload shapes and sizes, plus explicit regression tests for
 * every edge case handled by `src/compression/edge-cases.js`.
 *
 * See `src/compression/README.md` for the documented validation process and
 * the edge-case catalog these regression tests are generated from.
 */

import { describe, test, expect } from '@jest/globals';
import { CompressionEngine } from '../src/compression/compression-engine.js';
import { EdgeCaseHandler } from '../src/compression/edge-cases.js';
import { PreCompression } from '../src/compression/pre-compression.js';

// ── Deterministic PRNG (mulberry32) so property-based runs are reproducible ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rand, length) {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) buf[i] = Math.floor(rand() * 256);
  return buf;
}

/** Generate a random payload of a randomly chosen "shape". */
function generatePayload(rand) {
  const shape = Math.floor(rand() * 6);
  const length = Math.floor(rand() * 8192);
  switch (shape) {
    case 0: // fully random binary (incompressible)
      return randomBytes(rand, length);
    case 1: // repeated single byte (highly compressible)
      return Buffer.alloc(length, Math.floor(rand() * 256));
    case 2: { // ASCII-ish text
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 \n';
      const buf = Buffer.alloc(length);
      for (let i = 0; i < length; i++) buf[i] = chars.charCodeAt(Math.floor(rand() * chars.length));
      return buf;
    }
    case 3: { // JSON document
      const items = [];
      const count = Math.max(1, Math.floor(length / 40));
      for (let i = 0; i < count; i++) {
        items.push({ id: i, name: `asset-${i}`, price: rand() * 1000, active: rand() > 0.5 });
      }
      return Buffer.from(JSON.stringify(items));
    }
    case 4: { // unicode text
      const chars = ['é', '中', '🚀', 'ß', 'ø', '안', '🙂', 'я'];
      let s = '';
      const count = Math.max(1, Math.floor(length / 2));
      for (let i = 0; i < count; i++) s += chars[Math.floor(rand() * chars.length)];
      return Buffer.from(s, 'utf8');
    }
    default: // sparse binary with embedded nulls
      return randomBytes(rand, length).map(() => (rand() > 0.8 ? Math.floor(rand() * 256) : 0));
  }
}

const ALGORITHMS = ['gzip', 'deflate', 'br'];
const LEVELS = {
  gzip: [0, 1, 3, 6, 9],
  deflate: [0, 1, 3, 6, 9],
  br: [0, 1, 4, 6, 9, 11],
};

describe('Issue #901: Compression round-trip correctness (property-based)', () => {
  const engine = new CompressionEngine();

  test('every supported algorithm is registered and reported', () => {
    expect(engine.getSupportedAlgorithms().sort()).toEqual(['br', 'deflate', 'gzip']);
    for (const algo of ALGORITHMS) {
      expect(engine.isSupported(algo)).toBe(true);
      expect(engine.getEncodingName(algo)).toBe(algo);
    }
  });

  // Property-based: 60 seeded random payloads × every algorithm × every level.
  for (const algorithm of ALGORITHMS) {
    test(`round-trips byte-identically for every level (${algorithm}) across 60 random payload shapes`, async () => {
      const rand = mulberry32(0xc0ffee + algorithm.length);
      for (let i = 0; i < 60; i++) {
        const payload = generatePayload(rand);
        for (const level of LEVELS[algorithm]) {
          const { data: compressed, originalSize, compressedSize, ratio } = await engine.compress(payload, algorithm, level);
          expect(originalSize).toBe(payload.length);
          expect(compressedSize).toBe(compressed.length);
          expect(ratio).toBe(compressed.length / payload.length);

          const restored = await engine.decompress(compressed, algorithm);
          expect(Buffer.from(restored).equals(payload)).toBe(true);
        }
      }
    }, 60000);
  }

  test('round-trips fixed edge payloads byte-identically for every algorithm', async () => {
    const payloads = [
      Buffer.alloc(0), // empty body
      Buffer.from([0]), // single null byte
      Buffer.from('x'), // single printable byte
      Buffer.from('{"ok":true}', 'utf8'),
      Buffer.alloc(1024 * 1024, 0), // 1 MiB of zeros
      randomBytes(mulberry32(42), 1024 * 256), // 256 KiB incompressible
      Buffer.from('🚀 unicode payload — 中文 — émojis 🎉'.repeat(100), 'utf8'),
    ];

    for (const algorithm of ALGORITHMS) {
      for (const payload of payloads) {
        const { data: compressed } = await engine.compress(payload, algorithm);
        const restored = await engine.decompress(compressed, algorithm);
        expect(Buffer.from(restored).equals(payload)).toBe(true);
      }
    }
  }, 60000);

  test('round-trips the default level used by the engine for each algorithm', async () => {
    const payload = Buffer.from(JSON.stringify({ hello: 'world'.repeat(500) }));
    for (const algorithm of ALGORITHMS) {
      const level = engine.getDefaultLevel(algorithm);
      expect(engine.validateLevel(algorithm, level)).toBe(true);
      const { data: compressed } = await engine.compress(payload, algorithm, level);
      const restored = await engine.decompress(compressed, algorithm);
      expect(Buffer.from(restored).equals(payload)).toBe(true);
    }
  });

  test('rejects unsupported algorithms with a clear error', async () => {
    await expect(engine.compress(Buffer.from('x'), 'lzma')).rejects.toThrow(
      'Unsupported compression algorithm: lzma'
    );
    await expect(engine.decompress(Buffer.from('x'), 'lzma')).rejects.toThrow(
      'Unsupported compression algorithm: lzma'
    );
  });

  test('level validation covers the full valid range per algorithm', () => {
    expect(engine.validateLevel('gzip', -1)).toBe(false);
    expect(engine.validateLevel('gzip', 0)).toBe(true);
    expect(engine.validateLevel('gzip', 9)).toBe(true);
    expect(engine.validateLevel('gzip', 10)).toBe(false);
    expect(engine.validateLevel('br', 11)).toBe(true);
    expect(engine.validateLevel('br', 12)).toBe(false);
  });

  test('pre-compressed content round-trips byte-identically through PreCompression', async () => {
    const pre = new PreCompression();
    const payloads = [
      Buffer.alloc(0),
      Buffer.from('pre-compression payload '.repeat(1000)),
      randomBytes(mulberry32(7), 4096),
    ];

    for (const payload of payloads) {
      const results = await pre.preCompressContent(payload, 'application/json');
      for (const algorithm of ['br', 'gzip']) {
        expect(results[algorithm]).toBeTruthy();
        const restored = await engine.decompress(results[algorithm].data, algorithm);
        expect(Buffer.from(restored).equals(payload)).toBe(true);
      }
    }
  });
});

describe('Issue #901: edge-cases.js regression tests (one per documented edge case)', () => {
  test('EC-1: content types that are already compressed are skipped', () => {
    const handler = new EdgeCaseHandler();
    const compressedTypes = handler.getCompressedContentTypes();
    expect(compressedTypes).toContain('image/png');
    expect(compressedTypes).toContain('video/mp4');
    expect(compressedTypes).toContain('application/gzip');
    expect(handler.isAlreadyCompressed('image/png')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json')).toBe(false);
  });

  test('EC-2: a content-encoding header marks the payload as already compressed', () => {
    const handler = new EdgeCaseHandler();
    expect(handler.isAlreadyCompressed('application/json', 'gzip')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json', 'br, gzip')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json', 'IDENTITY')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json', 'identity')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json', undefined)).toBe(false);
  });

  test('EC-3: compressed file extensions embedded in the content type are detected', () => {
    const handler = new EdgeCaseHandler();
    expect(handler.isAlreadyCompressed('file.png')).toBe(true);
    expect(handler.isAlreadyCompressed('archive.tar.gz')).toBe(true);
    expect(handler.isAlreadyCompressed('audio.mp3')).toBe(true);
    expect(handler.isAlreadyCompressed('application/json; charset=utf-8')).toBe(false);
  });

  test('EC-4: payloads below the size threshold are skipped', () => {
    const handler = new EdgeCaseHandler();
    expect(handler.shouldSkipBySize(100, 500)).toBe(true);
    expect(handler.shouldSkipBySize(500, 500)).toBe(false);
    expect(handler.shouldSkipBySize(5000, 500)).toBe(false);
  });

  test('EC-5: memory accounting enforces the cap, floors at zero, and resets', () => {
    const handler = new EdgeCaseHandler({ maxMemoryUsage: 1000 });
    handler.allocateMemory(600);
    expect(handler.getMemoryUsage().current).toBe(600);
    expect(() => handler.allocateMemory(500)).toThrow('Memory limit exceeded for compression');
    handler.freeMemory(600);
    handler.freeMemory(600); // over-free must floor at 0
    expect(handler.getMemoryUsage().current).toBe(0);
    handler.allocateMemory(400);
    handler.resetMemoryUsage();
    expect(handler.getMemoryUsage().current).toBe(0);
    handler.setMemoryLimit(2000);
    expect(handler.getMemoryUsage().max).toBe(2000);
  });

  test('EC-6: validateContent flags empty content and oversized payloads as errors, pre-compressed as warning', () => {
    const handler = new EdgeCaseHandler({ maxMemoryUsage: 1024 });

    const empty = handler.validateContent(Buffer.alloc(0), 'application/json', undefined, 0);
    expect(empty.valid).toBe(false);
    expect(empty.issues.some((i) => i.type === 'empty_content' && i.severity === 'error')).toBe(true);

    const oversized = handler.validateContent(Buffer.alloc(2048), 'application/json', undefined, 2048);
    expect(oversized.valid).toBe(false);
    expect(oversized.issues.some((i) => i.type === 'size_exceeded' && i.severity === 'error')).toBe(true);

    const preCompressed = handler.validateContent(Buffer.from('x'), 'image/png', undefined, 1);
    expect(preCompressed.valid).toBe(true);
    expect(preCompressed.issues.some((i) => i.type === 'already_compressed' && i.severity === 'warning')).toBe(true);

    const clean = handler.validateContent(Buffer.from('x'), 'application/json', undefined, 1);
    expect(clean.valid).toBe(true);
    expect(clean.issues).toHaveLength(0);

    // skipCompressed disabled → already-compressed check is bypassed
    const noSkip = new EdgeCaseHandler({ skipCompressed: false });
    const bypassed = noSkip.validateContent(Buffer.from('x'), 'image/png', undefined, 1);
    expect(bypassed.issues).toHaveLength(0);
  });

  test('EC-7: compression errors are classified with the right recoverability', () => {
    const handler = new EdgeCaseHandler();

    const memory = handler.handleCompressionError(new Error('Memory limit exceeded for compression'));
    expect(memory.type).toBe('memory_error');
    expect(memory.recoverable).toBe(false);

    const algorithm = handler.handleCompressionError(new Error('Unsupported compression algorithm: lzma'));
    expect(algorithm.type).toBe('algorithm_error');
    expect(algorithm.recoverable).toBe(true);

    const compression = handler.handleCompressionError(new Error('Compression failed: stream error'));
    expect(compression.type).toBe('compression_error');
    expect(compression.recoverable).toBe(true);

    const unknown = handler.handleCompressionError(new Error('something else'), { requestId: 'r1' });
    expect(unknown.type).toBe('unknown_error');
    expect(unknown.recoverable).toBe(false);
    expect(unknown.context).toEqual({ requestId: 'r1' });
  });

  test('EC-8: sanitizeHeaders strips content-length, sets content-encoding, and varies on accept-encoding', () => {
    const handler = new EdgeCaseHandler();

    const sanitized = handler.sanitizeHeaders({ 'content-length': '123', 'Content-Length': '123', vary: 'Accept-Encoding' }, 'gzip');
    expect(sanitized['content-length']).toBeUndefined();
    expect(sanitized['Content-Length']).toBeUndefined();
    expect(sanitized['content-encoding']).toBe('gzip');
    expect(sanitized.vary).toBe('Accept-Encoding');

    const noVary = handler.sanitizeHeaders({ 'content-length': '10' }, 'br');
    expect(noVary.vary).toBe('Accept-Encoding');

    const multiVary = handler.sanitizeHeaders({ vary: 'Origin', 'content-length': '10' }, 'deflate');
    expect(multiVary.vary).toBe('Origin, Accept-Encoding');
  });

  test('EC-9: responses carrying a non-identity content-encoding are detected as compressed', () => {
    const handler = new EdgeCaseHandler();
    expect(handler.isResponseCompressed({ 'content-encoding': 'gzip' })).toBe(true);
    expect(handler.isResponseCompressed({ 'content-encoding': 'identity' })).toBe(false);
    expect(handler.isResponseCompressed({})).toBe(false);
    expect(handler.isResponseCompressed(null)).toBe(false);
    const headersWithGet = { get: (name) => (name === 'content-encoding' ? 'br' : null) };
    expect(handler.isResponseCompressed(headersWithGet)).toBe(true);
  });

  test('EC-10: streaming responses are detected via the pipe interface', () => {
    const handler = new EdgeCaseHandler();
    expect(handler.isStreamingResponse({ pipe: () => {} })).toBe(true);
    expect(handler.isStreamingResponse({})).toBe(false);
    expect(handler.isStreamingResponse(null)).toBe(false);
  });

  test('EC-11: the compressed content type list is extensible and mutable', () => {
    const handler = new EdgeCaseHandler();
    handler.addCompressedContentType('application/vnd.example-packed');
    expect(handler.isAlreadyCompressed('application/vnd.example-packed')).toBe(true);
    handler.addCompressedContentType('application/vnd.example-packed'); // idempotent
    expect(handler.getCompressedContentTypes().filter((t) => t === 'application/vnd.example-packed')).toHaveLength(1);
    handler.removeCompressedContentType('application/vnd.example-packed');
    expect(handler.isAlreadyCompressed('application/vnd.example-packed')).toBe(false);
  });

  test('EC-12: decompressing corrupt data fails with a clear wrapped error', async () => {
    const engine = new CompressionEngine();
    await expect(engine.decompress(Buffer.from('not-gzip-data'), 'gzip')).rejects.toThrow('Decompression failed');
    await expect(engine.decompress(Buffer.from('not-deflate-data'), 'deflate')).rejects.toThrow('Decompression failed');
    await expect(engine.decompress(Buffer.from('not-brotli-data'), 'br')).rejects.toThrow('Decompression failed');
  });

  test('EC-13: the default algorithm list and levels used by PreCompression stay in sync with the engine', () => {
    const pre = new PreCompression();
    const engine = new CompressionEngine();
    for (const algorithm of pre.algorithms) {
      expect(engine.isSupported(algorithm)).toBe(true);
    }
    pre.addAlgorithm('deflate', 9);
    expect(pre.algorithms.filter((a) => a === 'deflate')).toHaveLength(1);
    pre.removeAlgorithm('deflate');
    expect(pre.algorithms).not.toContain('deflate');
  });
});
