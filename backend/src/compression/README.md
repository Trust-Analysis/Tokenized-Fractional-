# Compression Subsystem — Correctness Validation Process

This directory implements the real-time response compression subsystem
(`compression-engine.js`, `pre-compression.js`, `edge-cases.js`). Because a
regression here can silently corrupt API response payloads for a subset of
clients/content types, **no change to compression logic may be merged without
the validation process below passing.**

## The invariant

For every supported strategy and every payload:

```
decompress(compress(payload, strategy, level)) === payload   // byte-identical
```

Strategies covered: `gzip`, `deflate`, `br` (Brotli). Levels covered: the full
valid range per algorithm (0–9 for gzip/deflate, 0–11 for Brotli, sampled at
0/1/3/6/9 and 0/1/4/6/9/11 respectively).

## How a compression change is validated

1. **Round-trip property tests** — `__tests__/compressionRoundTrip.test.js`
   generates 60 seeded-random payloads per algorithm (reproducible via the
   mulberry32 PRNG, so failures are deterministic and re-runnable) across six
   payload shapes: fully random binary, highly compressible repeated bytes,
   ASCII text, JSON documents, unicode text, and sparse binary with embedded
   nulls. Each payload is compressed at every sampled level and must
   decompress byte-identically.
2. **Fixed edge payloads** — empty bodies, single bytes, 1 MiB of zeros,
   256 KiB of incompressible data, and multi-byte unicode are round-tripped
   through every algorithm.
3. **Corruption handling** — feeding corrupt bytes to each decompressor must
   fail with the wrapped `Decompression failed: …` error, never return
   garbage (regression EC-12).
4. **Edge-case regression tests** — every edge case documented below has an
   explicit numbered regression test (`EC-1` … `EC-13`) in the same suite.

Run the suite:

```bash
cd backend
npm test -- __tests__/compressionRoundTrip.test.js
```

## Checklist for adding a new compression strategy

1. Register it in `CompressionEngine.algorithms` with `compress`,
   `decompress`, and the HTTP `encoding` name.
2. Add it to the `ALGORITHMS` list and `LEVELS` map in
   `__tests__/compressionRoundTrip.test.js` — the property-based round-trip
   tests then cover it automatically.
3. Add its encoding to the `compressedEncodings` list in
   `EdgeCaseHandler.isAlreadyCompressed` so double-compression is avoided.
4. Add its default level to `CompressionEngine.getDefaultLevel` and its level
   range to `validateLevel`.
5. Document the strategy and its known limits in this README, and confirm
   `npm test -- __tests__/compressionRoundTrip.test.js` passes before opening
   a PR.

## Edge-case catalog (`edge-cases.js`)

Each entry maps to a numbered regression test (`EC-n`) in
`__tests__/compressionRoundTrip.test.js`. When you change a behavior here,
update this table and the corresponding test in the same PR.

| ID | Edge case | Behavior | Test |
|----|-----------|----------|------|
| EC-1 | Payload content type is already a compressed container (gzip/zip/7z/rar/tar/bz2, JPEG/PNG/GIF/WebP/HEIC/HEIF, MP4/MOV/AVI/WMV, MP3/WAV/OGG/AAC/FLAC) | Skipped — compression would waste CPU and rarely shrink the payload | EC-1 |
| EC-2 | `Content-Encoding` header already present (`gzip`, `deflate`, `br`, `compress`, `identity`) | Treated as already compressed (case-insensitive, comma lists supported). Note: `identity` is intentionally included so an explicitly negotiated identity response is never re-compressed | EC-2 |
| EC-3 | Content type embeds a compressed file extension (e.g. `file.png`, `archive.tar.gz`, `audio.mp3`) | Detected via extension sniffing as already compressed | EC-3 |
| EC-4 | Tiny payloads below the configured size threshold | Skipped — compression overhead exceeds savings (`shouldSkipBySize`) | EC-4 |
| EC-5 | Aggregate compression memory would exceed the cap (default 100 MB) | `allocateMemory` throws `Memory limit exceeded for compression`; `freeMemory` floors at zero; `resetMemoryUsage` clears accounting; `setMemoryLimit` reconfigures the cap | EC-5 |
| EC-6 | `validateContent` input checks: empty body (error), size over cap (error), already-compressed content (warning, honours `skipCompressed: false`) | Severity-tagged issue list plus `valid` flag | EC-6 |
| EC-7 | Compression errors surface from zlib or level validation | Classified as `memory_error` (not recoverable), `algorithm_error` (recoverable → try fallback), `compression_error` (recoverable → return uncompressed), or `unknown_error` (not recoverable) | EC-7 |
| EC-8 | Response headers after compression: stale `Content-Length`, missing `Content-Encoding`, missing `Vary: Accept-Encoding` | `sanitizeHeaders` strips both casing variants of content-length, sets `content-encoding`, and appends `Accept-Encoding` to any existing `Vary` | EC-8 |
| EC-9 | Response already carries a non-identity `Content-Encoding` (plain object or `Headers`-style `get()`) | `isResponseCompressed` reports it so the pipeline skips a second pass | EC-9 |
| EC-10 | Streaming responses (node streams expose `.pipe`) | `isStreamingResponse` detects them so buffering logic is bypassed | EC-10 |
| EC-11 | Site-specific content types need to join/leave the skip list at runtime | `addCompressedContentType` / `removeCompressedContentType` (idempotent add) | EC-11 |
| EC-12 | Corrupt or truncated compressed bytes reach a decompressor | Wrapped `Decompression failed: …` error — never silently returns corrupted data | EC-12 |
| EC-13 | `PreCompression` algorithm list drifts from the engine | Every pre-compression algorithm must be engine-supported; `addAlgorithm`/`removeAlgorithm` stay idempotent; pre-compressed content round-trips byte-identically | EC-13 (+ round-trip test) |

## Known limitations

- `isAlreadyCompressed` treats `identity` as "already compressed" (EC-2). This
  is deliberate: an identity-encoded response must never be re-compressed.
- Brotli quality 0 produces stored (uncompressed) blocks; this is valid and
  round-trips correctly but offers no size benefit — callers should use
  `getDefaultLevel` unless there is a measured reason not to.
- Pre-compression caching is in-memory (`Map`); the `cacheDir` option is
  reserved for a future on-disk cache and currently has no effect on reads.
