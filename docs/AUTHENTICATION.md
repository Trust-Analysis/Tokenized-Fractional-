# User Authentication & Authorization System

## Overview

The RWA Marketplace includes a comprehensive authentication and authorization system with JWT tokens, role-based access control (RBAC), and permission management. This document covers setup, usage, and integration patterns.

## Architecture

### Components

1. **AuthService** (`backend/auth.js`)
   - JWT token generation and verification
   - Password hashing with bcrypt
   - User registration and login
   - Permission checking
   - Token refresh logic

2. **Auth Middleware** (`backend/authMiddleware.js`)
   - JWT authentication middleware
   - Role-based authorization
   - Permission-based authorization
   - Optional authentication

3. **Auth Routes** (`backend/authMiddleware.js`)
   - `/api/v1/auth/register` - Register new user
   - `/api/v1/auth/login` - User login
   - `/api/v1/auth/refresh` - Refresh access token
   - `/api/v1/auth/logout` - User logout
   - `/api/v1/auth/me` - Get current user
   - `/api/v1/auth/verify` - Verify token

## User Roles

### Available Roles

| Role | Description | Use Case |
|------|-------------|----------|
| `admin` | Full system access | Platform administrators |
| `asset_owner` | Manage own assets | Property/asset owners |
| `investor` | Buy and manage shares | Share buyers |
| `analyst` | View-only analytics | Data analysts |
| `support` | Customer support access | Support team |

### Role Permissions

#### Admin
- All permissions (full system access)

#### Asset Owner
- Create, read, update, delete own assets
- View related purchases
- View analytics for own assets

#### Investor
- Read asset listings
- Create (buy) purchases
- Read own purchases
- Cancel own purchases
- View personal analytics

#### Analyst
- Read assets
- Read purchases
- View analytics

#### Support
- Read users
- Read assets
- Read purchases
- View audit logs

## Permissions

Complete permission list for RBAC:

```
// Asset Management
- create:asset
- read:asset
- update:asset
- delete:asset
- approve:asset
- pause:asset

// User Management
- create:user
- read:user
- update:user
- delete:user
- manage:roles

// Purchase Management
- create:purchase
- read:purchase
- cancel:purchase

// Admin Functions
- view:analytics
- manage:system
- view:audit_log
```

## Installation

### 1. Add Dependencies

```bash
cd backend
npm install
```

Adds:
- `jsonwebtoken@^9.1.2` - JWT generation/verification
- `bcryptjs@^2.4.3` - Password hashing

### 2. Configure Environment

Add to `.env`:

```bash
# JWT Configuration
JWT_SECRET=your-super-secret-key-change-this-in-production
JWT_EXPIRY=24h
JWT_REFRESH_EXPIRY=7d

# Password Configuration
BCRYPT_ROUNDS=12

# Environment
NODE_ENV=production
```

### 3. Initialize Auth Service

In backend startup (`backend/index.js`):

```javascript
import { authService } from './auth.js';
import { setupAuthRoutes, authenticateToken } from './authMiddleware.js';

// Initialize auth service
const auth = new AuthService({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY,
  logger: logger,
});

// Setup auth routes
setupAuthRoutes(app, logger);
```

## API Endpoints

### Register User

**POST** `/api/v1/auth/register`

Request:
```json
{
  "email": "user@example.com",
  "password": "securePassword123!",
  "name": "John Doe",
  "role": "investor"
}
```

Response:
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "user_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "investor"
  }
}
```

### Login User

**POST** `/api/v1/auth/login`

Request:
```json
{
  "email": "user@example.com",
  "password": "securePassword123!"
}
```

Response:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "user_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "investor"
  }
}
```

### Refresh Token

**POST** `/api/v1/auth/refresh`

Request:
```json
{
  "refreshToken": "eyJhbGc..."
}
```

Response:
```json
{
  "accessToken": "eyJhbGc..."
}
```

### Get Current User

**GET** `/api/v1/auth/me`

Headers:
```
Authorization: Bearer eyJhbGc...
```

Response:
```json
{
  "user": {
    "id": "user_abc123",
    "email": "user@example.com",
    "role": "investor",
    "permissions": ["read:asset", "create:purchase", ...]
  }
}
```

### Logout

**POST** `/api/v1/auth/logout`

Headers:
```
Authorization: Bearer eyJhbGc...
```

Response:
```json
{
  "message": "Logged out successfully"
}
```

### Verify Token

**GET** `/api/v1/auth/verify`

Headers:
```
Authorization: Bearer eyJhbGc...
```

Response:
```json
{
  "valid": true,
  "user": {
    "id": "user_abc123",
    "email": "user@example.com",
    "role": "investor"
  }
}
```

## Middleware Usage

### Require Authentication

```javascript
app.get('/api/v1/protected', authenticateToken, (req, res) => {
  // req.user contains decoded JWT payload
  res.json({ user: req.user });
});
```

### Optional Authentication

```javascript
app.get('/api/v1/public', optionalAuthToken, (req, res) => {
  if (req.user) {
    // User is authenticated
  } else {
    // Public access
  }
});
```

### Role-Based Authorization

```javascript
// Require admin or asset_owner role
app.post(
  '/api/v1/assets',
  authenticateToken,
  authorizeRole('admin', 'asset_owner'),
  (req, res) => {
    // Handle creation
  }
);
```

### Permission-Based Authorization

```javascript
// Require create:asset permission
app.post(
  '/api/v1/assets',
  authenticateToken,
  authorizePermission('create:asset'),
  (req, res) => {
    // Handle creation
  }
);
```

### Any Permission

```javascript
// Require either read:asset or read:purchase
app.get(
  '/api/v1/marketplace-data',
  authenticateToken,
  authorizeAnyPermission('read:asset', 'read:purchase'),
  (req, res) => {
    // Handle request
  }
);
```

## Integration Examples

### Protecting REST Endpoints

```javascript
import { authenticateToken, authorizeRole } from './authMiddleware.js';

// Create asset (admin and asset_owner only)
app.post(
  '/api/v1/rwa',
  authenticateToken,
  authorizeRole('admin', 'asset_owner'),
  async (req, res) => {
    // Create asset
  }
);

// Buy shares (investor only)
app.post(
  '/api/v1/purchases',
  authenticateToken,
  authorizeRole('investor', 'admin'),
  async (req, res) => {
    // Buy shares
  }
);
```

### GraphQL Authentication

```javascript
import { ApolloServer } from '@apollo/server';
import { extractUserFromToken } from './auth.js';

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = token ? extractUserFromToken(token) : null;
    
    return { user };
  },
});
```

### WebSocket Authentication

```javascript
import { authenticateWebSocket } from './auth.js';

wsManager.wss.on('connection', (ws, req) => {
  const token = req.headers['sec-websocket-protocol'];
  const user = extractUserFromToken(token);
  
  if (!user) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  
  ws.user = user;
  // Handle authenticated connection
});
```

## Password Security

### Requirements

- Minimum 8 characters
- Should include uppercase, lowercase, numbers, special characters (recommended)
- Never logged or displayed

### Hashing

- Algorithm: bcryptjs with 12 rounds
- Salt: Automatically generated per password
- Comparison: Timing-safe comparison

### Best Practices

1. Enforce strong password policies
2. Implement rate limiting on login attempts
3. Use HTTPS for all auth endpoints
4. Store JWT_SECRET securely (use environment variables)
5. Rotate keys periodically
6. Implement password reset with email verification

## Token Management

### Access Token

- **Expiry**: 24 hours (configurable)
- **Scope**: Full user permissions
- **Usage**: Include in Authorization header
- **Refresh**: Not possible, must use refresh token

### Refresh Token

- **Expiry**: 7 days (configurable)
- **Scope**: Only for token refresh
- **Usage**: POST to /auth/refresh endpoint
- **Storage**: Secure httpOnly cookie (recommended) or localStorage

### Token Payload

```javascript
{
  id: "user_abc123",
  email: "user@example.com",
  role: "investor",
  permissions: ["read:asset", "create:purchase", ...],
  iat: 1719743159,
  exp: 1719829559,
  iss: "rwa-marketplace",
  aud: "rwa-users"
}
```

## Security Considerations

### ✅ Implemented

- JWT signature verification
- Token expiry enforcement
- bcryptjs password hashing
- Role-based access control
- Permission-based authorization
- Secure token generation

### ⚠️ Additional Recommendations

1. **HTTPS Only**: Enforce TLS for all auth endpoints
2. **Rate Limiting**: Limit login attempts to prevent brute force
3. **Token Revocation**: Implement token blacklist for logout
4. **Audit Logging**: Log all auth events
5. **Email Verification**: Verify email during registration
6. **Password Reset**: Secure password recovery flow
7. **MFA**: Add multi-factor authentication
8. **Session Management**: Track active sessions

## Troubleshooting

### Invalid Token

**Error**: "Invalid or expired token"

**Solutions**:
- Verify JWT_SECRET matches between server and client
- Check token expiry time
- Ensure token format is "Bearer <token>"
- Regenerate token if expired

### Unauthorized Access

**Error**: "Insufficient permissions"

**Solutions**:
- Verify user role is correct
- Check permission requirements for endpoint
- Ensure user token includes required permissions

### Login Failed

**Error**: "Email or password incorrect"

**Solutions**:
- Verify email exists in database
- Ensure password is correct
- Check if user account is active

### Token Refresh Failed

**Error**: "Invalid or expired refresh token"

**Solutions**:
- Generate new tokens via login
- Check refresh token expiry
- Verify refresh token is valid

## Future Enhancements

1. **OAuth 2.0 / OpenID Connect** - Third-party authentication
2. **Multi-Factor Authentication** - TOTP, email verification
3. **Session Management** - Track and manage user sessions
4. **Token Blacklist** - Revoke tokens on logout
5. **Audit Logging** - Track all auth events
6. **API Keys** - For service-to-service authentication
7. **Permissions Management UI** - Admin interface for roles/permissions
8. **Account Recovery** - Password reset, account recovery flows

## API Reference

### AuthService Class

```javascript
class AuthService {
  // Password Management
  async hashPassword(password)
  async comparePassword(password, hash)

  // Token Generation
  generateAccessToken(user)
  generateRefreshToken(userId)
  verifyToken(token)

  // User Management
  async registerUser(userData)
  async loginUser(email, password)
  refreshAccessToken(refreshToken)

  // Authorization
  hasPermission(user, permission)
  hasAnyPermission(user, permissions)
  hasAllPermissions(user, permissions)
}
```

### Middleware Functions

```javascript
// Authentication
authenticateToken(req, res, next)
optionalAuthToken(req, res, next)

// Authorization
authorizeRole(...requiredRoles)
authorizePermission(...requiredPermissions)
authorizeAnyPermission(...requiredPermissions)
```

## Example Usage

```javascript
import { AuthService, USER_ROLES, PERMISSIONS } from './auth.js';

// Create auth service
const auth = new AuthService({
  jwtSecret: 'your-secret',
  jwtExpiry: '24h',
});

// Register user
const user = await auth.registerUser({
  email: 'user@example.com',
  password: 'securePassword123',
  name: 'John Doe',
  role: USER_ROLES.INVESTOR,
});

// Login user
const { accessToken, refreshToken } = await auth.loginUser(
  'user@example.com',
  'securePassword123'
);

// Verify token
const decoded = auth.verifyToken(accessToken);

// Check permissions
const canCreateAsset = auth.hasPermission(decoded, PERMISSIONS.CREATE_ASSET);
```
