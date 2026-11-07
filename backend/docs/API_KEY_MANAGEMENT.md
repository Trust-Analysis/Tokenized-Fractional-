# API Key Management System

This document describes the multi-key API key management system for the RWA Marketplace backend.

## Overview

The marketplace backend has moved from a single hardcoded `ADMIN_API_KEY` to a comprehensive multi-key management system with:

- **Multiple API Keys**: Create and manage multiple keys per admin
- **Key Expiration**: Set optional expiration dates on keys
- **Key Rotation**: Rotate keys with automatic revocation of old keys
- **Usage Tracking**: Monitor API key usage with count and last-used timestamps
- **Revocation**: Soft-delete keys (mark as revoked) without removing from database
- **Hard Deletion**: Permanently remove keys from the system
- **Database-Backed**: All keys stored securely with SHA-256 hashing

## Architecture

### Database Schema

API keys are stored in the `api_keys` table with the following columns:

```sql
CREATE TABLE api_keys (
  id                STRING PRIMARY KEY,        -- key_<12 random hex>
  name              STRING NOT NULL,           -- Human-readable name
  key_hash          STRING(64) NOT NULL,       -- SHA-256 hash of the actual key
  description       TEXT,                      -- Optional description
  expires_at        DATETIME,                  -- Optional expiration date
  revoked_at        DATETIME,                  -- NULL if active, timestamp if revoked
  created_at        DATETIME NOT NULL,         -- Creation timestamp
  updated_at        DATETIME NOT NULL,         -- Last update timestamp
  last_used_at      DATETIME,                  -- Track last usage
  usage_count       INTEGER DEFAULT 0          -- Total number of uses
);
```

### Key Format

API keys are generated as: `rwa_<32 random hex characters>`

Example: `rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`

**Important**: The actual key is only returned during creation. After that, only the SHA-256 hash is stored.

### Authentication Flow

1. Client sends request with `x-api-key: rwa_...` header
2. Backend retrieves key hash: `SHA256(provided_key)`
3. Queries database for matching `key_hash`
4. Validates:
   - Key exists
   - Not revoked (`revoked_at IS NULL`)
   - Not expired (`expires_at > NOW()`)
5. Updates `last_used_at` and increments `usage_count`
6. Proceeds with request or returns 401

## API Endpoints

All API key management endpoints require authentication with a valid, non-expired, non-revoked API key.

### Create API Key

```http
POST /api/v1/api-keys
x-api-key: rwa_<your-api-key>
Content-Type: application/json

{
  "name": "Production API Key",
  "description": "Optional description",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

**Response** (201 Created):

```json
{
  "key": "rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "id": "key_abc123def456",
  "name": "Production API Key",
  "description": "Optional description",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "createdAt": "2026-06-30T12:00:00.000Z",
  "note": "Store this key securely. You will not be able to see it again."
}
```

### List API Keys

```http
GET /api/v1/api-keys?includeRevoked=false
x-api-key: rwa_<your-api-key>
```

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "key_abc123def456",
      "name": "Production API Key",
      "description": "Optional description",
      "createdAt": "2026-06-30T12:00:00.000Z",
      "updatedAt": "2026-06-30T12:00:00.000Z",
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "revokedAt": null,
      "revoked": false,
      "expired": false,
      "usageCount": 42,
      "lastUsedAt": "2026-06-30T15:30:00.000Z"
    }
  ],
  "count": 1,
  "note": "API keys are returned with metadata only. The actual key material is never returned after creation."
}
```

### Get API Key Details

```http
GET /api/v1/api-keys/:id
x-api-key: rwa_<your-api-key>
```

**Response** (200 OK):

```json
{
  "id": "key_abc123def456",
  "name": "Production API Key",
  "description": "Optional description",
  "createdAt": "2026-06-30T12:00:00.000Z",
  "updatedAt": "2026-06-30T12:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "revokedAt": null,
  "revoked": false,
  "expired": false,
  "usageCount": 42,
  "lastUsedAt": "2026-06-30T15:30:00.000Z"
}
```

### Get Usage Statistics

```http
GET /api/v1/api-keys/:id/usage
x-api-key: rwa_<your-api-key>
```

**Response** (200 OK):

```json
{
  "id": "key_abc123def456",
  "name": "Production API Key",
  "usageCount": 42,
  "lastUsedAt": "2026-06-30T15:30:00.000Z",
  "createdAt": "2026-06-30T12:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "expired": false,
  "revoked": false,
  "revokedAt": null
}
```

### Rotate API Key

Rotate an API key by revoking the old one and creating a new one automatically.

```http
POST /api/v1/api-keys/:id/rotate
x-api-key: rwa_<your-api-key>
Content-Type: application/json

{
  "expiresAt": "2027-12-31T23:59:59Z",
  "description": "Optional new description"
}
```

**Response** (200 OK):

```json
{
  "oldKey": {
    "id": "key_abc123def456",
    "revokedAt": "2026-06-30T16:00:00.000Z"
  },
  "newKey": {
    "key": "rwa_xyz789abc123def456xyz789abc12",
    "id": "key_xyz789abc123",
    "name": "To Rotate (rotated)",
    "description": "Optional new description",
    "expiresAt": "2027-12-31T23:59:59.000Z",
    "createdAt": "2026-06-30T16:00:00.000Z",
    "note": "Store this key securely. You will not be able to see it again."
  }
}
```

### Revoke API Key

Revoke (soft delete) an API key to prevent further use without permanently removing it.

```http
DELETE /api/v1/api-keys/:id
x-api-key: rwa_<your-api-key>
```

**Response** (200 OK):

```json
{
  "message": "API key revoked",
  "id": "key_abc123def456",
  "revokedAt": "2026-06-30T16:00:00.000Z"
}
```

### Hard Delete API Key

Permanently remove an API key from the database.

```http
DELETE /api/v1/api-keys/:id?hardDelete=true
x-api-key: rwa_<your-api-key>
```

**Response** (200 OK):

```json
{
  "message": "API key deleted permanently",
  "id": "key_abc123def456"
}
```

## Bootstrap Instructions

When you first deploy the backend, you need to create an initial admin API key. This requires direct database access.

### Option 1: Using Node.js REPL

```bash
cd backend
node

// Inside Node REPL:
import { initDatabase, closeDatabase } from './src/services/database.js';
import { createApiKeyService } from './src/services/apiKeyService.js';

const db = await initDatabase('production');
const apiKeyService = createApiKeyService(db, console);
const result = await apiKeyService.create({
  name: 'Production Admin Key',
  description: 'Initial admin key for production',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
});
console.log('API Key:', result.key);
console.log('ID:', result.id);
await closeDatabase();
process.exit();
```

### Option 2: Using Bootstrap Script

Create `backend/bootstrap-api-key.js`:

```javascript
import 'dotenv/config';
import { initDatabase, closeDatabase } from './src/services/database.js';
import { createApiKeyService } from './src/services/apiKeyService.js';
import { logger } from './src/services/logger.js';

const environment = process.env.NODE_ENV || 'development';

(async () => {
  try {
    console.log(`🔧 Bootstrapping API key for ${environment}...`);
    
    const db = await initDatabase(environment);
    const apiKeyService = createApiKeyService(db, logger);
    
    const result = await apiKeyService.create({
      name: 'Bootstrap Admin Key',
      description: `Initial admin key for ${environment}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    });
    
    console.log('✅ API key created successfully!\n');
    console.log('Store this key securely:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Key ID:    ${result.id}`);
    console.log(`Key:       ${result.key}`);
    console.log(`Name:      ${result.name}`);
    console.log(`Expires:   ${result.expiresAt}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Use this key in the x-api-key header:');
    console.log(`curl -H "x-api-key: ${result.key}" http://localhost:3001/api/admin/verify\n`);
    
    await closeDatabase();
  } catch (error) {
    logger.error({ error: error.message }, 'Bootstrap failed');
    process.exit(1);
  }
})();
```

Then run:

```bash
NODE_ENV=production node bootstrap-api-key.js
```

## Configuration

No environment variables are required for the new system. The old `ADMIN_API_KEY` environment variable is no longer used.

Database setup:

- Uses Knex migrations automatically run on app start
- Supports SQLite (development) and PostgreSQL (production)
- Configure with `DATABASE_URL` environment variable

## Migration from Single Key

If you're migrating from the old hardcoded `ADMIN_API_KEY`:

1. Backup your database
2. Run migrations: `npm run migrate`
3. Bootstrap initial admin key (see above)
4. Remove `ADMIN_API_KEY` from your `.env` file
5. Update all clients to use the new key format
6. Test thoroughly in staging before production

## Best Practices

1. **Rotate Keys Regularly**: Rotate production keys every 90 days using the `/rotate` endpoint
2. **Use Expiration Dates**: Set 1-year expiration on production keys
3. **Monitor Usage**: Regularly review usage statistics to detect anomalies
4. **Limit Scope**: Create separate keys for different purposes/environments
5. **Revoke Unused Keys**: Revoke keys that are no longer needed
6. **Secure Storage**: Never commit API keys to version control
7. **Audit Logs**: Review API key usage in your logs for security events

## Security Considerations

- **Key Hashing**: Keys are hashed with SHA-256 for storage. Hashes cannot be reversed
- **No Recovery**: If you lose a key, you cannot retrieve it. Create a new one
- **Revocation**: Revoked keys are immediately rejected; changes take effect without delay
- **Database Access**: Direct database access is required for bootstrapping only
- **Expiration**: Expired keys are automatically rejected by validation logic
- **Usage Tracking**: All key uses are tracked and can be audited

## Troubleshooting

### "API key not found"

- The provided key doesn't exist in the database
- Check that you're using the complete key (should start with `rwa_`)

### "API key has expired"

- The key's `expiresAt` date has passed
- Rotate the key or create a new one

### "API key has been revoked"

- The key was explicitly revoked
- Create a new key or restore from backups if revocation was accidental

### Bootstrap key creation fails

- Ensure database migrations have run: `npm run migrate`
- Check `DATABASE_URL` is configured correctly
- Verify database credentials and connectivity
- Check file permissions on database file (SQLite)

## Further Reading

- [Architecture Overview](./architecture.md)
- [Security Best Practices](./security.md)
- [Database Migrations](./docs/migrations.md)
