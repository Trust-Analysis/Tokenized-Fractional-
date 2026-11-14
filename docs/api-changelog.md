# REST API Changelog

This document tracks all API-specific changes, additions, deprecations, and breaking changes for the Tokenized Fractional RWA REST API. Integrators can monitor this log for endpoint modifications without reviewing unrelated smart contract or frontend updates.

---

## [1.2.0] - 2026-10-20
### Added
- **Named Admin API Keys (#652):** Introduced multi-key registry mapping named operators (`admin-alice`, `admin-bob`, `system-ci`) to unique API keys with structured audit logging for all write operations (`POST`, `PATCH`, `DELETE`).
- **Content-Type Header Enforcement (#782):** Strictly validate `Content-Type: application/json` on all write endpoints (`POST /api/rwa`, `PATCH /api/rwa/:contractId`), returning `415 Unsupported Media Type` for missing or incorrect headers.
- **Partial Update Semantics Documentation & Validation (#654):** Officially documented patchable vs. immutable fields (`contractId`, `createdAt`, `creator`) for `PATCH /api/rwa/:contractId` and added strict validation rejecting unknown/immutable fields with `400 Bad Request`.

## [1.1.0] - 2026-09-15
### Added
- **API Versioning Support:** Mounted all resource routes under `/api/v1` with backward-compatible aliases at `/api/*` returning `Deprecation: true` headers and `X-API-Version: 1`.
- **Full-Text Search Endpoint:** Added `/api/v1/rwa/search` supporting facet filtering and relevance scoring.

## [1.0.0] - 2026-06-01
### Added
- Initial release of the Tokenized Fractional RWA backend API.
- Core CRUD management for approved and pending real-world assets.
