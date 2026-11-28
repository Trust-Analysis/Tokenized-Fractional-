// Audit remediation: CORS must be defined once (src/middleware/cors.js) and
// shared by both backend entrypoints, with preflight coverage for every
// header the frontend and SDK send.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import {
  CORS_ALLOWED_HEADERS,
  CORS_METHODS,
  CORS_OPTIONS,
  createCorsMiddleware,
  parseCorsOrigins,
} from '../src/middleware/cors.js';
import { collectEnvErrors } from '../env.js';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_ORIGIN = 'http://localhost:5173';

// Every non-simple header the frontend and SDK attach to requests. Simple
// headers (Accept is actually simple; listed anyway) are included so the
// preflight test proves the full set is approved.
const CLIENT_HEADERS = [
  'content-type',
  'accept',
  'authorization',
  'x-api-key',
  'x-request-id',
  'x-tenant-id',
];

function buildApp() {
  const app = express();
  app.use(createCorsMiddleware({ NODE_ENV: 'test' }));
  app.get('/api/v1/ping', (_req, res) => res.json({ ok: true }));
  app.options('/api/v1/ping', (_req, res) => res.sendStatus(204));
  return app;
}

describe('parseCorsOrigins', () => {
  test('splits and trims a comma-separated list', () => {
    expect(parseCorsOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  test('falls back to localhost dev origins when unset or empty', () => {
    expect(parseCorsOrigins(undefined)).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
    expect(parseCorsOrigins('  ,  ')).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });
});

describe('shared CORS policy', () => {
  test('allows every method the API surface uses', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(CORS_METHODS).toContain(method);
    }
    expect(CORS_OPTIONS.methods).toEqual(expect.arrayContaining(CORS_METHODS));
  });

  test('allowlist covers every header the frontend and SDK send', () => {
    const allowed = CORS_ALLOWED_HEADERS.map((h) => h.toLowerCase());
    for (const header of CLIENT_HEADERS) {
      expect(allowed).toContain(header);
    }
  });
});

describe('CORS preflight', () => {
  const app = buildApp();

  test('approves preflight for all client headers', async () => {
    const res = await request(app)
      .options('/api/v1/ping')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', CLIENT_HEADERS.join(', '));

    expect(res.status).toBe(204);
    const allowHeaders = (res.headers['access-control-allow-headers'] || '')
      .toLowerCase()
      .split(',')
      .map((h) => h.trim());
    for (const header of CLIENT_HEADERS) {
      expect(allowHeaders).toContain(header);
    }
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  test('reflects allowed methods on preflight', async () => {
    const res = await request(app)
      .options('/api/v1/ping')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'DELETE');

    expect(res.status).toBe(204);
    const allowMethods = (res.headers['access-control-allow-methods'] || '')
      .toUpperCase()
      .split(',')
      .map((m) => m.trim());
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowMethods).toContain(method);
    }
  });

  test('does not grant CORS to an unknown origin', async () => {
    const res = await request(app)
      .get('/api/v1/ping')
      .set('Origin', 'https://evil.example')
      .set('x-api-key', 'k')
      .set('authorization', 'Bearer t');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('actual requests carry the CORS headers for allowed origins', async () => {
    const res = await request(app)
      .get('/api/v1/ping')
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-api-key', 'k')
      .set('x-request-id', 'req_test')
      .set('x-tenant-id', 'tenant_a');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});

describe('production CORS guard', () => {
  test('createCorsMiddleware throws when CORS_ORIGINS is "*" in production', () => {
    expect(() =>
      createCorsMiddleware({ NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  test('createCorsMiddleware throws when CORS_ORIGINS is empty in production', () => {
    expect(() =>
      createCorsMiddleware({ NODE_ENV: 'production', CORS_ORIGINS: ' , ' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  test('createCorsMiddleware accepts explicit origins in production', () => {
    expect(() =>
      createCorsMiddleware({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com,https://www.example.com',
      }),
    ).not.toThrow();
  });

  test('collectEnvErrors rejects "*" and empty lists in production', () => {
    const base = {
      NODE_ENV: 'production',
      ADMIN_API_KEY: 'a-sufficiently-long-admin-key',
      DATA_FILE: 'data.json',
    };
    for (const cors of ['*', '', 'https://a.example,*']) {
      const errors = collectEnvErrors({ ...base, CORS_ORIGINS: cors });
      expect(errors.map((e) => e.key)).toContain('CORS_ORIGINS');
    }
  });

  test('collectEnvErrors still allows "*" outside production', () => {
    const errors = collectEnvErrors({
      NODE_ENV: 'development',
      ADMIN_API_KEY: 'a-sufficiently-long-admin-key',
      DATA_FILE: 'data.json',
      CORS_ORIGINS: '*',
    });
    expect(errors.map((e) => e.key)).not.toContain('CORS_ORIGINS');
  });
});

describe('entrypoint wiring', () => {
  test('both entrypoints use the shared CORS middleware', () => {
    for (const file of ['index.js', 'src/app.js']) {
      const source = readFileSync(resolve(BACKEND_DIR, file), 'utf8');
      expect(source).toContain('createCorsMiddleware');
      expect(source).not.toMatch(/cors\(\{/);
    }
  });
});
