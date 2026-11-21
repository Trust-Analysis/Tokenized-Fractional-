/**
 * User Authentication and Authorization System
 * 
 * Comprehensive authentication with JWT, role-based access control (RBAC),
 * and permission management for the RWA Marketplace.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

/**
 * User Roles Definition
 */
export const USER_ROLES = {
  ADMIN: 'admin',
  ASSET_OWNER: 'asset_owner',
  INVESTOR: 'investor',
  ANALYST: 'analyst',
  SUPPORT: 'support',
};

/**
 * Permission Definitions
 */
export const PERMISSIONS = {
  // Asset Management
  CREATE_ASSET: 'create:asset',
  READ_ASSET: 'read:asset',
  UPDATE_ASSET: 'update:asset',
  DELETE_ASSET: 'delete:asset',
  APPROVE_ASSET: 'approve:asset',
  PAUSE_ASSET: 'pause:asset',

  // User Management
  CREATE_USER: 'create:user',
  READ_USER: 'read:user',
  UPDATE_USER: 'update:user',
  DELETE_USER: 'delete:user',
  MANAGE_ROLES: 'manage:roles',

  // Purchase Management
  CREATE_PURCHASE: 'create:purchase',
  READ_PURCHASE: 'read:purchase',
  CANCEL_PURCHASE: 'cancel:purchase',

  // Admin Functions
  VIEW_ANALYTICS: 'view:analytics',
  MANAGE_SYSTEM: 'manage:system',
  VIEW_AUDIT_LOG: 'view:audit_log',
};

/**
 * Role-Permission Mapping
 */
export const ROLE_PERMISSIONS = {
  [USER_ROLES.ADMIN]: [
    // Admin has all permissions
    ...Object.values(PERMISSIONS),
  ],
  [USER_ROLES.ASSET_OWNER]: [
    PERMISSIONS.CREATE_ASSET,
    PERMISSIONS.READ_ASSET,
    PERMISSIONS.UPDATE_ASSET,
    PERMISSIONS.DELETE_ASSET,
    PERMISSIONS.READ_PURCHASE,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [USER_ROLES.INVESTOR]: [
    PERMISSIONS.READ_ASSET,
    PERMISSIONS.CREATE_PURCHASE,
    PERMISSIONS.READ_PURCHASE,
    PERMISSIONS.CANCEL_PURCHASE,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [USER_ROLES.ANALYST]: [
    PERMISSIONS.READ_ASSET,
    PERMISSIONS.READ_PURCHASE,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [USER_ROLES.SUPPORT]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.READ_ASSET,
    PERMISSIONS.READ_PURCHASE,
    PERMISSIONS.VIEW_AUDIT_LOG,
  ],
};

/**
 * Authentication Service
 */
export class AuthService {
  constructor(config = {}) {
    this.jwtSecret = config.jwtSecret || process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.jwtExpiry = config.jwtExpiry || process.env.JWT_EXPIRY || '24h';
    this.refreshTokenExpiry = config.refreshTokenExpiry || '7d';
    this.logger = config.logger || console;
    this.dataLayer = config.dataLayer || null;
  }

  /**
   * Hash password with bcrypt
   */
  async hashPassword(password) {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] || [],
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiry,
      issuer: 'rwa-marketplace',
      audience: 'rwa-users',
    });
  }

  /**
   * Generate JWT refresh token
   */
  generateRefreshToken(userId) {
    const payload = {
      id: userId,
      type: 'refresh',
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'rwa-marketplace',
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'rwa-marketplace',
      });
    } catch (error) {
      this.logger.error({ error: error.message }, 'Token verification failed');
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Register new user
   */
  async registerUser(userData) {
    const { email, password, name, role = USER_ROLES.INVESTOR } = userData;

    if (!email || !password || !name) {
      throw new Error('Missing required fields: email, password, name');
    }

    // Validate role
    if (!Object.values(USER_ROLES).includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    const user = {
      id: `user_${randomBytes(16).toString('hex')}`,
      email,
      name,
      role,
      passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      emailVerified: false,
    };

    this.logger.info({ email, role }, 'User registered');
    return user;
  }

  /**
   * Login user
   */
  async loginUser(email, password) {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    // In real implementation, fetch from database
    // For now, return example response
    const user = {
      id: 'user_123',
      email,
      name: 'User Name',
      role: USER_ROLES.INVESTOR,
    };

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user.id);

    this.logger.info({ email }, 'User logged in');

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * Refresh access token
   */
  refreshAccessToken(refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, this.jwtSecret, {
        issuer: 'rwa-marketplace',
      });

      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // In real implementation, fetch user from database
      const user = {
        id: payload.id,
        email: 'user@example.com',
        role: USER_ROLES.INVESTOR,
      };

      const newAccessToken = this.generateAccessToken(user);

      this.logger.info({ userId: payload.id }, 'Access token refreshed');

      return newAccessToken;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Refresh token failed');
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Check user permission
   */
  hasPermission(user, permission) {
    if (!user || !user.role) {
      return false;
    }

    const userPermissions = ROLE_PERMISSIONS[user.role] || [];
    return userPermissions.includes(permission);
  }

  /**
   * Check user has any of permissions
   */
  hasAnyPermission(user, permissions) {
    if (!user || !user.role) {
      return false;
    }

    const userPermissions = ROLE_PERMISSIONS[user.role] || [];
    return permissions.some(p => userPermissions.includes(p));
  }

  /**
   * Check user has all permissions
   */
  hasAllPermissions(user, permissions) {
    if (!user || !user.role) {
      return false;
    }

    const userPermissions = ROLE_PERMISSIONS[user.role] || [];
    return permissions.every(p => userPermissions.includes(p));
  }
}

/**
 * Singleton instance
 */
export const authService = new AuthService();

/**
 * Helper function to extract user from JWT
 */
export function extractUserFromToken(token) {
  try {
    if (!token) return null;

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    return jwt.decode(cleanToken);
  } catch (error) {
    return null;
  }
}

/**
 * Generate session token for user
 */
export function generateSessionToken(userId, expiresIn = '30d') {
  const payload = {
    userId,
    sessionId: randomBytes(16).toString('hex'),
    type: 'session',
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn,
  });
}
