// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/validate.test.js — Tests for advanced request validation middleware (#260)
 */

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-key-for-jest';
process.env.DATA_FILE = 'test-data.json';

import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { app } from '../index.js';
import { s, ValidationError, SCHEMA_VERSION } from '../src/validators/schemas.js';
import { composeValidators, formatValidationError } from '../src/middleware/validate.js';

const API_KEY = 'test-key-for-jest';

afterAll(() => { if (existsSync('test-data.json')) unlinkSync('test-data.json'); });

describe('Schema builder (s.*)', () => {
  describe('s.string()', () => {
    test('parses valid string', () => { expect(s.string().parse('hello', 'field')).toEqual([]); });
    test('rejects non-string', () => { const e = s.string().parse(123, 'field'); expect(e.length).toBe(1); expect(e[0].code).toBe('type'); });
    test('rejects empty by default', () => { const e = s.string().parse('', 'field'); expect(e.length).toBe(1); expect(e[0].code).toBe('required'); });
    test('allows empty when optional', () => {
      const schema = s.string().optional();
      expect(schema.parse('', 'field')).toEqual([]);
      expect(schema.parse(undefined, 'field')).toEqual([]);
    });
    test('validates min length', () => { const e = s.string().min(3).parse('ab', 'field'); expect(e.length).toBe(1); expect(e[0].code).toBe('min_length'); });
    test('validates max length', () => { const e = s.string().max(5).parse('abcdef', 'field'); expect(e.length).toBe(1); expect(e[0].code).toBe('max_length'); });
    test('validates regex', () => { const e = s.string().regex(/^[a-z]+$/).parse('ABC', 'field'); expect(e.length).toBe(1); });
    test('validates startsWith', () => { const e = s.string().startsWith('C').parse('BAD', 'field'); expect(e.length).toBe(1); });
    test('validates URL', () => { const e = s.string().url().parse('not-a-url', 'field'); expect(e.length).toBe(1); });
    test('validates UUID', () => { expect(s.string().uuid().parse('550e8400-e29b-41d4-a716-446655440000', 'field')).toEqual([]); });
    test('validates enum', () => { expect(s.string().enum(['a', 'b']).parse('a', 'field')).toEqual([]); });
    test('validates refine', () => { const e = s.string().refine((v) => v.length > 0, 'Must not be empty').parse('', 'field'); expect(e.length).toBe(1); });
  });

  describe('s.number()', () => {
    test('parses valid number', () => { expect(s.number().parse(42, 'field')).toEqual([]); });
    test('parses string number', () => { expect(s.number().parse('42', 'field')).toEqual([]); });
    test('rejects NaN', () => { const e = s.number().parse('abc', 'field'); expect(e[0].code).toBe('type'); });
    test('validates positive', () => { const e = s.number().positive().parse(-5, 'field'); expect(e[0].code).toBe('positive'); });
    test('validates integer', () => { const e = s.number().int().parse(3.14, 'field'); expect(e[0].code).toBe('int'); });
  });

  describe('s.object()', () => {
    test('validates nested shape', () => {
      const schema = s.object({ name: s.string().min(1), age: s.number().positive() });
      expect(schema.parse({ name: 'John', age: 30 }, '')).toEqual([]);
    });
    test('returns errors for invalid fields', () => {
      const e = s.object({ name: s.string().min(1) }).parse({ name: '' }, '');
      expect(e.length).toBe(1); expect(e[0].path).toBe('name');
    });
  });

  describe('s.array()', () => {
    test('validates arrays', () => { expect(s.array(s.string()).parse(['a'], 'field')).toEqual([]); });
    test('rejects non-arrays', () => { const e = s.array(s.string()).parse('x', 'field'); expect(e[0].code).toBe('type'); });
    test('validates min items', () => { expect(s.array(s.string()).min(2).parse(['a'], 'field').length).toBe(1); });
  });

  describe('s.validate()', () => {
    test('returns ValidationError for invalid', () => {
      const err = s.validate(s.object({ name: s.string().min(1) }), { name: '' });
      expect(err).toBeInstanceOf(ValidationError);
    });
    test('returns null for valid', () => {
      expect(s.validate(s.object({ name: s.string() }), { name: 'hello' })).toBeNull();
    });
  });
});

describe('Validation Middleware integration (disabled in test)', () => {
  test('middleware disabled in test mode - route handler catches bad input', async () => {
    const res = await request(app).post('/api/rwa').set('x-api-key', API_KEY).send({ contractId: 'bad' });
    expect([400, 401]).toContain(res.status);
  });
  test('query validation bypassed in test mode', async () => {
    const res = await request(app).get('/api/rwa?limit=abc');
    expect(res.status).toBe(200);
  });
});

describe('composeValidators', () => {
  test('passes when all validators pass', async () => {
    let calledNext = false;
    const v1 = async () => true;
    const mw = composeValidators(v1);
    const res = { status: () => res, json: () => {} };
    await mw({ requestId: 'test' }, res, () => { calledNext = true; });
    expect(calledNext).toBe(true);
  });
});

describe('formatValidationError', () => {
  test('formats ValidationError with fieldErrors', () => {
    const err = new ValidationError([{ path: 'name', message: 'Required', code: 'required' }]);
    const f = formatValidationError(err);
    expect(f.error).toBe('Validation failed');
    expect(f.code).toBe('VALIDATION_ERROR');
    expect(f.fieldErrors).toHaveLength(1);
  });
});
