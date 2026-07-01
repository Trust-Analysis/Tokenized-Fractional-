# Multi-Key API Key Management System

## Quick Start

### For New Deployments

1. Run migrations (automatic on app start):
   ```bash
   npm run migrate
   ```

2. Create your first admin key:
   ```bash
   npm run bootstrap-api-key
   ```

3. Copy the key and use it:
   ```bash
   curl -H "x-api-key: rwa_..." http://localhost:3001/api/admin/verify
   ```

### For Existing Deployments

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for step-by-step instructions.

## What Changed?

| Aspect | Before | After |
|--------|--------|-------|
| **API Keys** | 1 hardcoded key | Multiple keys in database |
| **Environment** | `ADMIN_API_KEY=...` | No env var needed |
| **Expiration** | Not supported | Optional per-key |
| **Rotation** | Manual/never | Automated via API |
| **Usage Tracking** | No | Full tracking |
| **Revocation** | Not supported | Soft & hard delete |
| **Management** | None | Full REST API |
| **Security** | Plain text | SHA-256 hashed |

## Key Features

✅ **Multiple API Keys** - Create and manage unlimited keys  
✅ **Expiration Dates** - Set optional expiration on each key  
✅ **Rotation** - Rotate keys with automatic old key revocation  
✅ **Usage Tracking** - Count and timestamp all key uses  
✅ **Revocation** - Soft-delete (revoke) or hard-delete keys  
✅ **Database-Backed** - Persistent storage with hashing  
✅ **Audit Trail** - Full logging of all key operations  

## Architecture

### Database Schema

```sql
CREATE TABLE api_keys (
  id              STRING PRIMARY KEY,
  name            STRING NOT NULL,
  key_hash        STRING(64) NOT NULL UNIQUE,
  description     TEXT,
  expires_at      DATETIME,
  revoked_at      DATETIME,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL,
  last_used_at    DATETIME,
  usage_count     INTEGER DEFAULT 0
);
```

### Key Generation & Storage

- **Format**: `rwa_` + 32 random hex characters (48 chars total)
- **Storage**: Only SHA-256 hash stored (one-way, non-reversible)
- **Recovery**: Impossible if lost; create new key instead

### Authentication Flow

```
Request with x-api-key header
    ↓
Hash the key (SHA-256)
    ↓
Query database for key_hash
    ↓
Validate:
  - Key exists
  - Not revoked (revoked_at IS NULL)
  - Not expired (expires_at > NOW())
    ↓
Update last_used_at and usage_count
    ↓
Proceed with request
```

## API Endpoints

All endpoints require authentication with valid API key.

### Create API Key
```bash
POST /api/v1/api-keys
x-api-key: rwa_...

{
  "name": "Production Key",
  "description": "Optional",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

### List API Keys
```bash
GET /api/v1/api-keys?includeRevoked=false
x-api-key: rwa_...
```

### Get Key Details
```bash
GET /api/v1/api-keys/:id
x-api-key: rwa_...
```

### Get Usage Statistics
```bash
GET /api/v1/api-keys/:id/usage
x-api-key: rwa_...
```

### Rotate API Key
```bash
POST /api/v1/api-keys/:id/rotate
x-api-key: rwa_...

{
  "expiresAt": "2027-12-31T23:59:59Z"
}
```

### Revoke API Key
```bash
DELETE /api/v1/api-keys/:id
x-api-key: rwa_...
```

### Hard Delete API Key
```bash
DELETE /api/v1/api-keys/:id?hardDelete=true
x-api-key: rwa_...
```

## Files Added

### Core Implementation
- `src/services/apiKeyService.js` - Main service class (329 lines)
- `src/routes/apiKeys.js` - API endpoints (282 lines)
- `src/services/database.js` - Database initialization (56 lines)

### Configuration
- `migrations/20260630000000_create_api_keys_table.js` - Database migration (29 lines)
- `bootstrap-api-key.js` - One-time setup script (82 lines)

### Testing & Documentation
- `__tests__/apiKeys.test.js` - Test suite (447 lines)
- `docs/API_KEY_MANAGEMENT.md` - Full documentation (386 lines)
- `API_KEY_IMPLEMENTATION_SUMMARY.md` - Implementation overview (281 lines)
- `MIGRATION_GUIDE.md` - Migration instructions (382 lines)

## Files Modified

- `src/middleware/auth.js` - Replaced hardcoded key check
- `src/app.js` - Added initialization and routing
- `src/server.js` - Call initializeApp()
- `.env.example` - Updated documentation
- `package.json` - Added bootstrap-api-key script

## Best Practices

1. **Rotate Keys** - Every 90 days minimum
2. **Set Expiration** - 1 year for production keys
3. **Monitor Usage** - Review statistics regularly
4. **Revoke Unused** - Clean up old/unused keys
5. **Separate Keys** - Different key per service/environment
6. **Secure Storage** - Use password manager or vault
7. **Audit Logs** - Review all key operations

## Security Highlights

- ✅ Cryptographically secure generation (randomBytes(32))
- ✅ One-way hashing (SHA-256, non-reversible)
- ✅ Impossible key recovery (hash only stored)
- ✅ Automatic expiration enforcement
- ✅ Full audit trail and usage tracking
- ✅ Immediate revocation effect

## Deployment Checklist

- [ ] Backup database
- [ ] Run migrations: `npm run migrate`
- [ ] Create bootstrap key: `npm run bootstrap-api-key`
- [ ] Store key securely
- [ ] Remove `ADMIN_API_KEY` from `.env`
- [ ] Update all API clients
- [ ] Test with new key
- [ ] Monitor logs for errors
- [ ] Create additional keys as needed

## Troubleshooting

### "API key not found"
- Verify using the correct key from bootstrap
- Create new key if old one is lost

### "API key has expired"
- Rotate the key: `POST /api-keys/:id/rotate`
- Create new key

### "API key has been revoked"
- Create new key
- Use another active key if available

### Migration fails
- Check database connectivity
- Ensure proper file permissions
- Run: `npm run migrate:status`

## Documentation

- **API Reference**: `docs/API_KEY_MANAGEMENT.md`
- **Implementation Details**: `API_KEY_IMPLEMENTATION_SUMMARY.md`
- **Migration Steps**: `MIGRATION_GUIDE.md`
- **Tests**: `__tests__/apiKeys.test.js`

## Examples

### Create a production key
```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Admin",
    "expiresAt": "2027-06-30T23:59:59Z"
  }'
```

### Rotate a key
```bash
curl -X POST http://localhost:3001/api/v1/api-keys/key_abc123/rotate \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"expiresAt": "2027-12-31T23:59:59Z"}'
```

### Check usage statistics
```bash
curl -H "x-api-key: rwa_..." \
  http://localhost:3001/api/v1/api-keys/key_abc123/usage
```

## Support

- Read documentation first: `docs/API_KEY_MANAGEMENT.md`
- Check migration guide: `MIGRATION_GUIDE.md`
- Review test examples: `__tests__/apiKeys.test.js`
- Create GitHub issue if needed

---

**Created**: June 30, 2026  
**Version**: 2.0.0  
**Status**: Production Ready
