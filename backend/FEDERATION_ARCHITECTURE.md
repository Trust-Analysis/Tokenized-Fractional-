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

## Entity Ownership Policy (authoritative record)

There is exactly one **owning** subgraph per entity. Every other subgraph that
needs the entity declares a *minimal reference stub* `@key(fields: "…")` and
fabricates the entity representation (via a resolver returning
`{ __typename, <keyField> }`); only the **owner** resolves additional fields.

| Entity | Owning subgraph (owner) | Key (`@key`) | Stub/Provided by | Owned fields |
|--------|------------------------|--------------|------------------|--------------|
| `RWA` | assets | `contractId` | users (holdings), transactions (`asset`) | all asset metadata: title, location, description, assetType, share counts, documents, timestamps, list/search/statistics queries, and ALL mutations |
| `User` | users | `walletAddress` | transactions (`buyer`) | kycStatus, tier, holdings, user queries |
| `Transaction` | transactions | `transactionId` | — (no other subgraph references it) | everything under transactions queries |

Rules for adding fields (keep it this way):

* **Add a new asset field → `backend/src/federation/subgraphs/assets/schema.js`.**
  Do NOT add asset fields to the `RWA` stubs in `users/` or `transactions/`;
  composition no longer permits an entity's fields defined across subgraphs,
  and duplicated resolution causes inconsistent data.
* The reference stubs in non-owning subgraphs must expose ONLY the key field,
  and that key field must be **non-`@external`** (the subgraph *provides* the
  key so the query planner can hop `@key`-to-`@key`). See
  `transactions/schema.js` for the rationale comment. This file previously
  used `@external` key fields plus an obsolete `extendable: true` argument;
  both patterns fail composition under the linked federation v2.3 spec.
* An entity field is editable/writable only via the owner's mutations.

## Entity Cache (`entityCache.js`) Invalidation & Staleness

`backend/src/federation/entityCache.js` is a **process-local, TTL-based** write-
through cache used inside each subgraph's resolvers/`__resolveReference`.

Invalidation strategy — three mechanisms:

1. **TTL (primary):** every entry expires 30 seconds after it was written
   (configurable via the class constructor `ttlMs`). Stale data can therefore
   be served for at most 30 seconds by design.
2. **Explicit invalidation on mutations:** the assets subgraph calls
   `entityCache.invalidate('RWA', contractId)` after every mutation
   (`create/update/delete/approve/pause/unpause`). Own-process staleness is
   thus bounded at-zero for standard mutations (the write-through path).
3. **Sweeping:** a background `purgeExpired()` interval removes expired
   entries to bound memory (`maxEntries`: 500 per entity type, oldest-first
   eviction when full).

Conditions under which stale cross-subgraph data CAN be served:

* **Multi-replica deployments:** the cache is per-process (each backend pod
  keeps a copy — see `k8s/backend-deployment.yaml`). A mutation invalidates
  only the *handling* pod's cache; other pods may serve a pre-mutation value
  until their TTLs lapse (≤ 30 s). There is no event-driven cross-pod
  invalidation today; treat `entityCache` as a 30 s eventual-consistency
  window. If strict read-after-write are ever required cross-pod, use an
  event-driven pub/sub invalidation (mirroring the Redis coordination used
  for WebSocket broadcasts) — intentionally not built for now.
* **`Transaction` and `User` entities are cached but never invalidated on
  mutation:** neither the transactions nor the users subgraph mutates through
  GraphQL, so their cache entries rely on TTL expiry only. If a mutation
  service for either is introduced, mirror the assets mutations'
  `invalidate(...)` calls.
* Direct (non-`__resolveReference`) `Query.asset` / `Query.transaction` etc.
  share the same cache as entity resolution, so both paths enjoy/inherit the
  same 30 s window.

---

## Query Complexity Enforcement (gateway AND every subgraph)

The complexity rule `backend/graphql/complexity.js` (`complexityValidationRule`)
is enforced **at every entry point** so a deliberately expensive query cannot
slip through any direct endpoint:

| Layer | Where wired | File |
|-------|-------------|------|
| Federated gateway (`/graphql`) | ApolloServer `validationRules` | `backend/src/federation/gateway.js` (public entry) |
| Standalone GraphQL subscription/Yoga endpoint | per-tier validation rules | `backend/graphql/index.js` (TIER_LIMITS) |
| Each in-process subgraph server, directly against the subgraph's own schema, and (defense-in-depth vs. a misconfigured deployment that exposes a subgraph port directly) keeping the limits consistent | `createSubgraphServer()` | `backend/src/federation/gateway.js` exports `createSubgraphServer(schema)` |

Limits are configured via `GRAPHQL_MAX_COMPLEXITY`, `GRAPHQL_MAX_DEPTH`,
`GRAPHQL_MAX_FIELDS` env vars (defaults 100 / 10 / 50); the Yoga endpoint maps
user tiers onto smaller/larger sub-limits. Introspection queries are exempt
(`introspectionExempt`, default true) and never rejected by the limiting rules
(field-dense introspection is not costly to execute).

Tests: `backend/__tests__/complexityEnforcement.test.js` — asserts the SAME
query fails identically against the gateway and against each subgraph's
schema (`server.executeOperation`), plus a healthy query that should still be
served.

### Relationship of `backend/graphql/complexity.js` and `graphql/analysis/queryAnalyzer.js`

Superseded/non-authority statement:
* `backend/graphql/complexity.js` is THE enforcement module used at runtime for
  all three layers listed above — this is the only path that can reject a query.
* `graphql/analysis/queryAnalyzer.js` (standalone `graphql/` directory) is a
  *diagnostics* tool: the QueryAnalyzer class computes a similar but not
  identical analysis with different cost weights (heavier per-list cost and a
  100-score threshold — an advisory report/optimization recommendation engine,
  not an enforcement layer). It is not imported by the backend and is not a
  candidate for adding enforcement; do not wire it into serving paths.

If only one module is integrated at runtime, prefer complexity.js; treat
queryAnalyzer.js output as a lint/optimization helper for forward planning
only.

## Degraded-Mode / Partial-Results Contract (subgraph unavailability)

The gateway is configured so that at least one subgraph becoming unavailable
is survivable. In the current in-process deployment (LocalGraphQLDataSource),
"subgraph unavailable" manifests as blade-level failures inside that subgraph
(a broken dataLayer, corrupt data file, DIsK full, backend service freeze) —
this cannot occur as a network tombstone event but behaves identically to a
remote network partition at the gateway's request/execution layer.

Documented behavior — verified by `backend/__tests__/degradedMode.test.js`:

* **Healthy-subgraph-only queries fully succeed** — an unrelated subgraph's
  failure does not prevent queries from being served via the other subgraphs.
* **Failed subgraph work in a root fetch group:** returns `data: null` with
  the per-field error path pointing at the failed field (e.g. `path:
  ["statistics"]`). The gateway cannot compose a half-done root fetch group,
  so the operation-level data is null **with identifiable errors rather than
  a blank message-less failure**.
* **Failed subgraph work in nested/deferred fetches (entity references):**
  returns partial results: unaffected selections remain populated and the
  failed entity selection(s) become null (per GraphQL spec §6.7 nullability.
  e.g. `transaction { asset }` → `data.transaction.asset === null` while
  `data.transaction.transactionId` remains).
* Conclusion from #886: this satisfies both acceptance criteria: intended
  partial-data-with-contracted-errors behavior is explicitly defined (this
  section plus tests), and the "kill one subgraph service" scenario confirms
  healthy-subgraph-only queries succeed.

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
