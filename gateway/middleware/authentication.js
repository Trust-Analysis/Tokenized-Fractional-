/**
 * Gateway Authentication Middleware
 * Supports API Key, JWT, and OAuth 2.0
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * API Key validation middleware
 */
export function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API key in X-API-Key header',
      code: 'MISSING_API_KEY',
      requestId: req.requestId,
    });
  }

  // Validate API key format
  if (!/^[a-zA-Z0-9\-_]{32,}$/.test(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key format',
      code: 'INVALID_API_KEY_FORMAT',
      requestId: req.requestId,
    });
  }

  // Check against stored API keys (implement with database in production)
  const validKeys = process.env.VALID_API_KEYS?.split(',') || [];
  if (!validKeys.includes(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
      code: 'INVALID_API_KEY',
      requestId: req.requestId,
    });
  }

  // Attach user context
  req.auth = {
    method: 'api-key',
    apiKey,
    userId: crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16),
  };

  next();
}

/**
 * JWT token validation middleware
 */
export function validateJwt(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
      code: 'MISSING_AUTH_HEADER',
      requestId: req.requestId,
    });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization scheme. Use "Bearer <token>"',
      code: 'INVALID_AUTH_SCHEME',
      requestId: req.requestId,
    });
  }

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing token',
      code: 'MISSING_TOKEN',
      requestId: req.requestId,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', {
      algorithms: ['HS256', 'RS256'],
      clockTolerance: 10,
    });

    req.auth = {
      method: 'jwt',
      token,
      decoded,
      userId: decoded.sub || decoded.user_id,
      email: decoded.email,
      scopes: decoded.scope?.split(' ') || [],
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token expired',
        code: 'TOKEN_EXPIRED',
        requestId: req.requestId,
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
        requestId: req.requestId,
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Token validation failed',
      code: 'TOKEN_VALIDATION_FAILED',
      requestId: req.requestId,
    });
  }
}

/**
 * OAuth 2.0 Bearer token validation (simplified)
 */
export function validateOAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid OAuth token',
      code: 'INVALID_OAUTH_TOKEN',
      requestId: req.requestId,
    });
  }

  const token = authHeader.slice(7);

  // In production, validate token against OAuth provider
  // This is a placeholder implementation
  try {
    const decoded = jwt.verify(token, process.env.OAUTH_SIGNING_KEY || 'oauth-secret');

    req.auth = {
      method: 'oauth2',
      token,
      decoded,
      userId: decoded.user_id,
      scope: decoded.scope,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid OAuth token',
      code: 'INVALID_OAUTH_TOKEN',
      requestId: req.requestId,
    });
  }
}

/**
 * Multi-method authentication
 * Tries API key first, then JWT
 */
export function authenticate(req, res, next) {
  // Try API key first
  if (req.headers['x-api-key']) {
    return validateApiKey(req, res, next);
  }

  // Try JWT
  if (req.headers.authorization) {
    return validateJwt(req, res, next);
  }

  // No auth provided
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Missing authentication credentials. Use X-API-Key header or Authorization bearer token',
    code: 'MISSING_CREDENTIALS',
    requestId: req.requestId,
  });
}

/**
 * Authorization middleware - check required scopes
 */
export function authorize(...requiredScopes) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Not authenticated',
        code: 'NOT_AUTHENTICATED',
        requestId: req.requestId,
      });
    }

    // API keys have all scopes
    if (req.auth.method === 'api-key') {
      return next();
    }

    // Check JWT scopes
    const userScopes = req.auth.scopes || [];
    const hasRequiredScope = requiredScopes.some(scope => userScopes.includes(scope));

    if (!hasRequiredScope) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`,
        code: 'INSUFFICIENT_SCOPES',
        requestId: req.requestId,
      });
    }

    next();
  };
}

/**
 * Generate JWT token (for testing and development)
 */
export function generateToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', {
    algorithm: 'HS256',
    expiresIn,
  });
}

/**
 * Verify JWT token without middleware
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', {
      algorithms: ['HS256', 'RS256'],
    });
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
}
