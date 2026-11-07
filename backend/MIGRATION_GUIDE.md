# Migration Guide: From Single API Key to Multi-Key Management

This guide walks you through migrating from the old hardcoded `ADMIN_API_KEY` system to the new multi-key management system.

## Prerequisites

- Node.js 18+
- Git (for version control)
- Database backup (SQLite or PostgreSQL)

## Timeline

- **Total Time**: 10-15 minutes
- **Downtime**: 2-5 minutes (during deployment)

## Step 1: Backup Everything (5 minutes)

### Create a database backup

```bash
cd backend
npm run backup
# Creates: backup-<timestamp>.tar.gz
```

### Create a git commit

```bash
git add -A
git commit -m "Backup before API key system migration"
```

## Step 2: Stop the Application (1 minute)

```bash
# Stop the running backend
pkill -f "node src/server.js"
# or if using PM2:
pm2 stop rwa-backend
```

## Step 3: Install/Update Dependencies (2 minutes)

```bash
cd backend
npm install
```

No new dependencies are required; the system uses existing libraries.

## Step 4: Run Migrations (1 minute)

The migration will run automatically when you start the app, but you can run it manually:

```bash
npm run migrate
```

Expected output:
```
Batch 1 run: 1 migrations
```

This creates the `api_keys` table in your database.

## Step 5: Create Bootstrap Admin Key (2 minutes)

```bash
npm run bootstrap-api-key
```

Expected output:
```
🔧 Bootstrapping API key for development environment...

✅ API key created successfully!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Store this key securely. You will not be able to see it again.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Key ID:     key_abc123def456
Key:        rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
Name:       Bootstrap Admin Key
Created:    2026-06-30T12:00:00Z
Expires:    2027-06-30T12:00:00Z
```

**⚠️ IMPORTANT**: Copy and secure this key immediately. You cannot retrieve it again.

## Step 6: Update Configuration

### Remove old environment variable

Edit `backend/.env`:

```diff
- ADMIN_API_KEY=old-hardcoded-key-value
```

The system no longer uses this variable.

### Verify other settings are correct

- `CORS_ORIGINS` - Points to your frontend
- `DATABASE_URL` - Points to your database (if using PostgreSQL)
- `NODE_ENV` - Set to appropriate value

## Step 7: Test the New System

### Start the backend

```bash
npm run dev
# or for production:
npm start
```

### Verify the new key works

```bash
# Using the key from step 5
curl -H "x-api-key: rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" \
  http://localhost:3001/api/admin/verify

# Expected response:
# {"ok": true}
```

### Create a test asset to verify write operations

```bash
curl -X POST http://localhost:3001/api/v1/rwa \
  -H "x-api-key: rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Test Asset",
    "location": "New York",
    "description": "Test for migration",
    "assetType": "Real Estate"
  }'

# Expected: 201 Created with asset data
```

### Run the test suite

```bash
npm test -- __tests__/apiKeys.test.js
```

Expected output: All tests pass ✓

## Step 8: Update API Clients

Update all places where your API key is used:

### Development

If you hardcoded the key in a test script:

```javascript
// OLD
const apiKey = process.env.ADMIN_API_KEY || 'dev-key-change-in-production';

// NEW
const apiKey = process.env.API_KEY || 'rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
```

### Production Deployments

#### For Render.com

1. Go to your Render dashboard
2. Find your backend service
3. Go to Environment
4. Remove `ADMIN_API_KEY` if present
5. Add `API_KEY` (or similar) with your bootstrap key
6. Redeploy

#### For Docker

Update your deployment configuration:

```dockerfile
# OLD
ENV ADMIN_API_KEY=your-old-key

# NEW
ENV API_KEY=rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

#### For Kubernetes

Update your secret:

```bash
kubectl create secret generic rwa-api-keys \
  --from-literal=admin-key=rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Step 9: Monitor and Validate

### Check API key usage

```bash
curl -H "x-api-key: rwa_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" \
  http://localhost:3001/api/v1/api-keys

# Should list keys with usage statistics
```

### Review logs

```bash
# Check for any migration errors
tail -f logs/backend.log | grep -i "api.key\|migrate\|error"
```

### Run smoke tests

Test all critical API endpoints with the new key:

```bash
# List assets
curl -H "x-api-key: rwa_..." http://localhost:3001/api/v1/rwa

# Get an asset
curl -H "x-api-key: rwa_..." \
  http://localhost:3001/api/v1/rwa/CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

# Create an asset
curl -X POST http://localhost:3001/api/v1/rwa \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"contractId": "C...", "title": "...", ...}'
```

## Step 10: Post-Migration Tasks

### Set up key rotation

Create a reminder to rotate your admin key every 90 days:

```bash
# List current key usage
curl -H "x-api-key: rwa_..." \
  http://localhost:3001/api/v1/api-keys/key_abc123def456/usage

# When ready to rotate
curl -X POST http://localhost:3001/api/v1/api-keys/key_abc123def456/rotate \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"expiresAt": "2027-12-31T23:59:59Z"}'
```

### Document the new key

- Store in secure vault (e.g., 1Password, HashiCorp Vault, AWS Secrets Manager)
- Document creation date and expiration
- Set calendar reminder for rotation 30 days before expiration

### Create additional keys for different services

```bash
# Development key
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Development Integration",
    "description": "For dev environment and CI/CD"
  }'

# Staging key
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Staging Environment",
    "description": "For staging deployments",
    "expiresAt": "2026-12-31T23:59:59Z"
  }'
```

## Rollback Procedure

If something goes wrong:

### Option 1: Restore from backup

```bash
cd backend
npm run restore
# Select the backup file from the list
```

### Option 2: Manual rollback

```bash
# 1. Stop the backend
pkill -f "node src/server.js"

# 2. Reset to previous git commit
git reset --hard HEAD~1

# 3. Restore database from backup
tar -xzf backup-<timestamp>.tar.gz
# Follow the restore instructions

# 4. Restart backend
npm run dev
```

## Verification Checklist

- [ ] Database backup created successfully
- [ ] Migrations ran without errors
- [ ] Bootstrap key created and stored securely
- [ ] Old `ADMIN_API_KEY` removed from `.env`
- [ ] Backend starts without errors
- [ ] New key works for admin operations
- [ ] Test assets created/updated/deleted successfully
- [ ] All API clients updated
- [ ] API key usage can be viewed
- [ ] Key rotation tested in staging

## Troubleshooting

### "API key not found" error

**Cause**: Using old key or new key not created properly

**Solution**:
1. Verify the key from bootstrap step
2. Create a new key: `npm run bootstrap-api-key`

### "Database migration failed"

**Cause**: Database is locked or has permission issues

**Solution**:
1. Check database connection: `npm run migrate:status`
2. For SQLite, ensure file permissions are correct: `chmod 666 dev.db`
3. For PostgreSQL, verify credentials and network access

### "Cannot find module" errors

**Cause**: Dependencies not installed

**Solution**:
```bash
rm -rf node_modules package-lock.json
npm install
npm run migrate
```

### Old key still works

**Cause**: This shouldn't happen; new system replaces old completely

**Solution**:
1. Verify you're using the correct endpoint
2. Check that app restart picked up changes
3. Verify migrations ran: `npm run migrate:status`

## Support

For additional help:
- Documentation: `docs/API_KEY_MANAGEMENT.md`
- Implementation Details: `API_KEY_IMPLEMENTATION_SUMMARY.md`
- Issues: Create a GitHub issue with full error logs

## Congratulations! 🎉

Your backend is now running on the secure multi-key API management system. Enjoy the benefits of:
- Multiple API keys for different purposes
- Automatic expiration and rotation
- Usage tracking and audit logs
- Enhanced security with hashed keys
