# Data Consistency Checks

The RWA Marketplace implements periodic data consistency verification across three data stores to ensure data integrity and detect synchronization issues.

## Architecture

Data flows through three tiers:

```
┌─────────────┐
│   Browser   │ (user interactions)
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────────────────────────┐
│  Express.js Backend             │
│  ┌─────────────┬──────────────┐ │
│  │   Memory    │ (transient)  │ │
│  └─────────────┴──────────────┘ │
│  ┌─────────────┐                │
│  │ Redis Cache │ (ephemeral)   │
│  └─────────────┘                │
│  ┌──────────────┐               │
│  │  data.json   │ (persisted)   │
│  └──────────────┘               │
└─────────────────────────────────┘
       │ Soroban RPC
       ▼
┌─────────────────────────────────┐
│  Stellar Soroban Blockchain     │
│  (immutable ledger)             │
└─────────────────────────────────┘
```

| Tier | Type | Purpose | Durability |
|---|---|---|---|
| **Cache (Redis)** | Ephemeral | Speed up repeated reads | Volatile; lost on restart |
| **Database (data.json)** | Persistent | Source of truth for metadata | Durable; survives restarts |
| **Blockchain (Soroban)** | Immutable | Ledger of transactions and state | Immutable; append-only |

## Consistency Model

The system performs three types of consistency checks:

### 1. Cache vs. Database

**Purpose:** Verify that cached data matches the persistent database.

**Issues detected:**
- Stale cache entries (cache differs from database)
- Orphaned cache entries (cache exists but database record is deleted)

**Repair strategy:**
- Clear the cache to force re-load from database on next read
- Automatic unless `CONSISTENCY_AUTO_REPAIR=false`

### 2. Database vs. Blockchain

**Purpose:** Verify that local metadata matches on-chain state.

**Issues detected:**
- Mismatched asset properties (price, shares, etc.)
- Blockchain state inconsistencies (e.g., available > total)
- Missing blockchain records (contract not deployed)

**Repair strategy:**
- **Flag for manual investigation** — blockchain is immutable; automatic repair could cause data loss
- Operator must verify blockchain state and decide next steps

### 3. Cache-Database-Blockchain Triangle

**Purpose:** Detect which tier is out of sync when all three differ.

**Issues detected:**
- All three tiers have different state (data corruption)
- Two tiers agree, one differs (identify the outlier)

**Example discrepancy resolution:**
```
if cache ≠ database ≠ blockchain:
  → database and blockchain are authoritative
  → clear cache
  
if cache = database ≠ blockchain:
  → blockchain state is latest (from on-chain events)
  → re-sync database from blockchain (if safe)
  
if database ≠ blockchain:
  → requires operator intervention
  → check transaction logs and event history
```

## Configuration

Enable consistency checks in `backend/.env`:

```bash
# Enable periodic checks
CONSISTENCY_CHECK_ENABLED=true

# Run every 60 minutes (default)
CONSISTENCY_CHECK_INTERVAL_MINUTES=60

# Automatically apply repairs (cache clearing, etc.)
CONSISTENCY_AUTO_REPAIR=false

# Write detailed JSON reports to this directory
CONSISTENCY_LOG_DIR=/var/log/rwa-marketplace/consistency
```

## Running Checks

### Automatic (Scheduled)

When `CONSISTENCY_CHECK_ENABLED=true`, checks run automatically:
- **First check:** 2 seconds after app startup
- **Subsequent checks:** Every `CONSISTENCY_CHECK_INTERVAL_MINUTES`
- **Results:** Logged to stdout and (if configured) written to JSON files

### Manual (On-Demand)

Trigger a check via the admin API:

```bash
curl -X GET http://localhost:3001/api/admin/consistency \
  -H "x-api-key: <ADMIN_API_KEY>"
```

Response includes:
- **summary** — aggregated statistics and issue counts
- **reports** — per-contract detailed consistency analysis

Example:
```json
{
  "summary": {
    "totalContracts": 5,
    "consistentContracts": 4,
    "inconsistentContracts": 1,
    "issueBySeverity": {
      "critical": 0,
      "high": 1,
      "medium": 0,
      "low": 0
    },
    "checkDurationMs": 245
  },
  "reports": [
    {
      "contractId": "C...",
      "consistency": {
        "cacheDbMatch": true,
        "dbBlockchainMatch": false,
        "allMatch": false
      },
      "issues": [
        {
          "type": "db_blockchain_mismatch",
          "severity": "high",
          "message": "Database and blockchain state differ"
        }
      ],
      "recommendations": [
        "Action: Validate blockchain state and re-sync database if needed"
      ]
    }
  ]
}
```

### Check Scheduler Status

```bash
curl -X GET http://localhost:3001/api/admin/consistency/status \
  -H "x-api-key: <ADMIN_API_KEY>"
```

Response:
```json
{
  "enabled": true,
  "running": true,
  "intervalMinutes": 60,
  "autoRepairEnabled": false,
  "loggingEnabled": true,
  "logDirectory": "/var/log/rwa-marketplace/consistency"
}
```

## Interpreting Reports

### Consistency Report Fields

```javascript
{
  contractId: "C...",                          // contract being checked
  timestamp: "2025-07-27T11:18:08.722Z",      // check timestamp
  
  hashes: {
    cache: "abc123..." || null,               // SHA256 of cache state
    database: "def456..." || null,             // SHA256 of database state
    blockchain: "ghi789..." || null            // SHA256 of blockchain state
  },
  
  status: {
    cacheValid: true,                         // cache entry exists
    databaseValid: true,                      // database record exists
    blockchainValid: true                     // blockchain state is consistent
  },
  
  consistency: {
    cacheDbMatch: true,                       // cache hash = database hash
    dbBlockchainMatch: true,                  // database hash = blockchain hash
    allMatch: true                            // all three hashes match
  },
  
  hasIssues: false,                           // any issues detected?
  issueCount: 0,                              // number of issues
  
  issues: [
    {
      type: "cache_db_mismatch",              // issue category
      severity: "low",                        // critical|high|medium|low
      message: "...",                         // human-readable description
      details: { ... }                        // additional context
    }
  ],
  
  recommendations: [                          // suggested actions
    "Action: Clear cache..."
  ]
}
```

### Issue Types and Severity

| Issue Type | Severity | Cause | Action |
|---|---|---|---|
| `cache_db_mismatch` | Low | Cache contains stale data | Auto-clear cache |
| `orphaned_cache` | Medium | Cache entry with no DB record | Auto-clear cache |
| `db_blockchain_mismatch` | High | Local data diverges from chain | Manual investigation |
| `onchain_drift` | High | A data.json field (`availableShares`, `totalShares`, `pricePerShare`) differs from the value read from the contract | Manual re-sync from chain |
| `blockchain_warning` | High | Inconsistent on-chain state | Developer review |
| `missing_everywhere` | Critical | Contract missing from all stores | Restore from backup |

## Troubleshooting

### "Cache and database have different content"

**Cause:** Cache was not invalidated when database was updated.

**Resolution:**
- Clear the cache manually: `curl -X POST http://localhost:3001/api/admin/cache/clear?key=rwa:<contractId>`
- Or enable `CONSISTENCY_AUTO_REPAIR=true` to auto-clear on next check

### "Database and blockchain state differ"

**Cause:** 
- Transaction not yet confirmed on-chain
- Contract state updated on-chain but not mirrored locally
- Data corruption or contract bug

**Investigation steps:**
1. Check recent transaction logs: `soroban contract invoke ... get_available_shares`
2. Verify blockchain state independently via Soroban RPC
3. Check backend logs for sync errors
4. If blockchain is correct, re-sync database:
   ```bash
   # Export blockchain state and update data.json
   soroban contract invoke --id <CONTRACT_ID> ... get_total_shares > total.json
   ```

### "Contract metadata missing from all stores"

**Cause:** Critical data loss; contract was deleted from database and not in cache or blockchain metadata.

**Resolution:**
1. Check if backups exist: `ls -la data.json.bak*`
2. Restore from backup or re-create asset metadata
3. If blockchain contract exists, restore metadata from there

### "Available shares exceeds total shares"

**Cause:** Data corruption; likely indicates a bug in the smart contract.

**Resolution:**
1. Contact the smart contract developer
2. Review the contract logic for arithmetic errors
3. Possible actions:
   - Pause the marketplace (`pause` function)
   - Emergency withdraw (`emergency_withdraw` function)
   - Deploy a fixed contract version (if available)

## Manual Repair Procedures

### Clearing Stale Cache

```bash
# Clear a specific cache entry
redis-cli DEL rwa:C<contractId>

# Clear all RWA asset caches
redis-cli KEYS "rwa:*" | xargs redis-cli DEL

# If no Redis, restart backend (in-memory cache clears on restart)
```

### Re-syncing Database from Blockchain

When database diverges from on-chain state:

```bash
# 1. Query blockchain for current state
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  get_available_shares

# 2. Update data.json with correct values
# (manually edit or use a sync script)

# 3. Verify the change
curl http://localhost:3001/api/rwa/<CONTRACT_ID>

# 4. Clear cache to reflect updated data
redis-cli DEL rwa:<CONTRACT_ID>
```

### Restoring from Backup

```bash
# Locate the most recent backup
ls -la data.json.bak*

# Restore it
cp data.json.bak-2025-07-27 data.json

# Restart backend
systemctl restart rwa-backend
# OR
docker compose restart backend

# Run consistency check to verify
curl -X GET http://localhost:3001/api/admin/consistency \
  -H "x-api-key: <ADMIN_API_KEY>"
```

## Advanced: Extending Consistency Checks

### Adding Custom Validators

Extend `backend/consistency.js` to add domain-specific rules:

```javascript
// In getBlockchainDigest():
if (dbAsset?.price && dbAsset.price < 0) {
  warnings.push('Negative price detected');
}

if (dbAsset?.documents?.length > 100) {
  warnings.push('Excessive documents array size');
}
```

### Connecting Real Blockchain Queries

Replace the simulation in `getBlockchainDigest()` with live RPC calls:

```javascript
import { rpc } from '@stellar/stellar-sdk';

async function queryBlockchainState(contractId) {
  const server = new rpc.Server(process.env.VITE_RPC_URL);
  const contract = new Contract(contractId);
  
  // Query on-chain data
  const availableShares = await server.simulateTransaction(
    new TransactionBuilder()
      .addOperation(contract.call('get_available_shares', []))
      .build()
  );
  
  return { availableShares, /* ... */ };
}
```

### Comparing data.json against on-chain state

`runConsistencyCheck()` accepts an optional `chainReader`. Build one from any
function that performs a read-only (simulated) contract call and returns the
decoded value:

```javascript
import { createChainReader } from './consistency.js';
import { runConsistencyCheck } from './consistency-scheduler.js';

// queryFn(contractId, method) → e.g. simulate `get_available_shares` via Soroban RPC
const chainReader = createChainReader(queryFn);
const { reports } = await runConsistencyCheck({ loadDataFn, chainReader });
```

Each mirrored field that differs is reported as an `onchain_drift` issue with the
data.json value and the on-chain value. Reconciliation flags it for manual review;
it never rewrites data.json automatically.

CI proves this safeguard fires: `backend/__tests__/onchainDrift.test.js` seeds
`__tests__/fixtures/drifted-data.json` with a wrong `availableShares`, mocks the RPC
with the correct on-chain value, and asserts the drift is detected and reported
(workflow: `.github/workflows/backend-docs-and-data-integrity.yml`).

### Implementing Live Repair

For database-blockchain mismatches, implement automatic re-sync:

```javascript
async function reconcileDbBlockchainMismatch(contractId, dbData, blockchainData) {
  // Only auto-repair if blockchain is more recent
  if (blockchainData.timestamp > dbData.updatedAt) {
    const repaired = mergeStates(dbData, blockchainData);
    saveData(repaired);
    return { success: true, action: 'db_resynced_from_blockchain' };
  }
  return { success: false, /* manual review */ };
}
```

## Monitoring and Alerting

### Parse Consistency Logs

```bash
# Find all issues reported in the last day
find /var/log/rwa-marketplace/consistency \
  -mtime -1 \
  -exec grep '"hasIssues": true' {} + \
  | jq '.issueCount'

# Count issue types
cat /var/log/rwa-marketplace/consistency/*.json \
  | jq '.reports[].issues[].type' \
  | sort | uniq -c
```

### Set Up Alerts

Add to a monitoring system (e.g., Prometheus, DataDog):

```bash
# Export consistency metrics
curl http://localhost:3001/api/admin/consistency \
  -H "x-api-key: <KEY>" \
  | jq '.summary.issueBySeverity' \
  | prometheus_text_exporter
```

Then alert on:
- `consistency_issues_critical > 0`
- `consistency_issues_high > 2`
- `consistency_check_duration_ms > 5000` (slow checks indicate problems)

## Performance Considerations

- **Check frequency:** Default 60 minutes; adjust based on data volatility and risk tolerance
- **Scope:** Checks all contracts; consider splitting into shards for large deployments
- **Async execution:** All checks are non-blocking; API continues to serve during checks
- **Logging overhead:** Disable JSON logs in production if not needed (`CONSISTENCY_LOG_DIR=""`)

## References

- [Smart Contract Data Model](../contracts/src/lib.rs) — Soroban contract state
- [Cache Implementation](./cache.js) — Redis integration
- [Backend API Documentation](http://localhost:3001/api-docs) — Swagger/OpenAPI
