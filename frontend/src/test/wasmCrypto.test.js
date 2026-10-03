import { describe, it, expect, beforeAll } from 'vitest';
import {
  initWasmCrypto,
  verifySignatureWasm,
  generateHashWasm,
  benchmarkWasmVsJs,
  WASM_BUNDLE_SIZE_BYTES,
  MAX_ALLOWED_BUNDLE_SIZE,
} from '../services/wasmCrypto.js';

describe('Issue #419: WebAssembly cryptographic sandboxing for client signing', () => {
  beforeAll(async () => {
    await initWasmCrypto();
  });

  it('ensures Wasm bundle size is optimized to under 500KB', () => {
    expect(WASM_BUNDLE_SIZE_BYTES).toBeLessThan(MAX_ALLOWED_BUNDLE_SIZE);
    expect(WASM_BUNDLE_SIZE_BYTES).toBeLessThan(500 * 1024);
  });

  it('throws an error if custom Wasm bundle exceeds 500KB limit', async () => {
    const oversizedBuffer = new Uint8Array(501 * 1024);
    await expect(initWasmCrypto(oversizedBuffer)).rejects.toThrow('exceeds 500KB limit');
  });

  it('executes cryptographic signature verification strictly within Wasm context', async () => {
    const result = await verifySignatureWasm('0xSig123', 'message_data', '0xPub456');

    expect(result.verified).toBe(true);
    expect(result.executedInWasm).toBe(true);
    expect(result.wasmMemoryAllocated).toBeGreaterThan(0);
  });

  it('generates secure hashes inside Wasm context', async () => {
    const hashResult = await generateHashWasm('vault_redemption_payload');

    expect(hashResult.hash).toMatch(/^0x[0-9a-fA-F]+/);
    expect(hashResult.executedInWasm).toBe(true);
  });

  it('benchmarks signature generation execution time against native JS', async () => {
    const benchmark = await benchmarkWasmVsJs(500);

    expect(benchmark.iterations).toBe(500);
    expect(typeof benchmark.jsDurationMs).toBe('number');
    expect(typeof benchmark.wasmDurationMs).toBe('number');
    expect(benchmark.wasmDurationMs).toBeGreaterThanOrEqual(0);
  });
});
