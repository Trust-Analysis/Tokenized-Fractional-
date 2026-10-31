// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/sanitization.test.js — Strict XSS Prevention Tests
 *
 * Verifies that user-generated content (profile bios, names, forum posts,
 * arbitrary string inputs) is strictly sanitized with DOMPurify + encoding
 * before it can be persisted to the database.
 *
 * Each test runs a well-known XSS attack vector and asserts that the
 * resulting output contains no executable/active payload.
 */

import { sanitizationService } from '../src/services/sanitizationService.js';
import { requireSanitization } from '../src/middleware/sanitizationMiddleware.js';
import { resolvers } from '../services/users/resolvers.js';

const { updateUserProfile } = resolvers.Mutation;

describe('SanitizationService — HTML sanitization (DOMPurify)', () => {
  const expectInert = (input) => {
    const out = sanitizationService.sanitizeHtml(input);
    expect(out).toBeDefined();
    // Active/executable payloads must never survive.
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/onerror\s*=/i);
    expect(out).not.toMatch(/onload\s*=/i);
    expect(out).not.toMatch(/onclick\s*=/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object/i);
    expect(out).not.toMatch(/<embed/i);
    expect(out).not.toContain('<style');
    expect(out).not.toContain('srcdoc');
    expect(out).not.toMatch(/data:text\/html/i);
    return out;
  };

  test('strips <script>alert(1)</script>', () => {
    expectInert('<script>alert(document.cookie)</script>');
  });

  test('strips <img onerror="..."> payloads', () => {
    expectInert('<img src=x onerror="alert(1)">');
  });

  test('strips <a href="javascript:..."> protocol smuggling', () => {
    const out = expectInert('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  test('strips data:text/html based payloads', () => {
    expectInert('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
  });

  test('strips inline event handlers on safe tags', () => {
    expectInert('<p onclick="alert(1)">hello</p>');
  });

  test('strips <svg onload> payloads', () => {
    expectInert('<svg onload=alert(1)>');
  });

  test('strips malformed / obfuscated script tags (case-insensitive)', () => {
    expectInert('<ScRiPt>alert(1)</ScRiPt>');
    expectInert('<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>');
  });

  test('strips <iframe srcdoc> embedded script', () => {
    expectInert('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>');
  });

  test('strips <style> based CSS exfiltration / expression payloads', () => {
    expectInert('<style>@import url(https://evil.example/x.css);</style>');
  });

  test('strips <object> and <embed> payloads', () => {
    expectInert('<object data="data:text/html;base64,PHNjcmlwdD4="></object>');
    expectInert('<embed src="javascript:alert(1)">');
  });

  test('preserves safe rich-text formatting for bios', () => {
    const out = sanitizationService.sanitizeHtml('<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>');
    expect(out).toContain('<p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('https://example.com');
    expect(out).not.toContain('<script');
  });

  test('provides inert output for empty or non-string values', () => {
    expect(sanitizationService.sanitizeHtml('')).toBe('');
    expect(sanitizationService.sanitizeHtml(null)).toBeNull();
    expect(sanitizationService.sanitizeHtml(undefined)).toBeUndefined();
    expect(sanitizationService.sanitizeHtml(42)).toBe(42);
  });
});

describe('SanitizationService — payload deep-sanitization', () => {
  test('sanitizes nested objects and arrays before persistence', () => {
    const { sanitized } = sanitizationService.sanitizePayload({
      bio: '<script>alert(1)</script>',
      tags: ['<b onclick="x">ok</b>', 'plain'],
      nested: { comment: '<img src=x onerror=alert(1)>' },
    });

    expect(sanitized.bio).not.toMatch(/<script/i);
    expect(sanitized.tags[0]).not.toMatch(/onclick/i);
    expect(sanitized.nested.comment).not.toMatch(/onerror/i);
  });

  test('flags payloads containing known injection signatures', () => {
    const { isSuspicious } = sanitizationService.sanitizePayload({
      field: '<script>alert(1)</script>',
    });
    expect(isSuspicious).toBe(true);
  });

  test('prevents prototype pollution via __proto__ keys', () => {
    const { sanitized } = sanitizationService.sanitizePayload({
      __proto__: { polluted: true },
      safe: 'value',
    });
    expect(sanitized.polluted).toBeUndefined();
    expect(sanitized.safe).toBe('value');
  });
});

describe('SanitizationService — plain-text escaping', () => {
  test('escapes special characters in plain-text fields', () => {
    expect(sanitizationService.sanitizeString('<script>alert(1)</script>')).not.toContain('<script');
    expect(sanitizationService.sanitizeString('"><img src=x onerror=alert(1)>')).not.toMatch(/onerror/i);
  });

  test('truncates over-long input to the configured maximum', () => {
    const long = 'a'.repeat(20000);
    expect(sanitizationService.sanitizeString(long).length).toBeLessThanOrEqual(10000);
  });

  test('passes through non-string values unchanged', () => {
    expect(sanitizationService.sanitizeString(123)).toBe(123);
    expect(sanitizationService.sanitizeString(null)).toBeNull();
  });
});

describe('requireSanitization middleware', () => {
  test('sanitizes incoming request body before handler runs', () => {
    const req = { body: { profile: { bio: '<script>alert(1)</script><b>hi</b>' } } };
    let nextCalled = false;

    requireSanitization(req, {}, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.body.profile.bio).not.toMatch(/<script/i);
    expect(req.body.profile.bio).toContain('<b>');
  });

  test('handles requests without a body gracefully', () => {
    const req = { body: {}, query: {}, params: {} };
    let nextCalled = false;
    requireSanitization(req, {}, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('rejects requests entirely in strict mode when suspicious', () => {
    process.env.STRICT_SANITIZATION = 'true';
    const req = { body: { payload: '<script>alert(1)</script>' } };
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(d) { this.body = d; return this; } };
    let nextCalled = false;

    requireSanitization(req, res, () => { nextCalled = true; });

    expect(res.statusCode).toBe(400);
    expect(nextCalled).toBe(false);
    process.env.STRICT_SANITIZATION = 'false';
  });
});

describe('updateUserProfile — stored XSS prevention on profile persistence', () => {
  const userId = 'U1234567890123456789012345678901234567890123456789012345678';

  test('sanitizes bio before persisting', () => {
    const result = updateUserProfile(null, {
      userId,
      input: { bio: '<script>alert(1)</script><p>Safe bio</p>' },
    }, {});
    expect(result.profile.bio).not.toMatch(/<script/i);
    expect(result.profile.bio).toContain('Safe bio');
  });

  test('escapes markup in display name before persisting', () => {
    const result = updateUserProfile(null, {
      userId,
      input: { displayName: '<img src=x onerror=alert(1)>' },
    }, {});
    expect(result.profile.displayName).not.toMatch(/<img/i);
    expect(result.profile.displayName).not.toMatch(/onerror/i);
  });

  test('throws for unknown users without persisting anything', () => {
    expect(() => updateUserProfile(null, { userId: 'UNKNOWN', input: { bio: 'x' } }, {}))
      .toThrow('User not found');
  });
});
