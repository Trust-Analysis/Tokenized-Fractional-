/**
 * Express Middleware for Input Sanitization
 * 
 * Intercepts incoming HTTP requests and sanitizes body, query, and params.
 */

import { sanitizationService } from '../services/sanitizationService.js';

export function requireSanitization(req, res, next) {
  try {
    // Sanitize Request Body
    if (req.body && Object.keys(req.body).length > 0) {
      const { sanitized, isSuspicious } = sanitizationService.sanitizePayload(req.body, 'http_body');
      req.body = sanitized;
      
      // Optional: Reject request entirely if strict mode is desired
      if (isSuspicious && process.env.STRICT_SANITIZATION === 'true') {
        return res.status(400).json({ error: 'Invalid input: Suspicious characters detected' });
      }
    }

    // Sanitize Query Parameters
    if (req.query && Object.keys(req.query).length > 0) {
      const { sanitized } = sanitizationService.sanitizePayload(req.query, 'http_query');
      req.query = sanitized;
    }

    // Sanitize URL Parameters
    if (req.params && Object.keys(req.params).length > 0) {
      const { sanitized } = sanitizationService.sanitizePayload(req.params, 'http_params');
      req.params = sanitized;
    }

    next();
  } catch (error) {
    next(error);
  }
}
