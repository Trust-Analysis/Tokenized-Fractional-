import { describe, expect, test } from '@jest/globals';
import { isValidRequestId, newId } from '../src/utils/id.js';

describe('newId', () => {
  test('generates 100,000 distinct prefixed IDs', () => {
    const ids = new Set(Array.from({ length: 100_000 }, () => newId('test')));

    expect(ids.size).toBe(100_000);
    expect([...ids].every(id => /^test_[0-9a-f-]{36}$/.test(id))).toBe(true);
  });

  test('validates inbound request ID format and length', () => {
    expect(isValidRequestId('client-123:abc.def')).toBe(true);
    expect(isValidRequestId('contains spaces')).toBe(false);
    expect(isValidRequestId('x'.repeat(129))).toBe(false);
    expect(isValidRequestId(['request-id'])).toBe(false);
  });
});
