# Backup System Implementation Guide

## Overview

This guide provides detailed setup and configuration instructions for the automated backup and restore system.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Backup System                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐                                          │
│  │  Data Sources│                                          │
│  ├──────────────┤                                          │
│  │ - data.json  │                                          │
│  │ - webhooks   │                                          │
│  │ - database   │                                          │
│  └──────┬───────┘                                          │
│         │                                                  │
│         ├─→ Create Backup ──→ Verify ──→ Upload            │
│         │                                                  │
│         └─→ Local Storage                                  │
│             ├─→ S3                                         │
│             ├─→ GCS                                        │
│             └─→ Manage Retention                           │
│                                                             │
│  Restore Flow:                                             │
│  Cloud Storage ──→ Download ──→ Verify ──→ Restore        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install

# For S3 support
npm install @aws-sdk/client-s3

# For GCS support (optional)
npm install @google-cloud/storage
```

### 2. Configuration

Create or update `.env`:

```bash
# Enable backups
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24

# Local storage
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=7
BACKUP_RETENTION_MAX=30

# S3 (required for production)
BACKUP_S3_BUCKET=my-company-rwa-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_PREFIX=production

# GCS (optional secondary backup)
BACKUP_GCS_BUCKET=my-company-rwa-backups-gcs
BACKUP_GCS_PROJECT_ID=my-project
BACKUP_GCS_KEY_FILE=/path/to/service-account-key.json
```

### 3. AWS Configuration

**Option A: Environment Variables**

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

**Option B: AWS Credentials File**

```bash
~/.aws/credentials
[default]
aws_access_key_id = YOUR_ACCESS_KEY
aws_secret_access_key = YOUR_SECRET_KEY

~/.aws/config
[default]
region = us-east-1
```

**Option C: IAM Role (EC2/ECS/Lambda)**

Attach policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-company-rwa-backups",
        "arn:aws:s3:::my-company-rwa-backups/*"
      ]
    }
  ]
}
```

### 4. GCS Configuration (Optional)

**Create Service Account Key:**

```bash
# In Google Cloud Console:
# 1. Go to APIs & Services → Service Accounts
# 2. Create service account
# 3. Add role: Storage Admin
# 4. Create key (JSON)
# 5. Save to file, e.g., /etc/backup/gcs-key.json

export BACKUP_GCS_KEY_FILE=/etc/backup/gcs-key.json
```

## API Integration

### Add Backup Routes to App

In `src/app.js`:

```javascript
import { createBackupRoutes } from './routes/backups.js';
import { createBackupService } from './services/backupService.js';

// After initializing app and authentication...

// Initialize backup service
const backupModule = await import('../backup.js');
const backupService = createBackupService(
  backupModule,
  loadBackupConfig(),
  logger
);

// Mount routes (behind adminAuth)
app.use('/api/v1/backups', adminAuth, createBackupRoutes(backupService, logger));
app.use('/api/backups', adminAuth, createBackupRoutes(backupService, logger));
```

### Register with Initialization

In `src/app.js` `initializeApp()`:

```javascript
// Start backup scheduler if enabled
if (process.env.BACKUP_ENABLED === 'true') {
  backupService.startScheduler({ 
    intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS || '24')
  });
}
```

## Usage

### Manual Backup

```bash
# Via API
curl -X POST http://localhost:3001/api/v1/backups \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json"

# Via CLI
npm run backup
```

### List Backups

```bash
# Via API
curl http://localhost:3001/api/v1/backups \
  -H "x-api-key: rwa_..."

# Via CLI
npm run backup:list
```

### Verify Backup

```bash
# Via API
curl http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/verify \
  -H "x-api-key: rwa_..."

# Via CLI
npm run backup:verify
```

### Restore Backup

```bash
# Via API (from S3)
curl -X POST http://localhost:3001/api/v1/backups/backup-2026-06-30T09-30-00-000Z/restore \
  -H "x-api-key: rwa_..." \
  -H "Content-Type: application/json" \
  -d '{"source": "s3"}'

# Via CLI
npm run restore backup-2026-06-30T09-30-00-000Z --from-s3
```

### Health Check

```bash
curl http://localhost:3001/api/v1/backups/health \
  -H "x-api-key: rwa_..."
```

## Scheduled Backups

### Option 1: In-Process (Development)

Set in `.env`:

```
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
```

Backend will automatically create backups.

### Option 2: GitHub Actions (Recommended)

Create `.github/workflows/backup.yml`:

```yaml
name: Database Backup

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
      
      - run: cd backend && npm install
      
      - run: npm run backup
        env:
          BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
          BACKUP_S3_REGION: ${{ secrets.BACKUP_S3_REGION }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Add secrets to repository settings.

### Option 3: Kubernetes CronJob

Create `backup-cronjob.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: rwa-backup
  namespace: production
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: backup-sa
          containers:
          - name: backup
            image: my-registry/rwa-backend:latest
            imagePullPolicy: Always
            command:
            - /bin/sh
            - -c
            - cd /app/backend && npm run backup
            env:
            - name: NODE_ENV
              value: "production"
            - name: BACKUP_S3_BUCKET
              valueFrom:
                secretKeyRef:
                  name: backup-config
                  key: s3-bucket
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: backup-config
                  key: aws-access-key
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: backup-config
                  key: aws-secret-key
          restartPolicy: OnFailure
```

### Option 4: Traditional Cron

Create `/etc/cron.d/rwa-backup`:

```
# Run backup at 2 AM daily
0 2 * * * root cd /opt/rwa-backend && npm run backup >> /var/log/rwa-backup.log 2>&1
```

Or use `curl`:

```bash
#!/bin/bash
# /usr/local/bin/rwa-backup.sh

API_URL="http://localhost:3001/api/v1/backups"
API_KEY="$BACKUP_API_KEY"

curl -X POST "$API_URL" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -w "\nBackup status: %{http_code}\n"
```

Add to crontab:

```
0 2 * * * /usr/local/bin/rwa-backup.sh
```

## Monitoring & Alerts

### Health Check Script

```bash
#!/bin/bash
# check-backup-health.sh

HEALTH_URL="http://localhost:3001/api/v1/backups/health"
API_KEY="$BACKUP_API_KEY"

RESPONSE=$(curl -s "$HEALTH_URL" -H "x-api-key: $API_KEY")
STATUS=$(echo "$RESPONSE" | jq -r '.status')
AGE=$(echo "$RESPONSE" | jq -r '.latestBackup.age')

if [ "$STATUS" != "healthy" ]; then
  echo "ALERT: Backup system degraded"
  exit 1
fi

# Check if backup is older than 2 days
DAYS=$(echo "$AGE" | cut -d'd' -f1)
if [ "$DAYS" -gt 2 ]; then
  echo "ALERT: Latest backup is $DAYS days old"
  exit 1
fi

echo "OK: Backup system healthy ($AGE)"
exit 0
```

### Prometheus Metrics

Monitor via `/metrics` endpoint (Prometheus format):

```promql
# Backup lag (days)
(time() - last_backup_timestamp) / 86400

# Backup system health
backup_status{status="healthy"} == 1

# Total backups
backup_count
```

### Email Alerts

```bash
#!/bin/bash
# alert-backup-failure.sh

HEALTH=$(curl -s http://localhost:3001/api/v1/backups/health \
  -H "x-api-key: $BACKUP_API_KEY" | jq '.status')

if [ "$HEALTH" != '"healthy"' ]; then
  mail -s "Alert: RWA Backup System Failure" devops@example.com << EOF
Backup system is not healthy: $HEALTH
Check logs at /var/log/rwa/backup.log
EOF
fi
```

## Disaster Recovery Testing

### Monthly Restore Test

1. **Schedule**: First Sunday of each month
2. **Procedure**:

```bash
# 1. List available backups
curl http://localhost:3001/api/v1/backups/health \
  -H "x-api-key: $API_KEY"

# 2. Choose backup to test
BACKUP_NAME="backup-2026-06-30T09-30-00-000Z"

# 3. Verify integrity
curl http://localhost:3001/api/v1/backups/$BACKUP_NAME/verify \
  -H "x-api-key: $API_KEY" | jq '.ok'

# 4. Restore to test database
# Set TEST_DATABASE=test-restore, then restore

# 5. Verify data
psql $TEST_DATABASE -c "SELECT COUNT(*) FROM assets;"

# 6. Clean up
dropdb $TEST_DATABASE

# 7. Document result
echo "Restore test successful: $BACKUP_NAME" >> /var/log/restore-tests.log
```

3. **Success Criteria**:
   - ✓ Backup verified successfully
   - ✓ Data restored without errors
   - ✓ All tables accessible
   - ✓ Data integrity confirmed

## Troubleshooting

### Debug Backup Creation

```bash
BACKUP_ENABLED=false NODE_ENV=development npm run backup
```

Check output for errors.

### Debug S3 Upload

```bash
# Test AWS credentials
aws s3 ls s3://my-company-rwa-backups/

# Test put
aws s3 cp /tmp/test.txt s3://my-company-rwa-backups/test.txt

# Check objects
aws s3api list-objects-v2 --bucket my-company-rwa-backups
```

### Check Backup Size

```bash
# Local backups
du -sh backend/backups/*

# S3 backups
aws s3api list-objects-v2 --bucket my-company-rwa-backups \
  --query 'Contents[].Size' --output json | jq 'add / 1048576' # Convert to MB
```

### Restore from Corrupted Backup

```bash
# With force flag to skip verification
curl -X POST http://localhost:3001/api/v1/backups/backup-corrupted/restore \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

## Security Best Practices

1. **Restrict API Access**
   - Only grant backup API access to admin users
   - Use separate API keys for backup operations

2. **Encrypt at Rest**
   - Enable S3 encryption
   - Enable GCS encryption
   - Use encrypted storage for local backups

3. **Encrypt in Transit**
   - Use HTTPS for all API calls
   - Enable S3 TLS
   - Use service account keys for GCS

4. **Access Control**
   - Limit IAM roles to minimum needed permissions
   - Regularly rotate credentials
   - Audit all restore operations

5. **Retention**
   - Keep backups longer for compliance (30+ days)
   - Archive for long-term retention
   - Follow data protection regulations

## Maintenance

### Update Dependencies

```bash
npm update @aws-sdk/client-s3
npm update @google-cloud/storage
```

### Rotate Credentials

Monthly credential rotation:

```bash
# Generate new AWS credentials
aws iam create-access-key --user-name backup-user

# Update .env or secrets manager
# Verify backup works
npm run backup

# Delete old credentials
aws iam delete-access-key --user-name backup-user \
  --access-key-id AKIA...
```

### Review Retention Policy

Quarterly review of retention settings based on:
- Storage costs
- Compliance requirements
- Recovery objectives
- Backup frequency

## Support & References

- AWS S3: https://docs.aws.amazon.com/s3/
- Google Cloud Storage: https://cloud.google.com/storage/docs
- Backup System Docs: `docs/BACKUP_SYSTEM.md`
