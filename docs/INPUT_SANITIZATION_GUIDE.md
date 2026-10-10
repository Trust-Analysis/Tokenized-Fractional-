# Comprehensive Input Sanitization Guide

To protect the RWA Marketplace against Cross-Site Scripting (XSS), SQL Injection, and Prototype Pollution, a centralized sanitization architecture has been implemented.

## 1. Parameterized Queries (SQL Injection Prevention)
The application utilizes **Knex.js** as its query builder. By default, Knex heavily relies on parameterized queries (`?` bindings in Postgres/SQLite). 
**Rule:** Never use `knex.raw()` with string concatenation. If raw queries are strictly required for complex aggregations, always use bindings: `knex.raw('SELECT * FROM users WHERE id = ?', [userId])`.

### SQL Injection Guard (Issue #356)

A dedicated SQL Injection Guard (`src/services/sqlInjectionGuard.js`) provides multi-layered protection:

- **Query Firewall**: Blocks dangerous DDL operations (DROP, TRUNCATE, ALTER, etc.)
- **Pattern Detection**: Identifies 10+ categories of SQL injection patterns (UNION-based, stacked, blind, time-based, etc.)
- **Complexity Analysis**: Scores queries and blocks overly complex constructions
- **Anomaly Detection**: Monitors query patterns for unusual activity (brute force, complexity spikes)
- **Audit Logging**: Records all queries for security monitoring

See [SQL Injection Prevention Guide](./SQL_INJECTION_PREVENTION.md) for full documentation.

## 2. HTTP Request Sanitization
The `requireSanitization` middleware intercepts all incoming HTTP traffic.
- It deeply traverses `req.body`, `req.query`, and `req.params`.
- Strips `__proto__` and `constructor` to prevent **Prototype Pollution**.
- Uses `validator.escape()` to neutralize HTML special characters `<, >, &, ', ", /`.
- Enforces a maximum string length (default 10,000 chars) to prevent ReDoS or Buffer exhaustion.

## 3. WebSocket & Non-HTTP Vectors
For WebSocket events, use the `sanitizationService.sanitizePayload(message, 'websocket')` directly within the event listeners before processing the payload.

## 4. Injection Detection & Audit Logging
The `SanitizationService` includes a `detectInjection` heuristic function. This evaluates inputs against known SQLi, NoSQLi, and XSS signatures. 
- **Performance Monitoring:** The service tracks execution time per payload. Payloads taking >50ms trigger a performance audit warning.
- **ML Foundation:** The heuristic flags currently output boolean risks. This structured logging acts as the labeled dataset foundation for future Machine Learning-based injection anomaly detection.

## 5. Strict Mode
By setting `STRICT_SANITIZATION=true` in `.env`, the middleware will automatically reject (HTTP 400) any payload that matches a heuristic injection signature, rather than just silently escaping it.
