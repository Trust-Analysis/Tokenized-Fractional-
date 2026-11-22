# Webhook Retention, Rotation, and Secret Security (#1108)

## Retention & Rotation Policy

- **Delivery Log Cap**: Webhook delivery logs are bounded by `WEBHOOK_MAX_DELIVERY_LOGS` (default: `500` recent records). When new entries exceed the cap, oldest entries are pruned/rotated so log memory and persisted state do not grow unbounded.
- **File Rotation (`WEBHOOK_DATA_FILE`)**: Avoid letting `webhooks.json` and delivery logs accumulate without rotation next to `data.json`; rotate historical delivery entries into rotated archives and prune old archives according to retention limits.
- **Database Persistence**: For production environments, store webhook registrations and delivery logs in database tables (via Knex migrations under `backend/migrations/`) with retention cleanup jobs rather than relying solely on a local JSON file.

## Signing Secret Encryption at Rest

- Configure `WEBHOOK_SECRET_ENCRYPTION_KEY` (64-character hex / 256-bit key) to encrypt webhook signing secrets at rest using AES-256-GCM (`enc:v1:<iv>:<authTag>:<ciphertext>`) and decrypt only when signing or dispatching payloads.
- Do not log raw secrets or commit real `.env` or `webhooks.json` files to Git.
