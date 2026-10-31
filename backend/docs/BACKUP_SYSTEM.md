# Automated Backup & Restore System

Comprehensive backup and disaster recovery system for the RWA Marketplace backend with support for scheduled backups to multiple cloud storage providers (S3, GCS) and point-in-time restore operations.

## Overview

The backup system provides:

- **Automated Scheduled Backups** - Configurable interval-based backups
- **Multi-Cloud Support** - S3, Google Cloud Storage, or local storage
- **Point-in-Time Restore** - Restore to any previous backup state
- **Integrity Verification** - SHA-256 checksums for all backup members
- **Retention Policies** - Automatic cleanup of old backups
- **Health Monitoring** - REST API for backup system status
- **Disaster Recovery** - Quick restore in case of data loss

## Architecture

### Data Sources

Backups include:
- **JSON Data Files** - `data.json`, `webhooks.json`
- **Database** - SQLite (online backup) or PostgreSQL (via pg_dump)
- **Manifest** - `manifest.json` with checksums and metadata

### Storage Destinations

| Destination | Primary Use | Recovery Time | Cost |
|------------|------------|---------------|------|
| Local | Development, staging | Immediate | None |
| S3 | Production, redundancy | Minutes | Low |
| GCS | Multi-region backup | Minutes | Low |

### Backup Lifecycle

```
Create Backup
    ↓
Verify (SHA-256 checksums)
    ↓
Upload to Cloud Storage
    ↓
Apply Retention Policy
    ↓
Clean Up Old Backups
```

## Configuration

### Environment Variables

```bash
# Enable/disable backups
BACKUP_ENABLED=true

# Backup interval (hours, default: 24)
BACKUP_INTERVAL_HOURS=24

# Local backup directory
BACKUP_DIR=./backups

# Files to backup
BACKUP_DATA_FILES=data.json,webhooks.json

# Retention policy
BACKUP_RETENTION_DAYS=7      # Delete after 7 days
BACKUP_RETENTION_MAX=30      # Keep max 30 backups

# S3 Configuration
BACKUP_S3_BUCKET=my-backups
BACKUP_S3_PREFIX=rwa-marketplace
BACKUP_S3_REGION=us-east-1
# Optional S3-compatible storage
BACKUP_S3_ENDPOINT=https://minio.example.com

# GCS Configuration
BACKUP_GCS_BUCKET=my-backups
BACKUP_GCS_PREFIX=rwa-marketplace
BACKUP_GCS_PROJECT_ID=my-project
BACKUP_GCS_KEY_FILE=/path/to/service-account-key.json
```

## API Endpoints

All backup endpoints require valid API key authentication.

### List Backups

```http
GET /api/v1/backups
x-api-key: rwa_...
```

**Response** (200 OK):

```json
{
  "data": [
    {
      "name": "backup-2026-06-30T09-30-00-000Z",
      "createdAt": "2026-06-30T09:30:00.000Z",
      "locations": ["local", "s3", "gcs"],
      "verified": false,
      "size": 1048576
    }
  ],
  "count": 1
}
```

### Get Health Status

```http
GET /api/v1/backups/health
x-api-key: rwa_...
```

**Response** (200 OK):

```json
{
  "status": "healthy",
  "totalBackups": 5,
  "latestBackup": {
    "name": "backup-2026-06-30T09-30-00-000Z",
    "createdAt": "2026-06-30T09:30:00.000Z",
    "age": "2d 1h"
  },
  "metrics": {
    "successCount": 48,
    "failureCount": 0,
    "lastBackupTime": "2026-06-30T09:30:00.000Z",
    "lastBackupSize": 1048576,
    "lastError": null
  }
}
```

### Get Backup Policy

```http
GET /api/v1/backups/policy
x-api-key: rwa_...
```

**Response** (200 OK):

```json
{
  "retention": {
    "days": 7,
    "max": 30
  },
  "destinations": {
    "local": true,
    "s3": true,
    "gcs": false
  },
  "s3": {
    "bucket": "my-backups",
    "region": "us-east-1"
  },
  "gcs": null
}
```

### Create Manual Backup

```http
POST /api/v1/backups
x-api-key: rwa_...
```

**Response** (201 Created):

```json
{
  "success": true,
  "name": "backup-2026-06-30T09-35-00-000Z",
  "locations": ["local", "s3"],
  "duration": 3500,
  "size": 1048576,
  "timestamp": "2026-06-30T09:35:00.000Z"
}
```

### Verify Backup

```http
GET /api/v1/backups/{name}/verify
x-api-key: rwa_...
```

**Response** (200 OK):

```json
{
  "name": "backup-2026-06-30T09-30-00-000Z",
  "ok": true,
  "members": [
    {
      "name": "data.json.gz",
      "ok": true,
      "error": null
    },
    {
      "name": "webhooks.json.gz",
      "ok": true,
      "error": null
    },
    {
      "name": "database.sqlite.gz",
      "ok": true,
      "error": null
    }
  ],
  "verifiedAt": "2026-06-30T09:35:00.000Z"
}
```

### Restore Backup

```http
POST /api/v1/backups/{name}/restore
x-api-key: rwa_...
Content-Type: application/json

{
  "source": "s3",  // optional: "local", "s3", or "gcs"
  "force": false   // optional: skip verification if corrupt
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "name": "backup-2026-06-30T09-30-00-000Z",
  "files": [
    "/backend/data.json",
    "/backend/webhooks.json",
    "/backend/database.sqlite"
  ],
  "duration": 2500,
  "timestamp": "2026-06-30T09:35:00.000Z",
  "warning": "Data has been restored. Review changes carefully."
}
```

## Usage Examples

### Enable Automated Backups

```bash
# Set in .env
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_S3_BUCKET=my-backups
BACKUP_S3_REGION=us-east-1

# Restart backend
npm run dev
```

### Manually Trigger Backup

```bash
curl -X POST http://localhost:3001/api/v1/backups \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json"
```

### Check Backup Health

```bash
curl http://localhost:3001/api/v1/backups/health \
  -H "x-api-key: rwa_..."
```

### Restore from Backup

```bash
# Restore from S3 (downloads automatically)
curl -X POST http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/restore \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"source": "s3"}'

# Restore from local with force flag (skip verification)
curl -X POST http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/restore \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### List All Backups

```bash
curl http://localhost:3001/api/v1/backups \
  -H "x-api-key: rwa_..."
```

### Verify a Backup

```bash
curl http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/verify \
  -H "x-api-key: rwa_..."
```

## Scheduled Backups

### In-Process Scheduler

The simplest approach (development/staging):

```bash
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
```

The backend will automatically run backups every 24 hours.

### GitHub Actions Workflow

For production, use GitHub Actions (recommended):

```yaml
name: Backup Database

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC daily

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -D
      - run: npm run backup
        env:
          BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Kubernetes CronJob

For Kubernetes deployments:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-job
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: my-registry/rwa-backend:latest
            command: ["npm", "run", "backup"]
            env:
            - name: BACKUP_S3_BUCKET
              valueFrom:
                secretKeyRef:
                  name: backup-secrets
                  key: s3-bucket
          restartPolicy: OnFailure
```

### External Cron/Scheduler

For other platforms, use direct API calls:

```bash
#!/bin/bash
# backup-cron.sh

BACKUP_URL="https://api.example.com/api/v1/backups"
API_KEY="rwa_..."

curl -X POST "$BACKUP_URL" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  | jq '.success'
```

## Disaster Recovery

### Scenario: Data Loss or Corruption

**Step 1: Verify Backup Integrity**

```bash
curl http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/verify \
  -H "x-api-key: rwa_..."
```

**Step 2: Review Backup Source**

```bash
curl http://localhost:3001/api/v1/backups \
  -H "x-api-key: rwa_..." | jq '.data[] | {name, locations}'
```

**Step 3: Stop the Application**

```bash
pm2 stop rwa-backend
# or: docker stop rwa-backend
```

**Step 4: Restore from Backup**

```bash
# If backup is in S3
curl -X POST http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/restore \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"source": "s3"}'

# If local backup
curl -X POST http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/restore \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json"
```

**Step 5: Restart Application**

```bash
pm2 restart rwa-backend
# or: docker start rwa-backend
```

**Step 6: Verify Data**

```bash
curl http://localhost:3001/api/v1/rwa \
  -H "x-api-key: rwa_..."
```

## Best Practices

### Retention Policy

- **Development**: 7 days, max 30 backups
- **Staging**: 14 days, max 60 backups
- **Production**: 30 days, max 90 backups

### Multi-Cloud Strategy

Always backup to **at least two cloud providers**:

```bash
# Good: S3 + GCS
BACKUP_S3_BUCKET=prod-backups
BACKUP_GCS_BUCKET=prod-backups-gcs

# Excellent: S3 + GCS + Local
BACKUP_DIR=/mnt/backup-storage
```

### Monitoring & Alerts

Monitor backup health regularly:

```bash
# Check health every 6 hours
*/6 * * * * curl -f http://localhost:3001/api/v1/backups/health || alert
```

### Backup Rotation

Automatic rotation removes old backups per policy:

- Backups older than `BACKUP_RETENTION_DAYS` are deleted
- If count exceeds `BACKUP_RETENTION_MAX`, oldest are removed
- Applied to both local and cloud storage

### Point-in-Time Recovery

For compliance, keep backups at these intervals:

```
Hourly:   0, 1, 2, ..., 23 (24 backups)
Daily:    Mon, Tue, ..., Sun (7 backups)
Weekly:   Week 1, 2, 3, 4 (4 backups)
Monthly:  Jan, Feb, ..., Dec (12 backups)
```

## Troubleshooting

### Backup Failed to Upload to S3

**Error**: `S3 upload failed: Access Denied`

**Solution**:
1. Verify AWS credentials: `echo $AWS_ACCESS_KEY_ID`
2. Check IAM policy has S3 permissions
3. Verify bucket name and region
4. Test with: `aws s3 ls s3://bucket-name/`

### Restore Shows "Verification Failed"

**Error**: `backup failed verification: checksum mismatch`

**Solution**:
1. Use `--force` flag to skip verification
2. Re-download backup from cloud storage
3. Contact cloud provider if corruption persists

### Backup Size Growing Too Large

**Issue**: Backups consume excessive disk space

**Solution**:
1. Reduce `BACKUP_RETENTION_DAYS`
2. Reduce `BACKUP_RETENTION_MAX`
3. Archive old backups separately
4. Consider compression settings

### PostgreSQL Restore Fails

**Error**: `psql: command not found`

**Solution**:
1. Install PostgreSQL client: `sudo apt install postgresql-client`
2. Set `DATABASE_URL` correctly
3. Verify database connection: `psql "$DATABASE_URL" -c 'SELECT 1'`

## Security Considerations

### Access Control

- Only authenticated users with valid API keys can access backup endpoints
- Consider adding role-based access (e.g., `BACKUP_ADMIN` role)
- Audit all restore operations

### Encryption

Enable encryption for cloud storage:

**S3**:
```
Bucket Properties → Default Encryption → Enable
```

**GCS**:
```
Bucket Settings → Protection Tools → Encryption
```

### Credentials Management

Never hardcode credentials:

```bash
# Bad
BACKUP_S3_BUCKET=prod-backups
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE

# Good
AWS_ACCESS_KEY_ID=$(aws secretsmanager get-secret-value --secret-id backup-creds | jq -r .SecretString)
```

## Monitoring & Metrics

Monitor via the health endpoint:

```json
{
  "status": "healthy|degraded",
  "totalBackups": 5,
  "latestBackup": { "name": "...", "age": "2d 1h" },
  "metrics": {
    "successCount": 48,
    "failureCount": 0,
    "lastBackupTime": "2026-06-30T09:30:00.000Z",
    "lastBackupSize": 1048576
  }
}
```

### Alerts to Set

1. **No recent backup** - If `latestBackup.age > 48h`
2. **Backup failures** - If `failureCount > 0`
3. **Large backup size** - If `lastBackupSize > 1GB`
4. **Degraded status** - If `status !== "healthy"`

## Performance

### Backup Duration

- Local backups: 2-5 seconds
- S3 upload: 5-30 seconds (depends on size and network)
- GCS upload: 5-30 seconds

### Storage Usage

Example with 10MB databases:
- Uncompressed: ~10MB
- Compressed (gzip): ~2-3MB
- 7-day retention: ~20-30MB
- 30 backups: ~60-90MB

## References

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [Google Cloud Storage Documentation](https://cloud.google.com/storage/docs)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [Better-sqlite3 Backup API](https://github.com/WiseLibs/better-sqlite3/wiki/API%3A-Database#backup)
