// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Database Query Tracing
 * 
 * Wraps database operations (PostgreSQL, Redis) with OpenTelemetry spans
 * Captures query duration, affected rows, and errors
 */

import { trace, context } from '@opentelemetry/api';

const tracer = trace.getTracer('database-tracing');

/**
 * Wrap PostgreSQL query with tracing
 */
export function wrapPostgresQuery(client, queryFn) {
  return async function tracedQuery(sql, params = []) {
    // Extract table name and operation from SQL
    const { operation, table } = parseSqlStatement(sql);
    const spanName = `db.${operation}.${table}`;

    const span = tracer.startSpan(spanName, {
      attributes: {
        'db.system': 'postgres',
        'db.operation': operation,
        'db.statement': maskSensitiveData(sql),
        'db.param_count': params.length,
        'db.table': table,
      },
    });

    const startTime = Date.now();

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => queryFn.call(client, sql, params)
      );

      const duration = Date.now() - startTime;
      span.setAttributes({
        'db.duration_ms': duration,
        'db.rows_affected': result?.rowCount || result?.length || 0,
        'db.success': true,
      });

      span.addEvent('db_query_success', {
        'duration_ms': duration,
        'rows': result?.rowCount || result?.length || 0,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      span.setAttributes({
        'db.duration_ms': duration,
        'db.error': true,
        'error.type': error.code || error.name,
      });

      span.recordException(error);
      span.setStatus({ code: 2 }); // ERROR

      span.addEvent('db_query_error', {
        'error': error.message,
        'error_code': error.code,
        'duration_ms': duration,
      });

      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Wrap Redis operation with tracing
 */
export function wrapRedisOperation(command, key, operation = 'call') {
  const spanName = `redis.${command}`;

  const span = tracer.startSpan(spanName, {
    attributes: {
      'db.system': 'redis',
      'redis.command': command,
      'redis.key': maskSensitiveKey(key),
    },
  });

  return {
    start: () => {
      span.setAttribute('redis.start_time', Date.now());
    },
    end: (error = null, result = null) => {
      const startTime = span.getAttribute('redis.start_time');
      const duration = Date.now() - startTime;

      if (error) {
        span.recordException(error);
        span.setStatus({ code: 2 });
        span.setAttribute('redis.error', error.message);
      } else {
        span.setAttribute('redis.result', serializeRedisResult(result));
      }

      span.setAttribute('redis.duration_ms', duration);
      span.end();
    },
  };
}

/**
 * Wrap Knex query builder
 */
export function wrapKnexBuilder(builder) {
  const originalThen = builder.then;
  const originalCatch = builder.catch;

  builder.then = function(...args) {
    const sql = this.toString();
    const { operation, table } = parseSqlStatement(sql);
    const spanName = `db.${operation}.${table}`;

    const span = tracer.startSpan(spanName, {
      attributes: {
        'db.system': 'postgres',
        'db.operation': operation,
        'db.statement': maskSensitiveData(sql),
        'db.table': table,
      },
    });

    const startTime = Date.now();

    const wrappedResolve = (result) => {
      const duration = Date.now() - startTime;
      span.setAttributes({
        'db.duration_ms': duration,
        'db.rows_affected': Array.isArray(result) ? result.length : 0,
      });
      span.end();
      return result;
    };

    const wrappedReject = (error) => {
      const duration = Date.now() - startTime;
      span.recordException(error);
      span.setStatus({ code: 2 });
      span.setAttribute('db.duration_ms', duration);
      span.end();
      throw error;
    };

    return context.with(
      trace.setSpan(context.active(), span),
      () => originalThen.call(this, wrappedResolve, wrappedReject, ...args.slice(2))
    );
  };

  return builder;
}

/**
 * Parse SQL statement to extract operation and table
 */
function parseSqlStatement(sql) {
  if (!sql) return { operation: 'unknown', table: 'unknown' };

  const normalized = sql.trim().toUpperCase();

  // Extract operation
  let operation = 'query';
  if (normalized.startsWith('SELECT')) operation = 'select';
  else if (normalized.startsWith('INSERT')) operation = 'insert';
  else if (normalized.startsWith('UPDATE')) operation = 'update';
  else if (normalized.startsWith('DELETE')) operation = 'delete';
  else if (normalized.startsWith('CALL')) operation = 'procedure';

  // Extract table name
  let table = 'unknown';
  const tableMatch = sql.match(/(?:FROM|INTO|UPDATE|TABLE)\s+(["\`]?)(\w+)\1/i);
  if (tableMatch) {
    table = tableMatch[2];
  }

  return { operation, table };
}

/**
 * Mask sensitive data in SQL statements
 */
function maskSensitiveData(sql) {
  if (!sql || sql.length > 500) {
    return sql?.substring(0, 500) || '';
  }

  // Mask values in common patterns
  return sql
    .replace(/VALUES\s*\([^)]+\)/gi, 'VALUES (...)')
    .replace(/SET\s+[^=]+=[^,;]+/gi, 'SET ...')
    .replace(/WHERE\s+[^;]+$/i, 'WHERE ...');
}

/**
 * Mask sensitive Redis keys
 */
function maskSensitiveKey(key) {
  if (!key) return 'unknown';

  const sensitivePatterns = ['token', 'password', 'secret', 'key', 'credential', 'auth'];
  const lowerKey = key.toLowerCase();

  if (sensitivePatterns.some(pattern => lowerKey.includes(pattern))) {
    return key.substring(0, 10) + '...';
  }

  return key;
}

/**
 * Serialize Redis result for tracing
 */
function serializeRedisResult(result) {
  if (!result) return 'null';
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  if (Array.isArray(result)) {
    return `array[${result.length}]`;
  }
  if (typeof result === 'object') {
    return 'object';
  }
  return typeof result;
}

/**
 * Wrap a promise chain with database tracing
 */
export function withDatabaseTrace(operationName, operation = 'query') {
  return async (fn) => {
    const span = tracer.startSpan(`db.${operation}.${operationName}`, {
      attributes: {
        'db.system': 'postgres',
        'db.operation': operation,
        'db.name': operationName,
      },
    });

    const startTime = Date.now();

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => fn()
      );

      span.setAttribute('db.duration_ms', Date.now() - startTime);
      span.setAttribute('db.success', true);

      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2 });
      span.setAttribute('db.duration_ms', Date.now() - startTime);
      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Batch database operations with tracing
 */
export async function withBatchDatabaseTrace(operationName, operations) {
  const span = tracer.startSpan(`db.batch.${operationName}`, {
    attributes: {
      'db.system': 'postgres',
      'db.operation': 'batch',
      'db.batch_size': operations.length,
    },
  });

  const startTime = Date.now();

  try {
    const results = await context.with(
      trace.setSpan(context.active(), span),
      () => Promise.all(operations)
    );

    span.setAttribute('db.duration_ms', Date.now() - startTime);
    span.setAttribute('db.batch_success_count', results.length);

    return results;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2 });
    span.setAttribute('db.duration_ms', Date.now() - startTime);
    throw error;
  } finally {
    span.end();
  }
}
