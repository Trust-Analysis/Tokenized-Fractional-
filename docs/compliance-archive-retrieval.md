# Compliance Data Archive & Retrieval Guide

This document defines the storage security model, encryption mechanisms, and audit retrieval procedures for compliance data managed by `backend/src/services/archiveService.js` (Issue #319, Issue #911).

---

## 1. Archiving & Security Architecture

Financial transactions, user activity, and analytics records are retained according to regulatory compliance windows:

| Data Type | Retention in DB | Config Variable | Default Retention |
|---|---|---|---|
| Financial Transactions | 365 days | `TRANSACTION_RETENTION_DAYS` | 1 year |
| User Activity Logs | 90 days | `ACTIVITY_RETENTION_DAYS` | 90 days |
| Historical Analytics | 730 days | `ANALYTICS_RETENTION_DAYS` | 2 years |

When records exceed their retention window, `archiveService.js` removes them from the primary database while preserving complete, tamper-evident records.

### Encryption at Rest (AES-256-GCM)

All archive records are encrypted before leaving process memory:
- **Cipher**: `AES-256-GCM` (authenticated encryption).
- **Initialization Vector**: Cryptographically random 96-bit (12-byte) IV per archive.
- **Authentication Tag**: 128-bit authentication tag validating data authenticity and integrity.
- **Encryption Key**: Configured via `ARCHIVE_ENCRYPTION_KEY` (32 bytes / 256 bits). In development, a fallback key is derived with an explicit warning.

### Off-Site Durable Replication (Amazon S3)

To avoid reliance on ephemeral local pod disks, archives are replicated to Amazon S3 or compatible object storage:
- **S3 Bucket**: `ARCHIVE_S3_BUCKET`
- **S3 Prefix**: `ARCHIVE_S3_PREFIX` (default: `compliance-archives`)
- **Server-Side Encryption (SSE)**: `ARCHIVE_S3_SSE` enforces `AES256` or `aws:kms` encryption at rest on S3.
- **Local Cleanup**: When `ARCHIVE_RETAIN_LOCAL` is `false` and S3 upload succeeds, local staging files are unlinked to maintain a zero-local-footprint posture.

---

## 2. Configuration Parameters

| Variable | Description | Default |
|---|---|---|
| `ARCHIVE_ENCRYPTION_KEY` | 256-bit encryption key (hex or string) | *(required in production)* |
| `ARCHIVE_S3_BUCKET` | Destination S3 bucket for durable off-site backup | `null` |
| `ARCHIVE_S3_PREFIX` | Object storage folder prefix | `compliance-archives` |
| `ARCHIVE_S3_REGION` | AWS region for archive bucket | `us-east-1` |
| `ARCHIVE_S3_SSE` | S3 Server-Side Encryption algorithm | `AES256` |
| `ARCHIVE_RETAIN_LOCAL` | Retain local encrypted copy alongside S3 | `false` (when S3 configured) |
| `ARCHIVE_DIR` | Local staging/archive directory | `./archives` |

---

## 3. Compliance Audit Retrieval Process

When responding to an audit, legal discovery request, or regulatory inquiry for historical transaction records:

### Step 1: Identify Relevant Archive IDs

List available archives and review metadata (archive IDs, record types, dates, and record counts):

```javascript
import { listArchives } from './src/services/archiveService.js';

const archives = await listArchives();
console.table(archives);
```

### Step 2: Retrieve & Decrypt Records

Retrieve the archive using `retrieveArchive(archiveId)`. The service automatically fetches the record from S3 (or local disk if cached), verifies the AES-256-GCM authentication tag, and decrypts the payload:

```javascript
import { retrieveArchive } from './src/services/archiveService.js';

const archive = await retrieveArchive('transactions_2026-05-01T00-00-00-000Z');
console.log(`Retrieved ${archive.count} records from ${archive.archivedAt}`);
console.log(archive.data);
```

### Step 3: Export Verified Compliance Package

For formal auditor delivery, generate an authenticated audit package using `exportArchiveForAudit(archiveId)`:

```javascript
import { exportArchiveForAudit } from './src/services/archiveService.js';

const compliancePackage = await exportArchiveForAudit('transactions_2026-05-01T00-00-00-000Z');
// Writes output containing:
// - complianceAudit: { archiveId, recordCount, dataSha256Digest, verifiedAuthentic: true, exportedAt }
// - records: [ ...decrypted transactions ]
```

### Step 4: Selective Database Restoration (if required)

If an investigation requires re-querying historical records through standard database queries:

```javascript
import { restoreFromArchive } from './src/services/archiveService.js';

const result = await restoreFromArchive('transactions_2026-05-01T00-00-00-000Z');
console.log(`Restored ${result.restoredCount} records into primary database`);
```

Restoration uses idempotent upserts inside a database transaction to prevent duplicate primary keys or partial restores.
