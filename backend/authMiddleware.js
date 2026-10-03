/**
 * Authentication Middleware and Routes
 * 
 * JWT authentication, authorization middleware, and auth endpoints
 * for the RWA Marketplace.
 */

import { authService, extractUserFromToken, PERMISSIONS } from './auth.js';

/**
 * JWT Authentication Middleware
 * Verifies JWT token and attaches user to request
 */
export function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'NO_TOKEN',
      });
    }

    const user = authService.verifyToken(token);
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(403).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * Optional Authentication Middleware
 * Attaches user if token is provided, but doesn't fail if absent
 */
export function optionalAuthToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const user = authService.verifyToken(token);
      req.user = user;
      req.token = token;
    }
  } catch (error) {
    // Silently ignore invalid tokens for optional auth
  }
  next();
}

/**
 * Role-Based Authorization Middleware Factory
 * Returns middleware that checks if user has required role
 */
export function authorizeRole(...requiredRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    if (!requiredRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles,
      });
    }

    next();
  };
}

/**
 * Permission-Based Authorization Middleware Factory
 * Returns middleware that checks if user has required permission
 */
export function authorizePermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const hasPermission = authService.hasAllPermissions(req.user, requiredPermissions);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredPermissions,
      });
    }

    next();
  };
}

/**
 * Any Permission Middleware Factory
 * Returns middleware that checks if user has any of the permissions
 */
export function authorizeAnyPermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const hasPermission = authService.hasAnyPermission(req.user, requiredPermissions);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredPermissions,
      });
    }

    next();
  };
}

/**
 * Setup Authentication Routes
 */
export function setupAuthRoutes(app, logger) {
  /**
   * POST /api/v1/auth/register
   * Register new user
   */
  app.post('/api/v1/auth/register', async (req, res) => {
    try {
      const { email, password, name, role } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({
          error: 'Missing required fields: email, password, name',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters',
        });
      }

      // Create user (in real app, save to database)
      const user = await authService.registerUser({
        email,
        password,
        name,
        role,
      });

      logger.info({ email, role }, 'User registered');

      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Registration failed');
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/v1/auth/login
   * Login user and return tokens
   */
  app.post('/api/v1/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required',
        });
      }

      const result = await authService.loginUser(email, password);

      res.json(result);
    } catch (error) {
      logger.error({ error: error.message }, 'Login failed');
      res.status(401).json({ error: error.message });
    }
  });

  /**
   * POST /api/v1/auth/refresh
   * Refresh access token
   */
  app.post('/api/v1/auth/refresh', (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          error: 'Refresh token required',
        });
      }

      const accessToken = authService.refreshAccessToken(refreshToken);

      res.json({ accessToken });
    } catch (error) {
      logger.error({ error: error.message }, 'Token refresh failed');
      res.status(401).json({ error: error.message });
    }
  });

  /**
   * POST /api/v1/auth/logout
   * Logout user (client-side token deletion)
   */
  app.post('/api/v1/auth/logout', authenticateToken, (req, res) => {
    // In real app, could invalidate token in database
    logger.info({ userId: req.user.id }, 'User logged out');
    res.json({ message: 'Logged out successfully' });
  });

  /**
   * GET /api/v1/auth/me
   * Get current user info
   */
  app.get('/api/v1/auth/me', authenticateToken, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        permissions: req.user.permissions,
      },
    });
  });

  /**
   * GET /api/v1/auth/verify
   * Verify token validity
   */
  app.get('/api/v1/auth/verify', authenticateToken, (req, res) => {
    res.json({
      valid: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
    });
  });
}
