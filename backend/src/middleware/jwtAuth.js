// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/jwtAuth.js — JWT authentication middleware with token revocation.
 *
 * Validates JWT access tokens, checks revocation status, and attaches user info to requests.
 * Supports both HTTP and WebSocket authentication.
 */

import { tokenRevocationService } from '../services/tokenRevocationService.js';

/**
 * Factory function to create JWT authentication middleware
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware
 */
export function createJwtAuth(options = {}) {
  const {
    tokenRevocationSvc = tokenRevocationService,
    optional = false,
    logger = console,
  } = options;

  /**
   * Express middleware that validates JWT access tokens and checks revocation
   */
  return async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
      if (optional) {
        return next();
      }
      req.log?.warn('Missing Authorization header');
      return res.status(401).json({
        error: 'Unauthorized: Authorization header required',
        code: 'MISSING_AUTH_HEADER',
        requestId: req.requestId,
      });
    }

    // Extract token from Bearer format
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
      // Verify token and check revocation
      const decoded = await tokenRevocationSvc.verifyToken(token);

      // Attach user info to request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions || [],
        jti: decoded.jti,
      };

      req.log?.info({ userId: decoded.id, role: decoded.role }, 'JWT token validated');
      next();
    } catch (error) {
      req.log?.warn({ error: error.message }, 'JWT validation failed');
      
      if (optional) {
        return next();
      }

      return res.status(401).json({
        error: 'Unauthorized: ' + error.message,
        code: 'INVALID_TOKEN',
        requestId: req.requestId,
      });
    }
  };
}

/**
 * Factory function to create JWT authentication middleware for WebSocket
 * @param {Object} options - Configuration options
 * @returns {Function} WebSocket upgrade middleware
 */
export function createWebSocketJwtAuth(options = {}) {
  const {
    tokenRevocationSvc = tokenRevocationService,
    logger = console,
  } = options;

  /**
   * WebSocket upgrade middleware that validates JWT tokens
   */
  return async (req, callback) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
      logger.warn('WebSocket connection missing Authorization header');
      return callback(new Error('Unauthorized: Authorization header required'), false);
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
      const decoded = await tokenRevocationSvc.verifyToken(token);

      // Attach user info to request for WebSocket handler
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions || [],
        jti: decoded.jti,
      };

      logger.info({ userId: decoded.id, role: decoded.role }, 'WebSocket JWT validated');
      callback(null, true);
    } catch (error) {
      logger.warn({ error: error.message }, 'WebSocket JWT validation failed');
      callback(new Error('Unauthorized: ' + error.message), false);
    }
  };
}

/**
 * Role-based authorization middleware
 * Checks if the authenticated user has the required role
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication required',
        code: 'AUTH_REQUIRED',
        requestId: req.requestId,
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      req.log?.warn({ userRole: req.user.role, allowedRoles }, 'Insufficient permissions');
      return res.status(403).json({
        error: 'Forbidden: Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requestId: req.requestId,
      });
    }

    next();
  };
}

/**
 * Permission-based authorization middleware
 * Checks if the authenticated user has the required permission
 */
export function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication required',
        code: 'AUTH_REQUIRED',
        requestId: req.requestId,
      });
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.every(perm => userPermissions.includes(perm));

    if (!hasPermission) {
      req.log?.warn({ userPermissions: req.user.permissions, requiredPermissions }, 'Insufficient permissions');
      return res.status(403).json({
        error: 'Forbidden: Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requestId: req.requestId,
      });
    }

    next();
  };
}

/**
 * Legacy export for backward compatibility
 */
export let jwtAuth = createJwtAuth();
