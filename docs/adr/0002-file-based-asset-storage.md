# ADR-0002: File-Based Asset Storage (data.json) for Metadata

**Date:** 2026-06-28  
**Status:** Accepted  
**Author:** Team

## Context

The marketplace requires storing asset metadata (name, description, image, details) that is displayed to users. Options considered were:
- Traditional relational database (PostgreSQL, MySQL)
- NoSQL document store (MongoDB)
- File-based JSON storage
- Blockchain storage (too expensive for metadata)

The solution needed to be simple to deploy, easy to maintain, and suitable for a demonstration/proof-of-concept.

## Decision

We chose **file-based JSON storage** using a `data.json` file managed by the backend Express.js API. Asset metadata is stored in this single JSON file and served via REST API endpoints.

## Consequences

### Positive
- **Simple deployment**: No database server required; works with static file hosting
- **Easy to understand**: Straightforward data structure for developers
- **Low operational overhead**: No database administration or scaling needed
- **Quick prototyping**: Fast iteration during development
- **Version control friendly**: JSON files can be tracked in Git
- **Testable**: Easy to create fixtures and test data

### Negative
- **Not horizontally scalable**: Single file becomes a bottleneck at scale
- **Concurrent writes risky**: Multiple simultaneous updates can cause corruption
- **No indexing**: Full file reads on every query
- **Limited querying**: Cannot perform complex database queries
- **No transactions**: Cannot ensure ACID properties across operations
- **Suitable only for small datasets**: Performance degrades with large numbers of assets

## Alternatives Considered

### PostgreSQL Database
Rejected for MVP due to additional deployment complexity and operational overhead. Better for production with large asset catalogs.

### MongoDB / NoSQL
Rejected due to unnecessary complexity for the current use case; file-based approach simpler for MVP.

### Blockchain Storage (IPFS/Arweave)
Rejected due to cost and complexity; metadata doesn't need blockchain immutability.

## Notes

- **Upgrade path**: Can migrate to PostgreSQL when MVP outgrows current limitations
- **API layer**: The Express backend abstracts storage, making future migration transparent
- **Locking**: Consider implementing file-locking if concurrent writes become an issue
- **Backup strategy**: Regular backups of `data.json` recommended for production
