# GraphQL Federation Architecture Documentation

This document describes the GraphQL Federation architecture for the Tokenized RWA Marketplace backend.

## Overview

The GraphQL schema is decomposed into domain-driven **subgraphs** composed into a unified supergraph via **Apollo Gateway**:

```
                  ┌────────────────────────┐
                  │     Apollo Gateway     │  (/graphql)
                  └───────────┬────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Assets Subgraph │ │  Users Subgraph  │ │Transactions S.G. │
│ (/graphql/assets)│ │ (/graphql/users) │ │(/graphql/trans..)│
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

All subgraphs execute **in-process** via Apollo's `LocalGraphQLDataSource` for maximum performance (zero network I/O overhead between Gateway and Subgraphs).

---

## Service Boundaries & Entity Types

### 1. Assets Subgraph (`RWA` entity)
- **Entity**: `RWA @key(fields: "contractId")`
- **Responsibilities**: RWA metadata, valuation, available shares, listing status, approval lifecycle, and search.
- **Key Fields**: `contractId` (primary key on Stellar network).

### 2. Users Subgraph (`User` entity)
- **Entity**: `User @key(fields: "walletAddress")`
- **Responsibilities**: User profile, KYC status, tier, and share holdings across assets.
- **External References**: References `RWA` from Assets subgraph to associate holdings with asset details.

### 3. Transactions Subgraph (`Transaction` entity)
- **Entity**: `Transaction @key(fields: "transactionId")`
- **Responsibilities**: Off-chain and on-chain transaction records, status tracking, and volume queries.
- **External References**: Cross-service joins to `RWA` (`contractId`) and `User` (`buyerAddress`).

---

## Cross-Service Joins & Entity Resolution

Entities are resolved across subgraphs using Apollo Federation v2 `@key` and `__resolveReference` resolvers.

Example cross-service query:
```graphql
query {
  transactions(limit: 5) {
    transactionId
    totalCost
    asset {
      title
      location
      pricePerShare
    }
    buyer {
      walletAddress
      kycStatus
    }
  }
}
```

Query Planner execution:
1. Queries `transactions` from Transactions Subgraph.
2. Extracts `contractId` and `buyerAddress` representations.
3. Invokes `Assets` and `Users` subgraphs' `_entities` resolvers concurrently.
4. Merges returned entities into the final GraphQL response.

---

## Performance Optimizations & Caching

### In-Memory Entity Cache (`entityCache.js`)
- Short TTL (30s) LRU-style cache for `RWA` and `User` entities.
- Reduces redundant `_entities` lookups during batch or nested queries.
- Invalidated automatically on mutations (`createAsset`, `updateAsset`, `deleteAsset`, `approveAsset`, `pauseAsset`).

### Observability & Metrics (`metrics.js`)
Prometheus metrics exported at `/metrics`:
- `graphql_federation_query_duration_seconds` — Overall Gateway request duration histogram.
- `graphql_federation_subgraph_duration_seconds` — Per-subgraph request duration histogram.
- `graphql_federation_entity_cache_hits_total` — Entity cache hits.
- `graphql_federation_entity_cache_misses_total` — Entity cache misses.
- `graphql_federation_subgraph_errors_total` — Subgraph execution error counts.

---

## Schema Governance Process

1. **Subgraph Independence**: Each team/service owns its subgraph schema file in `backend/src/federation/subgraphs/`.
2. **Composition Validation**: CI checks validate schema composition using `@apollo/gateway` before merging PRs.
3. **Backward Compatibility**: Non-breaking additions are preferred. Deprecated fields are tagged with `@deprecated`.
