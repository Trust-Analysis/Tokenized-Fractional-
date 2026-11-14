// Issue #711: fail-fast startup validation of required environment variables.
// These tests only touch env.js, so they do not need the HTTP app to boot.
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { collectEnvErrors, validateEnv } from '../env.js';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_ENV = {
  ADMIN_API_KEY: 'a-sufficiently-long-admin-key',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:4173',
  DATA_FILE: 'data.json',
};

describe('collectEnvErrors', () => {
  test('returns no errors for a valid environment', () => {
    expect(collectEnvErrors(VALID_ENV)).toEqual([]);
  });

  test('flags a missing ADMIN_API_KEY as required', () => {
    const errors = collectEnvErrors({ ...VALID_ENV, ADMIN_API_KEY: undefined });
    expect(errors.map((e) => e.key)).toContain('ADMIN_API_KEY');
    expect(errors[0].message).toMatch(/required/i);
  });

  test('treats an empty ADMIN_API_KEY as missing', () => {
    const errors = collectEnvErrors({ ...VALID_ENV, ADMIN_API_KEY: '   ' });
    expect(errors.map((e) => e.key)).toContain('ADMIN_API_KEY');
  });

  test('enforces the ADMIN_API_KEY minimum length', () => {
    const errors = collectEnvErrors({ ...VALID_ENV, ADMIN_API_KEY: 'short' });
    expect(errors.map((e) => e.key)).toContain('ADMIN_API_KEY');
    expect(errors[0].message).toMatch(/at least 16 characters/i);
  });

  test('redacts secret values in error messages', () => {
    const errors = collectEnvErrors({ ...VALID_ENV, ADMIN_API_KEY: 'leak-me' });
    const { message } = errors.find((e) => e.key === 'ADMIN_API_KEY');
    expect(message).toContain('<redacted>');
    expect(message).not.toContain('leak-me');
  });

  test('requires CORS_ORIGINS and validates each origin', () => {
    expect(collectEnvErrors({ ...VALID_ENV, CORS_ORIGINS: undefined }).map((e) => e.key)).toContain(
      'CORS_ORIGINS',
    );

    const bad = collectEnvErrors({ ...VALID_ENV, CORS_ORIGINS: 'not-a-url' });
    expect(bad.map((e) => e.key)).toContain('CORS_ORIGINS');
  });

  test('requires DATA_FILE and rejects unsafe paths', () => {
    expect(collectEnvErrors({ ...VALID_ENV, DATA_FILE: undefined }).map((e) => e.key)).toContain(
      'DATA_FILE',
    );

    for (const unsafe of ['/etc/passwd', '../secrets.json', 'data.txt']) {
      const errors = collectEnvErrors({ ...VALID_ENV, DATA_FILE: unsafe });
      expect(errors.map((e) => e.key)).toContain('DATA_FILE');
    }
  });

  test('validates PORT range when present', () => {
    expect(collectEnvErrors({ ...VALID_ENV, PORT: 'not-a-port' }).map((e) => e.key)).toContain(
      'PORT',
    );
    expect(collectEnvErrors({ ...VALID_ENV, PORT: '70000' }).map((e) => e.key)).toContain('PORT');
    expect(collectEnvErrors({ ...VALID_ENV, PORT: '3001' })).toEqual([]);
  });

  test('validates NODE_ENV and LOG_LEVEL enumerations', () => {
    expect(collectEnvErrors({ ...VALID_ENV, NODE_ENV: 'prod' }).map((e) => e.key)).toContain(
      'NODE_ENV',
    );
    expect(collectEnvErrors({ ...VALID_ENV, LOG_LEVEL: 'loud' }).map((e) => e.key)).toContain(
      'LOG_LEVEL',
    );
  });

  test('reports every problem at once rather than only the first', () => {
    const errors = collectEnvErrors({ NODE_ENV: 'production' });
    const keys = errors.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['ADMIN_API_KEY', 'CORS_ORIGINS', 'DATA_FILE']));
  });
});

describe('validateEnv', () => {
  test('is skipped under NODE_ENV=test', () => {
    let exited = false;
    const errors = validateEnv(
      { NODE_ENV: 'test' },
      {
        exit: () => {
          exited = true;
        },
      },
    );
    expect(errors).toEqual([]);
    expect(exited).toBe(false);
  });

  test('exits with the configured code when invalid', () => {
    const original = console.error;
    console.error = () => {};
    let code = null;
    try {
      validateEnv(
        { NODE_ENV: 'production' },
        {
          exit: (c) => {
            code = c;
          },
        },
      );
    } finally {
      console.error = original;
    }
    expect(code).toBe(1);
  });

  test('does not exit for a valid environment', () => {
    let exited = false;
    validateEnv(
      { ...VALID_ENV, NODE_ENV: 'production' },
      {
        exit: () => {
          exited = true;
        },
      },
    );
    expect(exited).toBe(false);
  });

  test('the real process exits non-zero with a clear message', () => {
    const script = "import('./env.js').then((m) => m.validateEnv());";
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: BACKEND_DIR,
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Environment configuration errors');
    expect(result.stderr).toContain('ADMIN_API_KEY');
  });
});
