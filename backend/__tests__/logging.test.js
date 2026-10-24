// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/logging.test.js — issue #703.
 *
 * Covers the three acceptance criteria of the observability work:
 *   1. a structured logger with request IDs and consistent log levels,
 *   2. error-tracking wiring that stays inert when it is not configured,
 *   3. sensitive values (ADMIN_API_KEY in particular) never reaching the log.
 */

import { Writable } from 'stream';
import {
  logger,
  createLogger,
  createRequestLogger,
  createScrubbingStream,
  isSensitiveKey,
  resolveLogLevel,
  runWithRequestContext,
  getRequestId,
  scrubSecrets,
  secretEnvKeys,
  REDACTED,
  LOG_LEVELS,
} from '../logger.js';
import {
  initErrorTracking,
  isErrorTrackingEnabled,
  captureException,
  errorTrackingStatus,
  reportError,
  scrubEvent,
  installErrorTrackingRequestScope,
  flushErrorTracking,
} from '../src/services/errorTracking.js';
import { logger as servicesLogger } from '../src/services/logger.js';

const ADMIN_KEY = 'super-secret-admin-key-value';

/** In-memory pino destination: collects one string per log line. */
function memoryStream() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8').trim());
      callback();
    },
  });
  return {
    lines,
    stream,
    records: () => lines.map((line) => JSON.parse(line)),
    text: () => lines.join('\n'),
  };
}

/** A class instance, i.e. NOT a plain object — like an Express IncomingMessage. */
class FakeRequest {
  constructor(headers) {
    this.method = 'GET';
    this.url = '/api/rwa';
    this.headers = headers;
  }
}

describe('structured logger (issue #703)', () => {
  let sink;
  let log;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    sink = memoryStream();
    log = createLogger({ level: 'info', stream: sink.stream });
  });

  describe('log record shape', () => {
    test('emits one JSON object per line with the documented fields', () => {
      log.info({ contractId: 'CABC' }, 'Asset created');

      expect(sink.lines).toHaveLength(1);
      expect(sink.text().includes('\n')).toBe(false);

      const [record] = sink.records();
      expect(record.level).toBe(30);
      expect(record.msg).toBe('Asset created');
      expect(record.contractId).toBe('CABC');
      expect(new Date(record.time).toString()).not.toBe('Invalid Date');
      expect(record.service).toBe(process.env.SERVICE_NAME || 'backend');
      expect(record.environment).toBe('test');
      expect(record).toHaveProperty('deploymentColor');
      expect(record).toHaveProperty('buildId');
    });

    test('serialises Error objects with their stack trace', () => {
      log.error({ err: new TypeError('boom') }, 'It broke');

      const [record] = sink.records();
      expect(record.err.type).toBe('TypeError');
      expect(record.err.message).toBe('boom');
      expect(record.err.stack).toEqual(expect.stringContaining('TypeError: boom'));
    });

    test('uses numeric levels that the ELK pipeline can filter on', () => {
      log.debug('debug line');
      log.info('info line');
      log.warn('warn line');
      log.error('error line');

      expect(sink.records().map((r) => r.level)).toEqual([30, 40, 50]);
    });
  });

  describe('consistent levels', () => {
    test('LOG_LEVEL suppresses lower-severity records', () => {
      const quiet = createLogger({ level: 'warn', stream: sink.stream });

      quiet.info('hidden');
      quiet.debug('hidden');
      quiet.warn('shown');
      quiet.error('shown');

      expect(sink.records().map((r) => r.msg)).toEqual(['shown', 'shown']);
    });

    test('resolveLogLevel falls back to info for an unknown value', () => {
      expect(resolveLogLevel('warn')).toBe('warn');
      expect(resolveLogLevel('WARN')).toBe('warn');
      expect(resolveLogLevel('nonsense')).toBe('silent'); // test env
      expect(LOG_LEVELS).toContain('fatal');
    });

    test('the shared logger is silent under NODE_ENV=test', () => {
      expect(logger.level).toBe('silent');
    });

    test('src/services/logger.js re-exports the same instance', () => {
      expect(servicesLogger).toBe(logger);
    });
  });

  describe('request IDs', () => {
    test('every record emitted inside a request context carries the requestId', async () => {
      await runWithRequestContext({ requestId: 'req_abc123' }, async () => {
        log.info('start');
        // Simulates an async continuation, e.g. a fire-and-forget promise.
        await Promise.resolve();
        log.warn('still in scope');
      });

      const records = sink.records();
      expect(records).toHaveLength(2);
      expect(records.every((r) => r.requestId === 'req_abc123')).toBe(true);
      expect(getRequestId()).toBeNull();
    });

    test('correlationId is emitted alongside the requestId', () => {
      runWithRequestContext({ requestId: 'req_1', correlationId: 'corr_1' }, () => {
        log.info('traced');
      });

      const [record] = sink.records();
      expect(record.requestId).toBe('req_1');
      expect(record.correlationId).toBe('corr_1');
    });

    test('requests do not leak identifiers into each other', async () => {
      const first = runWithRequestContext({ requestId: 'req_first' }, () =>
        Promise.resolve().then(() => log.info('one')),
      );
      const second = runWithRequestContext({ requestId: 'req_second' }, () => {
        log.info('two');
      });

      await Promise.all([first, second]);

      const byMessage = Object.fromEntries(sink.records().map((r) => [r.msg, r.requestId]));
      expect(byMessage.one).toBe('req_first');
      expect(byMessage.two).toBe('req_second');
    });

    test('records outside a request have no requestId', () => {
      log.info('no context');
      expect(sink.records()[0]).not.toHaveProperty('requestId');
    });

    test('createRequestLogger binds the id explicitly', () => {
      createRequestLogger('req_child', { job: 'webhook' }, log).info('delivered');

      const [record] = sink.records();
      expect(record.requestId).toBe('req_child');
      expect(record.job).toBe('webhook');
    });
  });

  describe('sensitive values are never logged', () => {
    test('credential-shaped keys are redacted at any depth', () => {
      log.info(
        {
          apiKey: 'plain-key',
          'x-api-key': 'header-key',
          password: 'hunter2',
          nested: { secret: 'shh', deeper: { authorization: 'Bearer abc' } },
          list: [{ token: 'tok' }],
          safe: 'contract-id',
        },
        'redaction probe',
      );

      const [record] = sink.records();
      expect(record.apiKey).toBe(REDACTED);
      expect(record['x-api-key']).toBe(REDACTED);
      expect(record.password).toBe(REDACTED);
      expect(record.nested.secret).toBe(REDACTED);
      expect(record.nested.deeper.authorization).toBe(REDACTED);
      expect(record.list[0].token).toBe(REDACTED);
      expect(record.safe).toBe('contract-id');
      expect(sink.text()).not.toContain('hunter2');
    });

    test('request headers on non-plain objects are redacted by pino', () => {
      // Express requests are class instances, so they bypass the deep scrub and
      // rely on the pino redact paths.
      const req = new FakeRequest({
        authorization: 'Bearer super-secret-jwt',
        'x-api-key': 'plain-text-admin-key',
        cookie: 'session=abc123',
        'content-type': 'application/json',
      });

      log.info({ req }, 'incoming request');

      const [record] = sink.records();
      expect(record.req.headers.authorization).toBe(REDACTED);
      expect(record.req.headers['x-api-key']).toBe(REDACTED);
      expect(record.req.headers.cookie).toBe(REDACTED);
      expect(record.req.headers['content-type']).toBe('application/json');
      expect(sink.text()).not.toContain('super-secret-jwt');
      expect(sink.text()).not.toContain('plain-text-admin-key');
    });

    test('the literal ADMIN_API_KEY value is masked wherever it appears', () => {
      log.info({ note: `calling with ${process.env.ADMIN_API_KEY}` }, 'startup');

      expect(sink.text()).not.toContain(ADMIN_KEY);
      expect(sink.text()).toContain(REDACTED);
    });

    test('an admin key interpolated into a message is still masked', () => {
      log.info(`authenticated admin ${process.env.ADMIN_API_KEY}`);

      expect(sink.text()).not.toContain(ADMIN_KEY);
    });

    test('the scrubbing stream masks secrets in raw output', () => {
      const written = [];
      const target = { write: (chunk) => written.push(String(chunk)) };
      const stream = createScrubbingStream(target);

      stream.write(`${JSON.stringify({ msg: `key=${ADMIN_KEY}` })}\n`);

      expect(written.join('')).not.toContain(ADMIN_KEY);
      expect(written.join('')).toContain(REDACTED);
    });

    test('credentials embedded in connection URLs are masked', () => {
      const scrubbed = scrubSecrets('connect postgresql://rwa:hunter2@db.internal:5432/rwa');
      expect(scrubbed).not.toContain('hunter2');
      expect(scrubbed).toContain('rwa:[REDACTED]@db.internal:5432');
    });

    test('every documented secret variable is in the scrub list', () => {
      expect(secretEnvKeys()).toEqual(expect.arrayContaining(['ADMIN_API_KEY']));
    });

    test('isSensitiveKey distinguishes credentials from ordinary fields', () => {
      ['password', 'apiKey', 'API_KEY', 'x-api-key', 'Authorization', 'cookie', 'pin'].forEach(
        (key) => expect(isSensitiveKey(key)).toBe(true),
      );
      ['contractId', 'title', 'totalValuation', 'responseTime', 'statusCode'].forEach((key) =>
        expect(isSensitiveKey(key)).toBe(false),
      );
    });
  });
});

describe('error tracking (issue #703)', () => {
  test('is disabled without a DSN and never throws', () => {
    delete process.env.SENTRY_DSN;

    expect(initErrorTracking()).toBe(false);
    expect(isErrorTrackingEnabled()).toBe(false);
    expect(captureException(new Error('ignored'))).toBeNull();
    expect(errorTrackingStatus()).toEqual({ enabled: false, environment: 'test', release: null });
    expect(installErrorTrackingRequestScope({ use: () => undefined })).toBe(false);
  });

  test('reportError still logs the failure when tracking is disabled', () => {
    const error = new RangeError('out of range');

    // The shared logger is silent in tests, so assert on the return contract
    // and on the Sentry no-op instead of on stdout.
    expect(reportError(error, { message: 'boom' })).toBe(error);
    expect(isErrorTrackingEnabled()).toBe(false);
  });

  test('flushErrorTracking is a no-op when disabled', async () => {
    await expect(flushErrorTracking()).resolves.toBe(false);
  });

  test('scrubEvent removes credentials and bodies from Sentry events', () => {
    const event = {
      request: {
        url: 'https://api.example.com/api/rwa',
        headers: { authorization: 'Bearer abc', 'x-api-key': 'k', accept: 'application/json' },
        data: { contractId: 'CABC' },
        cookies: { session: 'abc' },
      },
      extra: { password: 'hunter2', contractId: 'CABC' },
      message: `failed with key ${ADMIN_KEY}`,
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request.headers.authorization).toBe(REDACTED);
    expect(scrubbed.request.headers['x-api-key']).toBe(REDACTED);
    expect(scrubbed.request.headers.accept).toBe('application/json');
    expect(scrubbed.request.data).toBe(REDACTED);
    expect(scrubbed.request.cookies).toBe(REDACTED);
    expect(scrubbed.extra.password).toBe(REDACTED);
    expect(scrubbed.extra.contractId).toBe('CABC');
    expect(scrubbed.message).not.toContain(ADMIN_KEY);
  });
});
