/**
 * __tests__/cache-tls.test.js
 *
 * Unit tests for the TLS configuration logic in cache.js.
 *
 * These tests verify that buildTlsOptions() correctly reads environment
 * variables and constructs the right ioredis TLS option objects, covering:
 *   - TLS disabled (REDIS_TLS unset or 'false')
 *   - TLS enabled with defaults (rejectUnauthorized = true)
 *   - rejectUnauthorized override for local dev
 *   - CA certificate loading
 *   - mTLS: client cert + key loading
 *   - Full mTLS config with all options set
 *   - Missing cert files result in a thrown error (fs.readFileSync)
 */

// Set test env before any imports so module-level constants initialise correctly
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';

import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildTlsOptions } from '../cache.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write a temporary file and return its path.
 * Content is a PEM-ish placeholder (tests only check the Buffer, not validity).
 */
function tmpCertFile(name, content = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n') {
  const p = join(tmpdir(), name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

/**
 * Save the current REDIS_TLS* env vars, run fn(), then restore.
 */
function withEnv(vars, fn) {
  const prev = {};
  const keys = ['REDIS_TLS', 'REDIS_TLS_CA', 'REDIS_TLS_CERT', 'REDIS_TLS_KEY', 'REDIS_TLS_REJECT_UNAUTHORIZED'];
  keys.forEach(k => { prev[k] = process.env[k]; delete process.env[k]; });
  Object.entries(vars).forEach(([k, v]) => { process.env[k] = v; });
  try {
    return fn();
  } finally {
    keys.forEach(k => {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    });
  }
}

// ── Tests: buildTlsOptions() ──────────────────────────────────────────────────

describe('buildTlsOptions()', () => {
  // ── TLS disabled ─────────────────────────────────────────────────────────

  test('returns null when REDIS_TLS is not set', () => {
    const result = withEnv({}, () => buildTlsOptions());
    expect(result).toBeNull();
  });

  test('returns null when REDIS_TLS=false', () => {
    const result = withEnv({ REDIS_TLS: 'false' }, () => buildTlsOptions());
    expect(result).toBeNull();
  });

  test('returns null when REDIS_TLS is an empty string', () => {
    const result = withEnv({ REDIS_TLS: '' }, () => buildTlsOptions());
    expect(result).toBeNull();
  });

  // ── TLS enabled — defaults ────────────────────────────────────────────────

  test('returns an object when REDIS_TLS=true', () => {
    const result = withEnv({ REDIS_TLS: 'true' }, () => buildTlsOptions());
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });

  test('rejectUnauthorized defaults to true', () => {
    const result = withEnv({ REDIS_TLS: 'true' }, () => buildTlsOptions());
    expect(result.rejectUnauthorized).toBe(true);
  });

  test('rejectUnauthorized stays true when REDIS_TLS_REJECT_UNAUTHORIZED=true', () => {
    const result = withEnv(
      { REDIS_TLS: 'true', REDIS_TLS_REJECT_UNAUTHORIZED: 'true' },
      () => buildTlsOptions()
    );
    expect(result.rejectUnauthorized).toBe(true);
  });

  // ── rejectUnauthorized override ───────────────────────────────────────────

  test('rejectUnauthorized is false when REDIS_TLS_REJECT_UNAUTHORIZED=false', () => {
    const result = withEnv(
      { REDIS_TLS: 'true', REDIS_TLS_REJECT_UNAUTHORIZED: 'false' },
      () => buildTlsOptions()
    );
    expect(result.rejectUnauthorized).toBe(false);
  });

  // ── CA certificate ────────────────────────────────────────────────────────

  test('does not set ca when REDIS_TLS_CA is not set', () => {
    const result = withEnv({ REDIS_TLS: 'true' }, () => buildTlsOptions());
    expect(result.ca).toBeUndefined();
  });

  test('reads CA certificate file into a Buffer when REDIS_TLS_CA is set', () => {
    const caPath = tmpCertFile('rwa-test-ca.crt');
    try {
      const result = withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_CA: caPath },
        () => buildTlsOptions()
      );
      expect(Buffer.isBuffer(result.ca)).toBe(true);
      expect(result.ca.toString()).toContain('BEGIN CERTIFICATE');
    } finally {
      unlinkSync(caPath);
    }
  });

  // ── Client certificate (mTLS) ─────────────────────────────────────────────

  test('does not set cert/key when REDIS_TLS_CERT and REDIS_TLS_KEY are not set', () => {
    const result = withEnv({ REDIS_TLS: 'true' }, () => buildTlsOptions());
    expect(result.cert).toBeUndefined();
    expect(result.key).toBeUndefined();
  });

  test('reads client cert file into a Buffer when REDIS_TLS_CERT is set', () => {
    const certPath = tmpCertFile('rwa-test-client.crt');
    try {
      const result = withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_CERT: certPath },
        () => buildTlsOptions()
      );
      expect(Buffer.isBuffer(result.cert)).toBe(true);
      expect(result.cert.toString()).toContain('BEGIN CERTIFICATE');
    } finally {
      unlinkSync(certPath);
    }
  });

  test('reads client key file into a Buffer when REDIS_TLS_KEY is set', () => {
    const keyPath = tmpCertFile('rwa-test-client.key', '-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----\n'); // gitleaks:allow
    try {
      const result = withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_KEY: keyPath },
        () => buildTlsOptions()
      );
      expect(Buffer.isBuffer(result.key)).toBe(true);
      expect(result.key.toString()).toContain('PRIVATE KEY');
    } finally {
      unlinkSync(keyPath);
    }
  });

  // ── Full mTLS config ──────────────────────────────────────────────────────

  test('builds a complete mTLS config when all options are set', () => {
    const caPath   = tmpCertFile('rwa-test-ca-full.crt');
    const certPath = tmpCertFile('rwa-test-cert-full.crt');
    const keyPath  = tmpCertFile('rwa-test-key-full.key', '-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----\n'); // gitleaks:allow
    try {
      const result = withEnv(
        {
          REDIS_TLS: 'true',
          REDIS_TLS_CA: caPath,
          REDIS_TLS_CERT: certPath,
          REDIS_TLS_KEY: keyPath,
          REDIS_TLS_REJECT_UNAUTHORIZED: 'true',
        },
        () => buildTlsOptions()
      );

      expect(result).toMatchObject({
        rejectUnauthorized: true,
      });
      expect(Buffer.isBuffer(result.ca)).toBe(true);
      expect(Buffer.isBuffer(result.cert)).toBe(true);
      expect(Buffer.isBuffer(result.key)).toBe(true);
    } finally {
      unlinkSync(caPath);
      unlinkSync(certPath);
      unlinkSync(keyPath);
    }
  });

  // ── Error cases ───────────────────────────────────────────────────────────

  test('throws when REDIS_TLS_CA points to a non-existent file', () => {
    expect(() =>
      withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_CA: '/nonexistent/path/ca.crt' },
        () => buildTlsOptions()
      )
    ).toThrow();
  });

  test('throws when REDIS_TLS_CERT points to a non-existent file', () => {
    expect(() =>
      withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_CERT: '/nonexistent/path/client.crt' },
        () => buildTlsOptions()
      )
    ).toThrow();
  });

  test('throws when REDIS_TLS_KEY points to a non-existent file', () => {
    expect(() =>
      withEnv(
        { REDIS_TLS: 'true', REDIS_TLS_KEY: '/nonexistent/path/client.key' },
        () => buildTlsOptions()
      )
    ).toThrow();
  });
});
