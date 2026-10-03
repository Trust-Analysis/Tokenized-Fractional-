# Soft Delete Pattern Implementation Guide

To maintain data integrity, historical audit trails, and compliance requirements, the RWA Marketplace implements a robust soft delete pattern.

## 1. Schema & Indexing
- **`deleted_at` Timestamp:** Core tables (`assets`, `api_keys`, `transactions`) include a nullable `deleted_at` timestamp.
- **Partial Indexes:** PostgreSQL partial indexes (`WHERE deleted_at IS NULL`) ensure that queries ignoring soft-deleted records execute with maximum performance.

## 2. Query Filtering
The `SoftDeleteService.activeQuery(tableName)` automatically appends `.whereNull('deleted_at')`, ensuring soft-deleted records are hidden from standard application queries by default.

## 3. Recovery & Retention Cleanup
- **Restoration:** Soft-deleted items can be instantly recovered via `restore()` by resetting `deleted_at` to `null`.
- **Retention & Cleanup:** An automated job (`runRetentionCleanup`) permanently purges records that have exceeded the retention window (default 30 days).
