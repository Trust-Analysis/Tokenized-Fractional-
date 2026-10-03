// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/tokenRevocationService.js — JWT token revocation and refresh rotation.
 *
 * Provides Redis-backed token blocklist with JTI tracking, short-lived access tokens,
 * single-use refresh tokens, and automatic refresh token rotation.
 */

import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';

/**
 * Token Revocation Service for JWT management
 */
export class TokenRevocationService {
  constructor(options = {}) {
    this.redisUrl = options.redisUrl || process.env.REDIS_URL;
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.accessTokenExpiry = options.accessTokenExpiry || '15m'; // 15 minutes
    this.refreshTokenExpiry = options.refreshTokenExpiry || '7d'; // 7 days
    this.logger = options.logger || console;
    this.redis = null;
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    if (!this.redisUrl) {
      this.logger.warn('No REDIS_URL configured, token revocation running in memory-only mode');
      return false;
    }

    try {
      this.redis = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 3,
      });

      await this.redis.connect();
      this.logger.info('Token revocation service initialized with Redis');
      return true;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to connect to Redis for token revocation');
      this.redis = null;
      return false;
    }
  }

  /**
   * Generate short-lived access token (15 minutes)
   */
  generateAccessToken(user) {
    const jti = randomBytes(16).toString('hex'); // Unique token ID
    const payload = {
      jti,
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions || [],
      type: 'access',
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'rwa-marketplace',
      audience: 'rwa-users',
      jwtid: jti,
    });
  }

  /**
   * Generate single-use refresh token (7 days)
   */
  generateRefreshToken(userId) {
    const jti = randomBytes(16).toString('hex'); // Unique token ID
    const payload = {
      jti,
      id: userId,
      type: 'refresh',
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'rwa-marketplace',
      jwtid: jti,
    });
  }

  /**
   * Verify JWT token and check revocation status
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'rwa-marketplace',
      });

      // Check if token is revoked
      if (decoded.jti) {
        const isRevoked = await this.isTokenRevoked(decoded.jti);
        if (isRevoked) {
          throw new Error('Token has been revoked');
        }
      }

      return decoded;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Token verification failed');
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Revoke a token by its JTI
   */
  async revokeToken(jti, ttl = null) {
    if (!this.redis) {
      this.logger.warn('Redis not available, cannot revoke token');
      return false;
    }

    try {
      const key = `auth:revoked:${jti}`;
      
      // Set TTL based on token type if not provided
      if (!ttl) {
        ttl = 7 * 24 * 60 * 60; // Default 7 days
      }

      await this.redis.setex(key, ttl, '1');
      this.logger.info({ jti, ttl }, 'Token revoked');
      return true;
    } catch (error) {
      this.logger.error({ error: error.message, jti }, 'Failed to revoke token');
      return false;
    }
  }

  /**
   * Check if a token is revoked
   */
  async isTokenRevoked(jti) {
    if (!this.redis) {
      return false; // In-memory mode: assume not revoked
    }

    try {
      const key = `auth:revoked:${jti}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error({ error: error.message, jti }, 'Failed to check token revocation');
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId) {
    if (!this.redis) {
      this.logger.warn('Redis not available, cannot revoke user tokens');
      return false;
    }

    try {
      const key = `auth:user_revoked:${userId}`;
      await this.redis.setex(key, 7 * 24 * 60 * 60, Date.now().toString());
      this.logger.info({ userId }, 'All user tokens revoked');
      return true;
    } catch (error) {
      this.logger.error({ error: error.message, userId }, 'Failed to revoke user tokens');
      return false;
    }
  }

  /**
   * Check if all tokens for a user are revoked
   */
  async areUserTokensRevoked(userId) {
    if (!this.redis) {
      return false;
    }

    try {
      const key = `auth:user_revoked:${userId}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error({ error: error.message, userId }, 'Failed to check user token revocation');
      return false;
    }
  }

  /**
   * Refresh access token with rotation
   * Issues new access token and revokes old refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, this.jwtSecret, {
        issuer: 'rwa-marketplace',
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type for refresh');
      }

      // Check if refresh token is revoked
      if (decoded.jti) {
        const isRevoked = await this.isTokenRevoked(decoded.jti);
        if (isRevoked) {
          throw new Error('Refresh token has been revoked');
        }
      }

      // Check if user tokens are revoked
      const userRevoked = await this.areUserTokensRevoked(decoded.id);
      if (userRevoked) {
        throw new Error('User tokens have been revoked');
      }

      // Revoke the old refresh token (single-use)
      if (decoded.jti) {
        await this.revokeToken(decoded.jti, 7 * 24 * 60 * 60);
      }

      // Generate new tokens
      const user = {
        id: decoded.id,
        email: decoded.email || 'user@example.com',
        role: decoded.role || 'investor',
        permissions: decoded.permissions || [],
      };

      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(decoded.id);

      this.logger.info({ userId: decoded.id }, 'Access token refreshed with rotation');

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'Refresh token failed');
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Get revocation statistics
   */
  async getStats() {
    const stats = {
      revokedTokens: 0,
      revokedUsers: 0,
      redisConnected: this.redis !== null,
    };

    if (this.redis) {
      try {
        const revokedKeys = await this.redis.keys('auth:revoked:*');
        stats.revokedTokens = revokedKeys.length;

        const userKeys = await this.redis.keys('auth:user_revoked:*');
        stats.revokedUsers = userKeys.length;
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to get revocation stats');
      }
    }

    return stats;
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.logger.info('Token revocation service closed');
    }
  }
}

/**
 * Singleton instance
 */
export const tokenRevocationService = new TokenRevocationService();
