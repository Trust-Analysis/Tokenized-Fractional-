// Issue #1144: JWT signing secrets must never fall back to a committed value.
import { describe, test, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';
import {
  MIN_JWT_SECRET_BYTES,
  resolveJwtSecret,
  resolveJwtVerificationSecrets,
  verifyJwt,
} from '../src/config/jwtSecret.js';

const STRONG_SECRET = 'a'.repeat(MIN_JWT_SECRET_BYTES);
const PREVIOUS_SECRET = 'b'.repeat(MIN_JWT_SECRET_BYTES);

describe('resolveJwtSecret', () => {
  test('throws when JWT_SECRET is missing outside test mode', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET is required/i);
    expect(() => resolveJwtSecret({ NODE_ENV: 'development' })).toThrow(/JWT_SECRET is required/i);
  });

  test('rejects a secret shorter than 32 bytes', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short' })).toThrow(
      /at least 32 bytes/i,
    );
  });

  test('treats a blank secret as missing', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: '   ' })).toThrow(
      /JWT_SECRET is required/i,
    );
  });

  test('accepts a 32+ byte secret', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET })).toBe(
      STRONG_SECRET,
    );
  });

  test('test mode uses a random process-local secret when none is set', () => {
    const secret = resolveJwtSecret({ NODE_ENV: 'test' });

    expect(Buffer.byteLength(secret, 'utf8')).toBeGreaterThanOrEqual(MIN_JWT_SECRET_BYTES);
    expect(secret).not.toContain('your-secret-key');
    expect(resolveJwtSecret({ NODE_ENV: 'test' })).toBe(secret);
  });
});

describe('resolveJwtVerificationSecrets', () => {
  test('returns only the current secret when no previous key is set', () => {
    const secrets = resolveJwtVerificationSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
    });

    expect(secrets).toEqual([STRONG_SECRET]);
  });

  test('accepts the previous secret during a rotation grace window', () => {
    const secrets = resolveJwtVerificationSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
      JWT_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });

    expect(secrets).toEqual([STRONG_SECRET, PREVIOUS_SECRET]);
  });

  test('rejects a weak previous secret', () => {
    expect(() =>
      resolveJwtVerificationSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: STRONG_SECRET,
        JWT_SECRET_PREVIOUS: 'short',
      }),
    ).toThrow(/JWT_SECRET_PREVIOUS must be at least 32 bytes/i);
  });
});

describe('verifyJwt', () => {
  test('verifies tokens signed with either the current or previous key', () => {
    const oldToken = jwt.sign({ sub: 'user-1' }, PREVIOUS_SECRET, { expiresIn: '1h' });
    const newToken = jwt.sign({ sub: 'user-2' }, STRONG_SECRET, { expiresIn: '1h' });
    const secrets = [STRONG_SECRET, PREVIOUS_SECRET];

    expect(verifyJwt(oldToken, secrets)).toMatchObject({ sub: 'user-1' });
    expect(verifyJwt(newToken, secrets)).toMatchObject({ sub: 'user-2' });
  });

  test('rejects a token signed with an unknown key', () => {
    const token = jwt.sign({ sub: 'attacker' }, 'c'.repeat(32), { expiresIn: '1h' });

    expect(() => verifyJwt(token, [STRONG_SECRET])).toThrow();
  });
});
