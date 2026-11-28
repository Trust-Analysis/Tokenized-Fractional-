/**
 * Comprehensive Input Sanitization Service
 *
 * Handles XSS prevention, HTML allowlisting via DOMPurify, special character
 * encoding, injection heuristics (foundation for ML-based detection), and
 * audit logging.
 *
 * All user-generated string inputs are sanitized here BEFORE they are
 * persisted to the database, closing the common stored-XSS attack surface.
 */

import validator from 'validator';
import { performance } from 'perf_hooks';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

// Sanitization Rule Configuration
const SANITIZATION_RULES = {
  maxStringLength: 10000,
  allowlistedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'li', 'ol'],
  allowlistedAttributes: ['href', 'title', 'target'],
  // Overrides applied on top of DOMPurify defaults to lock down attributes.
  hookOverrides: {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  },
};

// Lazily initialise the DOMPurify instance. JSDOM provides the `window`
// environment required by DOMPurify on the backend; it is created once and
// reused across all sanitization calls for performance.
let dompurifyInstance = null;

function getDOMPurify() {
  if (dompurifyInstance) return dompurifyInstance;

  const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const purify = createDOMPurify(window);

  // Keep hook overrides in sync with the allowlisted configuration.
  purify.setConfig({
    ADD_TAGS: [],
    ADD_ATTR: [],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction', 'srcdoc', 'xlink:href', 'data', 'dynsrc'],
    ALLOW_DATA_ATTR: false,
  });

  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'href' || data.attrName === 'src') {
      // Strip javascript:, data:, and vbscript: URIs explicitly.
      if (!SANITIZATION_RULES.hookOverrides.ALLOWED_URI_REGEXP.test(data.attrValue || '')) {
        data.keepAttr = false;
      }
    }
  });

  dompurifyInstance = purify;
  return purify;
}

export class SanitizationService {
  constructor(logger) {
    this.logger = logger || console;
  }

  /**
   * DOMPurify HTML Sanitization.
   *
   * Sanitizes rich-text / HTML user-generated content (profile bios, forum
   * posts, comments, display names) by stripping disallowed tags and
   * attributes while preserving safe formatting tags.
   */
  sanitizeHtml(input, options = {}) {
    if (typeof input !== 'string') return input;

    const truncated = input.substring(0, SANITIZATION_RULES.maxStringLength);
    const purify = getDOMPurify();

    const result = purify.sanitize(truncated, {
      ALLOWED_TAGS: SANITIZATION_RULES.allowlistedTags,
      ALLOWED_ATTR: SANITIZATION_RULES.allowlistedAttributes,
      ...options,
    });

    // Normalise empty results so we never persist an "undefined" string.
    return typeof result === 'string' ? result.trim() : '';
  }

  /**
   * Basic String Sanitization & Encoding
   *
   * Used for plain-text fields that must not carry any HTML (URLs that are
   * not intended to render as rich text, wallet addresses, IDs, etc).
   */
  sanitizeString(input, maxLength = SANITIZATION_RULES.maxStringLength) {
    if (typeof input !== 'string') return input;

    // Length validation
    const truncated = input.substring(0, maxLength);

    // Encode special characters to prevent XSS in standard text fields
    return validator.escape(truncated);
  }

  /**
   * Heuristic/ML-Foundation Injection Detection
   * Analyzes payloads for SQLi, XSS, or NoSQL injection signatures.
   */
  detectInjection(input) {
    if (typeof input !== 'string') return false;

    // Heuristic signatures (Foundation for ML model feature extraction)
    const sqlInjectionPatterns = /(\b(SELECT|UPDATE|DELETE|INSERT|DROP|UNION)\b)|(['"]\s*OR\s*['"]\d['"]\s*=\s*['"]\d)/i;
    const xssPatterns = /(<script.*?>.*?<\/script>)|(javascript:)|(onerror=)|(onload=)/i;
    const noSqlPatterns = /(\$where)|(\$ne)|(\$gt)|(\$regex)/i;

    return sqlInjectionPatterns.test(input) ||
           xssPatterns.test(input) ||
           noSqlPatterns.test(input);
  }

  /**
   * Deep object sanitization for HTTP bodies, WebSocket messages, and
   * any structured payload destined for the database.
   *
   * Strings that contain HTML markup are routed through DOMPurify
   * (sanitizeHtml); all other strings are HTML-escaped plain text.
   */
  sanitizePayload(payload, vector = 'http') {
    const startTime = performance.now();
    let isSuspicious = false;

    const looksLikeHtml = (str) => /<[a-z/][^>]*>/i.test(str);

    const sanitizeRecursive = (obj) => {
      if (obj === null || obj === undefined) return obj;

      if (typeof obj === 'string') {
        if (this.detectInjection(obj)) {
          isSuspicious = true;
          this.logger.warn({ vector, payloadSnippet: obj.substring(0, 50) }, 'Suspicious injection signature detected');
        }
        // Route HTML-shaped strings through DOMPurify to neutralise stored XSS.
        return looksLikeHtml(obj) ? this.sanitizeHtml(obj) : this.sanitizeString(obj);
      }

      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeRecursive(item));
      }

      if (typeof obj === 'object') {
        const sanitizedObj = {};
        for (const [key, value] of Object.entries(obj)) {
          // Prevent prototype pollution
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
          sanitizedObj[key] = sanitizeRecursive(value);
        }
        return sanitizedObj;
      }

      return obj;
    };

    const sanitized = sanitizeRecursive(payload);
    const executionTime = performance.now() - startTime;

    // Performance Monitoring & Audit Logging
    if (executionTime > 50) {
      this.logger.warn({ vector, executionTime }, 'Sanitization performance degraded');
    }

    if (isSuspicious) {
      this.logger.warn({ vector, executionTime }, 'Sanitization audit: High-risk payload processed');
    }

    return { sanitized, isSuspicious };
  }
}

export const sanitizationService = new SanitizationService();
