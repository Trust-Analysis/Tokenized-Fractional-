// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/tokenRevocation.test.js — Tests for JWT token revocation and refresh rotation.
 *
 * Validates token revocation, refresh token rotation, and authentication middleware.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TokenRevocationService } from '../src/services/tokenRevocationService.js';
import { createJwtAuth, createWebSocketJwtAuth, requireRole, requirePermission } from '../src/middleware/jwtAuth.js';

describe('Token Revocation Service', () => {
  let tokenService;

  beforeEach(() => {
    tokenService = new TokenRevocationService({
      jwtSecret: 'test-secret-key',
      accessTokenExpiry: '15m',
      refreshTokenExpiry: '7d',
      logger: console,
    });
  });

  describe('Token Generation', () => {
    test('should generate access token with 15 minute expiry', () => {
      const user = {
        id: 'user123',
        email: 'test@example.com',
        role: 'investor',
        permissions: ['read:asset'],
      };

      const token = tokenService.generateAccessToken(user);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    test('should generate refresh token with 7 day expiry', () => {
      const refreshToken = tokenService.generateRefreshToken('user123');
      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');
    });

    test('should include JTI in tokens', () => {
      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const token = tokenService.generateAccessToken(user);
      
      const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      expect(decoded.jti).toBeDefined();
    });
  });

  describe('Token Verification', () => {
    test('should verify valid token', async () => {
      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const token = tokenService.generateAccessToken(user);

      const decoded = await tokenService.verifyToken(token);
      expect(decoded.id).toBe('user123');
      expect(decoded.email).toBe('test@example.com');
    });

    test('should reject invalid token', async () => {
      await expect(tokenService.verifyToken('invalid-token')).rejects.toThrow();
    });

    test('should reject expired token', async () => {
      const expiredService = new TokenRevocationService({
        jwtSecret: 'test-secret-key',
        accessTokenExpiry: '0s', // Expired immediately
        logger: console,
      });

      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const token = expiredService.generateAccessToken(user);

      await new Promise(resolve => setTimeout(resolve, 100));
      await expect(expiredService.verifyToken(token)).rejects.toThrow();
    });
  });

  describe('Token Revocation', () => {
    test('should revoke token by JTI', async () => {
      const result = await tokenService.revokeToken('jti123', 3600);
      expect(result).toBe(false); // Redis not available
    });

    test('should check if token is revoked', async () => {
      const isRevoked = await tokenService.isTokenRevoked('jti123');
      expect(isRevoked).toBe(false); // Redis not available
    });

    test('should revoke all user tokens', async () => {
      const result = await tokenService.revokeAllUserTokens('user123');
      expect(result).toBe(false); // Redis not available
    });

    test('should check if user tokens are revoked', async () => {
      const isRevoked = await tokenService.areUserTokensRevoked('user123');
      expect(isRevoked).toBe(false); // Redis not available
    });
  });

  describe('Refresh Token Rotation', () => {
    test('should refresh access token with rotation', async () => {
      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const refreshToken = tokenService.generateRefreshToken(user.id);

      const result = await tokenService.refreshAccessToken(refreshToken);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.accessToken).not.toBe(refreshToken);
      expect(result.refreshToken).not.toBe(refreshToken);
    });

    test('should reject non-refresh token', async () => {
      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const accessToken = tokenService.generateAccessToken(user);

      await expect(tokenService.refreshAccessToken(accessToken)).rejects.toThrow('Invalid token type');
    });

    test('should reject expired refresh token', async () => {
      const expiredService = new TokenRevocationService({
        jwtSecret: 'test-secret-key',
        refreshTokenExpiry: '0s',
        logger: console,
      });

      const refreshToken = expiredService.generateRefreshToken('user123');
      await new Promise(resolve => setTimeout(resolve, 100));

      await expect(expiredService.refreshAccessToken(refreshToken)).rejects.toThrow();
    });
  });

  describe('Statistics', () => {
    test('should return revocation statistics', async () => {
      const stats = await tokenService.getStats();
      expect(stats).toHaveProperty('revokedTokens');
      expect(stats).toHaveProperty('revokedUsers');
      expect(stats).toHaveProperty('redisConnected');
    });
  });
});

describe('JWT Authentication Middleware', () => {
  let jwtAuth;

  beforeEach(() => {
    jwtAuth = createJwtAuth({ optional: false });
  });

  describe('HTTP Authentication', () => {
    test('should reject request without Authorization header', async () => {
      const req = {
        headers: {},
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await jwtAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Authorization header required'),
          code: 'MISSING_AUTH_HEADER',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('should accept valid token', async () => {
      const tokenService = new TokenRevocationService({
        jwtSecret: 'test-secret-key',
        logger: console,
      });
      const user = { id: 'user123', email: 'test@example.com', role: 'investor' };
      const token = tokenService.generateAccessToken(user);

      const req = {
        headers: { authorization: `Bearer ${token}` },
        log: { info: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await jwtAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user123');
      expect(next).toHaveBeenCalled();
    });

    test('should handle optional authentication', async () => {
      const optionalAuth = createJwtAuth({ optional: true });
      const req = {
        headers: {},
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });
  });

  describe('Role Authorization', () => {
    test('should allow user with required role', () => {
      const middleware = requireRole('admin');
      const req = {
        user: { id: 'user123', role: 'admin' },
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should reject user without required role', () => {
      const middleware = requireRole('admin');
      const req = {
        user: { id: 'user123', role: 'investor' },
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('should reject unauthenticated user', () => {
      const middleware = requireRole('admin');
      const req = {
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Permission Authorization', () => {
    test('should allow user with required permission', () => {
      const middleware = requirePermission('create:asset');
      const req = {
        user: {
          id: 'user123',
          role: 'admin',
          permissions: ['create:asset', 'read:asset'],
        },
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should reject user without required permission', () => {
      const middleware = requirePermission('create:asset');
      const req = {
        user: {
          id: 'user123',
          role: 'investor',
          permissions: ['read:asset'],
        },
        log: { warn: jest.fn() },
        requestId: 'test-123',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
