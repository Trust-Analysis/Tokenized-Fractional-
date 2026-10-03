# Database Backup & Restore

Automated, verifiable backups of every persistent data source the backend owns,
with offsite copies in S3 and an enforced retention policy.

## What gets backed up

| Source | Where it lives | How it's captured |
| --- | --- | --- |
| Asset metadata | `backend/data.json` | gzipped copy |
| Webhooks | `backend/webhooks.json` | gzipped copy |
| SQL database (dev/test) | SQLite file from `DATABASE_URL` (default `dev.db`) | consistent online snapshot via `better-sqlite3`, then gzipped |
| SQL database (prod) | PostgreSQL via `DATABASE_URL` | `pg_dump`, then gzipped |

Each run produces a directory:

```
backend/backups/
└── backup-2026-06-30T03-00-00-000Z/
    ├── data.json.gz
    ├── webhooks.json.gz
    ├── database.sqlite.gz        # or database.sql.gz for PostgreSQL
    └── manifest.json             # SHA-256 of each member + metadata
```

The `manifest.json` records the SHA-256 of every source file. Verification
re-derives those hashes from the stored copies, so a truncated or corrupted
backup is caught before anyone relies on it.

## Running a backup manually

```bash
cd backend
npm run backup          # create → verify → upload to S3 (if configured) → rotate
npm run backup:list     # list local backups
npm run backup:verify   # re-verify the most recent backup
```

A backup run exits non-zero if creation or verification fails, so it is safe to
wire into cron or CI.

## Configuration

All settings are environment variables (see `backend/.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_DIR` | `backend/backups` | local backup location |
| `BACKUP_RETENTION_DAYS` | `7` | delete backups older than N days (0 = disabled) |
| `BACKUP_RETENTION_MAX` | `30` | keep at most N backups (0 = disabled) |
| `BACKUP_DATA_FILES` | `data.json,webhooks.json` | extra files to include |
| `BACKUP_ENABLED` | unset | enable the in-process scheduler |
| `BACKUP_INTERVAL_HOURS` | `24` | scheduler interval |
| `BACKUP_S3_BUCKET` | unset | enable S3 offsite copies |
| `BACKUP_S3_PREFIX` | `backups` | key prefix in the bucket |
| `BACKUP_S3_REGION` | `AWS_REGION` or `us-east-1` | bucket region |
| `BACKUP_S3_ENDPOINT` | unset | S3-compatible endpoint (MinIO, R2, Spaces) |

## Scheduling backups

You have three ways to schedule backups; pick whichever fits your deployment.

### 1. GitHub Actions (recommended for offsite)

`.github/workflows/backup.yml` runs daily at **03:00 UTC**, uploads to S3, and
attaches the backup to the workflow run as a third copy. Add these repository
secrets: `DATABASE_URL`, `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` (optionally `BACKUP_S3_PREFIX`, `BACKUP_S3_REGION`).
Trigger an ad-hoc run from the **Actions** tab via *Run workflow*.

### 2. System cron (on the host running the backend)

```cron
# Daily backup at 03:00, weekly verification on Sundays.
0 3 * * *   cd /app/backend && /usr/bin/npm run backup    >> /var/log/rwa-backup.log 2>&1
0 4 * * 0   cd /app/backend && /usr/bin/npm run backup:verify >> /var/log/rwa-backup.log 2>&1
```

### 3. In-process scheduler

For platforms without cron, set `BACKUP_ENABLED=true` (and optionally
`BACKUP_INTERVAL_HOURS`). The server then runs a backup on that interval. This
is the simplest option but only runs while the process is up — prefer cron or CI
for production.

## Offsite storage (S3)

Set `BACKUP_S3_BUCKET` and install the AWS SDK:

```bash
cd backend && npm install @aws-sdk/client-s3
```

Each backup is uploaded under `s3://<bucket>/<prefix>/backup-<timestamp>/`.
Credentials use the standard AWS env vars. S3-compatible stores (MinIO,
Cloudflare R2, DigitalOcean Spaces) work by setting `BACKUP_S3_ENDPOINT`.

The retention policy is applied to S3 as well as local copies, so old offsite
backups are pruned automatically.

## Retention / rotation

After each successful run, backups that are **older than
`BACKUP_RETENTION_DAYS`** OR that push the total **above `BACKUP_RETENTION_MAX`**
(oldest dropped first) are deleted — locally and in S3. The defaults keep one
week of daily backups, capped at 30. Set a limit to `0` to disable it.

## Restore process

> ⚠️ Restoring overwrites current data. Any file that would be overwritten is
> first moved aside to `<file>.pre-restore`, so a restore is reversible.

1. **Find the backup to restore**

   ```bash
   cd backend
   npm run restore -- --list
   ```

2. **(If offsite) download from S3 first** — this is done automatically by
   `--from-s3`, which fetches the backup into `BACKUP_DIR` and then restores it.

3. **Restore**

   ```bash
   # From a local backup:
   node restore.js backup-2026-06-30T03-00-00-000Z

   # From S3:
   node restore.js --from-s3 backup-2026-06-30T03-00-00-000Z

   # Restore even if verification fails (last resort):
   node restore.js backup-2026-06-30T03-00-00-000Z --force
   ```

   This restores `data.json`, `webhooks.json`, and a SQLite database in place.

4. **PostgreSQL restore is manual** (it overwrites a live DB, so it is never run
   automatically). The dump is written to `backend/restore-database.sql`; apply
   it with:

   ```bash
   psql "$DATABASE_URL" < backend/restore-database.sql
   ```

5. **Restart the backend** so it picks up the restored data.

## Verifying disaster recovery

Periodically rehearse a restore into a throwaway location to prove backups are
usable:

```bash
cd backend
npm run backup:verify                       # checksums of the latest backup
BACKUP_DIR=/tmp/dr-test node restore.js --from-s3 <name>   # restore offsite copy
```
