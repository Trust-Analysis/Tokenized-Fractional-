# SQL Injection Prevention Guide

**Issue #356** — Comprehensive guide to SQL injection prevention measures in the RWA Marketplace backend.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Protection Layers](#protection-layers)
3. [Secure Database Access Patterns](#secure-database-access-patterns)
4. [Configuration](#configuration)
5. [Monitoring & Auditing](#monitoring--auditing)
6. [CI/CD Integration](#cicd-integration)
7. [Developer Guidelines](#developer-guidelines)
8. [Incident Response](#incident-response)

---

## Architecture Overview

The SQL injection prevention system employs a **defense-in-depth** strategy with multiple protection layers:

```
┌─────────────────────────────────────────────────────────┐
│                   HTTP REQUEST                          │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Input Sanitization (sanitizationMiddleware)   │
│           ├─ XSS prevention                             │
│           ├─ Prototype pollution prevention             │
│           └─ Basic SQLi pattern detection               │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Query Firewall (sqlInjectionGuard)            │
│           ├─ Operation allow/block lists                │
│           ├─ SQL injection pattern detection            │
│           ├─ Query complexity analysis                  │
│           └─ Anomaly detection                          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Knex.js Parameterized Queries                 │
│           ├─ Automatic parameter binding                │
│           ├─ Query builder sanitization                 │
│           └─ Raw query interception                     │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Error Handling                                │
│           ├─ SQL detail masking                         │
│           ├─ Generic error responses                    │
│           └─ Request ID tracing                         │
└─────────────────────────────────────────────────────────┘
```

## Protection Layers

### Layer 1: Input Sanitization

The `requireSanitization` middleware (`src/middleware/sanitizationMiddleware.js`) sanitizes all incoming HTTP data:

- **Body, Query, Params**: Deeply traversed and sanitized
- **HTML escaping**: Special characters are neutralized via `validator.escape()`
- **Prototype pollution**: `__proto__`, `constructor`, `prototype` keys are stripped
- **Length enforcement**: Max 10,000 characters per string field
- **Injection heuristics**: SQLi, XSS, and NoSQLi patterns are detected and logged

Enable strict mode for automatic rejection:
```bash
STRICT_SANITIZATION=true
```

### Layer 2: Query Firewall

The `SqlInjectionGuard` (`src/services/sqlInjectionGuard.js`) provides real-time query-level protection:

#### SQL Injection Pattern Detection

Detects 10+ categories of SQL injection patterns:
- Classic UNION-based injection
- Stacked query injection
- Comment-based injection (`--`, `#`, `/* */`)
- Boolean/blind injection
- Time-based injection (`SLEEP()`, `WAITFOR DELAY`, `pg_sleep()`)
- Information schema enumeration
- Dangerous functions (`xp_cmdshell`, `sp_executesql`)
- Hex-encoded injection
- Double-encoded patterns (evasion attempt)
- Batched statement separators

#### Operation Firewall

| Operation | Status | Reason |
|-----------|--------|--------|
| SELECT | ✅ Allowed | Read operations |
| INSERT | ✅ Allowed | Write operations |
| UPDATE | ✅ Allowed | Write operations |
| DELETE | ✅ Allowed | Write operations |
| WITH (CTE) | ✅ Allowed | Complex queries |
| DROP | ❌ Blocked | Destructive DDL |
| TRUNCATE | ❌ Blocked | Destructive DDL |
| ALTER | ❌ Blocked | Schema modification |
| CREATE | ❌ Blocked | Schema creation |
| GRANT/REVOKE | ❌ Blocked | Permission changes |

#### Query Complexity Analysis

Queries are scored based on:
- Number of JOINs (5 points each)
- Subquery count (10 points each)
- WHERE conditions (2 points each)
- UNION operations (5 points each)
- Function calls (1 point each)
- CASE/HAVING/GROUP BY/ORDER BY/DISTINCT clauses

Thresholds per operation type:
- SELECT: 80 points
- INSERT: 40 points
- UPDATE: 40 points
- DELETE: 20 points

#### Anomaly Detection

The anomaly detector monitors query patterns in 60-second windows:
- High DELETE ratio (>50% of queries)
- Query complexity spikes (3x baseline)
- Repetitive identical queries (brute force detection)

### Layer 3: Knex.js Parameterized Queries

Knex.js automatically generates parameterized queries. The guard wraps `knex.raw()` to:
- Intercept raw SQL calls
- Require parameter bindings for raw queries with user input
- Block raw queries containing SQL injection patterns
- Allow safe parameterized raw queries with `?` placeholders

### Layer 4: Error Handling

Error responses are carefully designed to prevent SQL detail leakage:

```javascript
// ❌ BAD - Leaks SQL details
res.status(500).json({ error: err.message });
// "SQLITE_ERROR: no such table: assets"

// ✅ GOOD - Masks SQL details
res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
// "Internal server error" (details only in server logs)
```

## Secure Database Access Patterns

### ✅ DO: Use Knex Query Builder

```javascript
// Always use the query builder for WHERE clauses with user input
const asset = await db('assets')
  .where('contract_id', contractId)
  .first();
```

### ✅ DO: Use Parameterized Raw Queries

```javascript
// When raw SQL is needed, always use ? bindings
const results = await db.raw(
  'SELECT * FROM assets WHERE contract_id = ? AND status = ?',
  [contractId, status]
);
```

### ❌ DON'T: String Concatenation with User Input

```javascript
// NEVER do this - vulnerable to SQL injection
const query = `SELECT * FROM assets WHERE contract_id = '${contractId}'`;
const results = await db.raw(query); // BLOCKED by the guard!
```

### ❌ DON'T: Template Literals in SQL

```javascript
// NEVER use template literals for user-provided values
const results = await db.raw(`SELECT * FROM ${tableName}`); // BLOCKED!
```

### ❌ DON'T: Bypass the ORM with Native Drivers

```javascript
// Use Knex, not raw pg/mysql drivers directly
// pgClient.query(`SELECT * FROM assets WHERE id = '${id}'`); // NEVER!
```

## Configuration

Environment variables for the SQL injection guard:

| Variable | Default | Description |
|----------|---------|-------------|
| `SQL_INJECTION_BLOCK_POLICY` | `strict` | `strict` = block dangerous queries, `warn` = log warnings only, `off` = disabled |
| `SQL_MAX_QUERY_COMPLEXITY` | `100` | Maximum query complexity score before blocking |
| `SQL_MAX_QUERY_DEPTH` | `10` | Maximum query nesting depth |
| `SQL_AUDIT_ENABLED` | `true` | Enable audit logging of all queries |
| `SQL_ANOMALY_THRESHOLD` | `5` | Minimum sample size for anomaly detection |

### Development Mode

```bash
# In development, use warn mode to see issues without breaking
SQL_INJECTION_BLOCK_POLICY=warn
```

### Production Mode (Recommended)

```bash
# In production, use strict blocking
SQL_INJECTION_BLOCK_POLICY=strict
SQL_AUDIT_ENABLED=true
```

## Monitoring & Auditing

### Admin API Endpoints

The guard exposes monitoring endpoints (admin only):

```bash
# Get guard statistics
GET /api/v1/sql-injection-guard/stats

# Get recently blocked queries
GET /api/v1/sql-injection-guard/blocked?limit=50

# Get full audit log (filterable)
GET /api/v1/sql-injection-guard/audit-log?limit=100&filter=BLOCKED

# Get anomaly statistics
GET /api/v1/sql-injection-guard/anomalies

# Reset statistics
POST /api/v1/sql-injection-guard/reset
```

### Logging

All security events are logged with Pino at appropriate levels:
- **WARN**: Blocked queries, anomaly detections
- **INFO**: Audit trail entries (when `SQL_AUDIT_ENABLED=true`)
- **ERROR**: Critical security events

### Metrics

The guard integrates with the existing query monitoring system:
- `totalQueries`: Total queries processed
- `blockedQueries`: Queries blocked by the firewall
- `warnedQueries`: Queries that passed with warnings
- `blockRate`: Percentage of blocked queries

## CI/CD Integration

Automated SQL injection testing runs in CI/CD on every PR:

```yaml
# .github/workflows/security.yml includes:
- SQL injection test suite execution
- Security linting with eslint-plugin-security
- CodeQL analysis for JavaScript
- Dependency vulnerability scanning
```

### Running Tests Locally

```bash
# Run all SQL injection tests
npm test -- __tests__/sqlInjection.test.js

# Run with coverage
npm test -- __tests__/sqlInjection.test.js --coverage

# Run specific test suites
npm test -- __tests__/sqlInjection.test.js -t "SQL Injection Pattern Detection"
```

## Developer Guidelines

### Before Writing Database Queries

1. **Always use the Knex query builder** for standard CRUD operations
2. **Use parameterized queries** when raw SQL is necessary
3. **Never concatenate user input** into SQL strings
4. **Validate input** before it reaches the database layer
5. **Review your queries** for injection vulnerabilities

### Code Review Checklist

- [ ] Are all database queries using the Knex query builder?
- [ ] Are any `knex.raw()` calls using `?` bindings?
- [ ] Is user input validated before reaching database queries?
- [ ] Are error messages generic (not leaking SQL details)?
- [ ] Are there any template literals in SQL strings?
- [ ] Are string concatenation patterns used in SQL?

### Sanitization Service Integration

For WebSocket and non-HTTP vectors:

```javascript
import { sanitizationService } from '../services/sanitizationService.js';

// Sanitize WebSocket messages before processing
const { sanitized, isSuspicious } = sanitizationService.sanitizePayload(message, 'websocket');

if (isSuspicious) {
  logger.warn('Suspicious WebSocket payload detected');
  // Handle appropriately - may reject or sanitize
}
```

## Incident Response

### If SQL Injection Is Detected

1. **The guard automatically blocks the query** in strict mode
2. **An audit log entry is created** with the query preview and timestamp
3. **A WARN-level log is emitted** with pattern matches
4. **The client receives a 403 response** with code `SECURITY_BLOCK`

### If a Breach Is Suspected

1. Check the audit log: `GET /api/v1/sql-injection-guard/audit-log`
2. Review blocked queries: `GET /api/v1/sql-injection-guard/blocked`
3. Check anomaly stats: `GET /api/v1/sql-injection-guard/anomalies`
4. Review server logs for `sql_injection_blocked` events
5. Run database integrity checks
6. Rotate compromised credentials
7. Review the backup system for point-in-time recovery

### Rollback Procedure

If the guard is causing issues:

```bash
# Temporarily switch to warn-only mode
SQL_INJECTION_BLOCK_POLICY=warn

# Or disable entirely (NOT recommended for production)
SQL_INJECTION_BLOCK_POLICY=off
```

---

**Last Updated**: July 2026  
**Related Issues**: #356 (SQL Injection Prevention), #287 (API Compression), #320 (Query Performance Monitoring)  
**Related Docs**: [Input Sanitization Guide](./INPUT_SANITIZATION_GUIDE.md), [Security Best Practices](./security.md), [Authentication](./AUTHENTICATION.md)
