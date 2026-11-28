import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAdminKey } from '../src/utils/adminKey.js';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));

describe('verifyAdminKey', () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test-admin-key';
  });

  afterAll(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = originalAdminKey;
    }
  });

  test('accepts the configured admin key', () => {
    expect(verifyAdminKey({ headers: { 'x-api-key': 'test-admin-key' } })).toBe(true);
  });

  test('rejects a wrong key of the same length', () => {
    expect(verifyAdminKey({ headers: { 'x-api-key': 'fake-admin-key' } })).toBe(false);
  });

  test('rejects a key of a different length', () => {
    expect(verifyAdminKey({ headers: { 'x-api-key': 'short' } })).toBe(false);
  });

  test('rejects missing and non-string keys', () => {
    expect(verifyAdminKey({ headers: {} })).toBe(false);
    expect(verifyAdminKey({ headers: { 'x-api-key': ['test-admin-key'] } })).toBe(false);
  });
});

describe('admin key comparisons', () => {
  test('production JavaScript does not compare directly against ADMIN_API_KEY', () => {
    const comparisons = [];

    function inspectDirectory(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!['__tests__', 'node_modules', 'coverage'].includes(entry.name)) {
            inspectDirectory(join(directory, entry.name));
          }
          continue;
        }

        if (!entry.name.endsWith('.js')) continue;
        const path = join(directory, entry.name);
        const source = readFileSync(path, 'utf8');
        if (
          /\bprocess\.env\.ADMIN_API_KEY\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*process\.env\.ADMIN_API_KEY\b/.test(
            source,
          )
        ) {
          comparisons.push(path);
        }
      }
    }

    inspectDirectory(backendRoot);
    expect(comparisons).toEqual([]);
  });
});
