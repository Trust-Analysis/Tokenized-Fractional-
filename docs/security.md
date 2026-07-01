# Security Best Practices Guide

This document outlines security best practices for developing, deploying, and maintaining the Tokenized Fractional RWA Marketplace. It covers secure development guidelines, common vulnerabilities, an audit checklist, incident response procedures, and security monitoring.

## Table of Contents

- [Secure Development Guidelines](#secure-development-guidelines)
- [Common Vulnerabilities and Mitigations](#common-vulnerabilities-and-mitigations)
- [Security Audit Checklist](#security-audit-checklist)
- [Incident Response Process](#incident-response-process)
- [Security Monitoring](#security-monitoring)

## Secure Development Guidelines

### General Principles

- **Least Privilege**: Code and services should run with the minimum permissions necessary.
- **Defense in Depth**: Layer security controls so that a single failure does not compromise the system.
- **Secure Defaults**: Features should be secure by default; opt-in for less secure configurations.
- **Fail Securely**: Errors should default to denying access rather than granting it.
- **Input Validation**: Validate, sanitize, and encode all input at every layer.

### Smart Contract (Soroban/Rust)

- Use `soroban_sdk` built-in checks for authorization (`require_auth`).
- Validate all function arguments (boundaries, zero values, overflow potential).
- Implement a circuit breaker / pause mechanism for emergency stops.
- Test with property-based testing (`proptest`) in addition to unit tests.
- Run `cargo audit` before every release to check for dependency vulnerabilities.
- Keep contract logic deterministic; avoid external calls that could introduce reentrancy.

### Backend (Express.js / Node.js)

- Keep dependencies updated: run `npm audit` and `npx npm-check-updates` regularly.
- Use `helmet` middleware to set security headers (already configured).
- Apply strict rate limiting on all endpoints (already configured per-IP and per-key).
- Validate and sanitize all request bodies and query parameters.
- Do not log sensitive data (API keys, tokens, personal information).
- Use environment variables for secrets; never hardcode or commit them.
- Set secure cookie flags (`HttpOnly`, `Secure`, `SameSite`).
- Enable Sentry for error monitoring and alerting (configured via `SENTRY_DSN`).

### Frontend (React / Vite)

- Sanitize any HTML rendered from user input to prevent XSS.
- Use Content Security Policy (CSP) headers (configure in nginx or Vite).
- Validate all environment variable inputs at build time.
- Never expose API keys or secrets in client-side code.
- Use `react-helmet-async` or similar to manage `<head>` security concerns.

## Common Vulnerabilities and Mitigations

| Vulnerability | Risk | Mitigation |
|---|---|---|
| Reentrancy | Smart contract funds drained | Use checks-effects-interactions pattern; Soroban's `require_auth` provides protection |
| Integer Overflow/Underflow | Incorrect share calculations | Use `checked_*` arithmetic or saturating math |
| Unauthorized Admin Access | Contract takeover | Use `require_auth` with admin address; rotate keys regularly |
| XSS (Cross-Site Scripting) | User session hijacking | CSP headers; input sanitization; React auto-escaping |
| CSRF (Cross-Site Request Forgery) | Unauthorized state changes | SameSite cookies; CSRF tokens for any cookie-based auth |
| SQL Injection | Data breach | Use parameterized queries / ORM; the backend uses file-based storage (no SQL) |
| Path Traversal | Arbitrary file read | Validate file paths; restrict to data directory |
| SSRF (Server-Side Request Forgery) | Internal network probing | Validate and restrict outbound URLs; use an allow-list for webhook URLs |
| Insecure Direct Object Reference | Access other users' data | Use authentication checks before returning data |
| Dependency Vulnerabilities | Supply chain attacks | Regular `npm audit` / `cargo audit`; use lockfiles |
| Misconfigured CORS | Cross-origin data theft | Restrict origins to known frontend URLs (already configured) |

## Security Audit Checklist

### Pre-Deployment

- [ ] Smart contract source code reviewed by at least one other developer
- [ ] All `admin`-only functions protected with `require_auth`
- [ ] Input boundaries tested (max share amounts, zero values, negative values)
- [ ] `cargo audit` and `npm audit` pass with no critical vulnerabilities
- [ ] Environment variables reviewed — no secrets committed to repository
- [ ] `.env.example` does not contain real secrets
- [ ] CORS origins configured to match the deployed frontend domain
- [ ] Rate limiting configured and tested
- [ ] Security headers verified (via [securityheaders.com](https://securityheaders.com))
- [ ] HTTPS configured with valid certificate
- [ ] Logging level set to `info` or `warn` in production (not `debug`)
- [ ] Sentry DSN configured and error reporting verified

### Post-Deployment

- [ ] All endpoints tested with invalid/malformed inputs
- [ ] Rate limiting triggers correctly under load
- [ ] Webhook URLs validated — no SSRF exposure
- [ ] Static analysis tools run (ESLint, Clippy)
- [ ] Penetration test performed (or automated scanner run)
- [ ] SSL/TLS certificate valid and auto-renewal working
- [ ] Backup and restore procedures tested

### Periodic (Every Month)

- [ ] Dependencies updated for security patches
- [ ] Access logs reviewed for suspicious activity
- [ ] Failed authentication attempts reviewed
- [ ] Smart contract upgrade considered if vulnerabilities discovered
- [ ] Incident response plan reviewed and updated

## Incident Response Process

### 1. Detection

Monitor for security incidents via:
- Application logs (ELK stack — Elasticsearch, Logstash, Kibana)
- Sentry error tracking
- Prometheus alerting rules
- Grafana dashboard anomalies
- Rate limit threshold alerts

### 2. Triage

When an incident is detected:
1. **Acknowledge**: Respond within 1 hour (critical) or 4 hours (high).
2. **Assess**: Determine the scope, affected components, and data at risk.
3. **Classify**: Label as critical (funds at risk), high (user data exposed), medium (minor exposure), low (best practice gap).
4. **Document**: Create an incident ticket with timeline and actions.

### 3. Containment

- If a smart contract vulnerability is suspected, invoke `pause` to halt trading immediately.
- If the backend is compromised, revoke API keys and rotate secrets.
- If a frontend XSS is found, take the site down or serve a safe version.
- Block malicious IPs at the nginx / firewall level.

### 4. Eradication

- Deploy a fix: upgrade smart contract, patch backend code, fix frontend.
- If the smart contract cannot be upgraded, consider deploying a new contract and migrating.
- Remove any backdoors or unauthorized access.
- Rotate all credentials (API keys, admin keys, database credentials).

### 5. Recovery

- Verify the fix with the same tests that detected the issue.
- Monitor closely for recurrence.
- Gradually restore services (unpause contract, restore frontend).
- Notify affected users if their data was exposed.

### 6. Post-Mortem

- Conduct a root cause analysis within 7 days.
- Update the security audit checklist with lessons learned.
- Share findings with the development team.
- Update documentation and tests to prevent recurrence.

## Security Monitoring

### Application Performance Monitoring

- **Sentry**: Tracks errors, performance, and traces. Configured via `SENTRY_DSN`.
- **Prometheus**: Collects metrics (request rates, error rates, response times, system resources).
- **Grafana**: Visualizes Prometheus metrics on customizable dashboards.

### Log Monitoring

- **ELK Stack** (Elasticsearch, Logstash, Kibana): Centralized log aggregation and analysis.
- **Filebeat**: Ships nginx and application logs to Logstash.
- Monitor for:
  - Repeated 401/403 responses (brute force attempts)
  - Unusual spikes in 5xx errors
  - Unexpected URL patterns (scanning / crawling)
  - Large request payloads

### Alerting Rules

Configure Prometheus alerting for:
- **High Error Rate**: >5% 5xx responses over 5 minutes
- **High Latency**: p99 response time >2s over 5 minutes
- **Service Down**: Target unreachable for >1 minute
- **Rate Limit Hits**: >100 rate limit responses per minute
- **Certificate Expiry**: SSL certificate expires in <30 days

### Network Monitoring

- Nginx rate limiting zones tracked via metrics (if exported).
- Connection limiting prevents DDoS at the nginx layer.
- Basic WAF rules block common attack patterns (SQL injection, malicious user agents).

---

Review this guide regularly and update it as the project evolves. Security is an ongoing process, not a one-time checklist.
