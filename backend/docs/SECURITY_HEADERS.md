# Security Headers Implementation

This document describes the comprehensive security headers middleware implemented to protect the RWA Marketplace against common web vulnerabilities.

## Overview

The backend now implements strict security headers across all API endpoints to defend against:

- **Clickjacking** (X-Frame-Options)
- **MIME-type sniffing** (X-Content-Type-Options)
- **Cross-Site Scripting (XSS)** (Content-Security-Policy, X-XSS-Protection)
- **Insecure transport** (HSTS)
- **Referrer leakage** (Referrer-Policy)
- **Unauthorized feature access** (X-DNS-Prefetch-Control)
- **Cross-origin resource misuse** (Cross-Origin-Resource-Policy)

## Implementation

### File Structure

- **Middleware**: `src/middleware/securityHeaders.js` — Creates and configures helmet.js with strict security policies
- **Configuration**: Environment variables in `.env` (see `.env.example` for details)
- **Integration**: Applied in `src/app.js` as the first middleware after Sentry
- **Testing**: Comprehensive test suite in `__tests__/securityHeaders.test.js` with 33 tests

### How It Works

The security headers middleware uses [helmet.js](https://helmetjs.github.io/) v7.2.0 to automatically set HTTP security headers on all responses.

```javascript
// Applied early in middleware chain (src/app.js)
app.use(createSecurityHeadersMiddleware(logger));
```

## Headers Implemented

### 1. HSTS (HTTP Strict Transport Security)

**Header**: `Strict-Transport-Security`

Forces all connections to use HTTPS for specified duration.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

**Configuration**:
```env
HSTS_MAX_AGE=31536000              # 1 year in seconds
HSTS_INCLUDE_SUBDOMAINS=true       # Apply to all subdomains
HSTS_PRELOAD=false                 # Optional: submit to HSTS preload list
```

**Protection**: Prevents protocol downgrade attacks and man-in-the-middle attacks.

### 2. Content Security Policy (CSP)

**Header**: `Content-Security-Policy`

Controls which resources the browser can load, preventing inline script injection.

```
Content-Security-Policy: 
  default-src 'self'; 
  script-src 'self' 'unsafe-inline'; 
  style-src 'self' 'unsafe-inline'; 
  object-src 'none'; 
  frame-ancestors 'self';
  ...
```

**Configuration**:
```env
CSP_ENABLED=true                   # Enable CSP enforcement
CSP_REPORT_ONLY=false              # Log violations without blocking (false = enforce)
CSP_REPORT_URI=/api/v1/security/csp-report

# Content sources
SCRIPT_SOURCES='self','unsafe-inline'
STYLE_SOURCES='self','unsafe-inline'
FONT_SOURCES='self'
IMG_SOURCES='self','data:','https:'
CONNECT_SOURCES='self'
MEDIA_SOURCES='self'

# Directive controls
FRAME_ANCESTORS='self'             # Only allow framing from same-origin
```

**Protection**: Prevents XSS attacks, data exfiltration, and unauthorized script execution.

### 3. X-Frame-Options (Clickjacking Protection)

**Header**: `X-Frame-Options`

Prevents the page from being embedded in iframes on other sites.

```
X-Frame-Options: DENY
```

**Protection**: Prevents clickjacking attacks where attackers trick users into clicking hidden elements.

### 4. X-Content-Type-Options (MIME Sniffing Protection)

**Header**: `X-Content-Type-Options`

Prevents browsers from guessing content type.

```
X-Content-Type-Options: nosniff
```

**Protection**: Forces browser to respect the `Content-Type` header, preventing MIME-type confusion attacks.

### 5. Referrer-Policy

**Header**: `Referrer-Policy`

Controls how much referrer information is exposed to other sites.

```
Referrer-Policy: no-referrer
```

**Configuration**:
```env
REFERRER_POLICY=strict-no-referrer # or: no-referrer, same-origin, origin, etc.
```

**Protection**: Prevents leaking sensitive URLs and user information to third-party sites.

### 6. X-XSS-Protection (Legacy Filter)

**Header**: `X-XSS-Protection`

Legacy XSS filter for older browsers (mostly obsolete in modern browsers with CSP).

```
X-XSS-Protection: 0
```

**Protection**: Provides fallback XSS protection in older browsers that don't support CSP.

### 7. Cross-Origin-Resource-Policy

**Header**: `Cross-Origin-Resource-Policy`

Controls which origins can access this resource.

```
Cross-Origin-Resource-Policy: cross-origin
```

**Configuration**:
```env
CORP=true                          # Enable CORP header
CORP_POLICY=cross-origin           # Policy: same-origin, same-site, cross-origin
```

**Protection**: Prevents sensitive data leakage to unauthorized cross-origin requests.

### 8. X-DNS-Prefetch-Control

**Header**: `X-DNS-Prefetch-Control`

Controls whether browsers perform DNS prefetching.

```
X-DNS-Prefetch-Control: off
```

**Configuration**:
```env
DNS_PREFETCH_CONTROL=false         # false = "off", true = "on"
```

**Protection**: Prevents DNS prefetch leakage of user activity to third parties.

### 9. Additional Headers

Helmet also sets:

- **X-Permitted-Cross-Domain-Policies**: Prevents Adobe Flash from loading
- **Cross-Origin-Opener-Policy**: Prevents cross-origin window coordination
- **Origin-Agent-Cluster**: Helps isolate site data per-origin

## Configuration

### Environment Variables

All security header configurations can be customized via environment variables. Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Edit `.env` to customize security settings:

```env
# Strict defaults (production)
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
CSP_ENABLED=true
CSP_REPORT_ONLY=false
FRAME_ANCESTORS='self'

# Relaxed for development
CSP_REPORT_ONLY=true               # Log but don't block
SCRIPT_SOURCES='self','unsafe-inline','http://localhost:*'
```

## Testing

### Run Security Headers Tests

```bash
npm test -- __tests__/securityHeaders.test.js
```

### Test Coverage

The test suite verifies:

✅ **HSTS** — Correct max-age and subdomains  
✅ **X-Frame-Options** — Set to DENY on all routes  
✅ **X-Content-Type-Options** — Set to nosniff  
✅ **CSP** — Restrictive directives set correctly  
✅ **Referrer-Policy** — Restricts referrer leakage  
✅ **X-XSS-Protection** — Set appropriately  
✅ **Cross-Origin-Resource-Policy** — Configured correctly  
✅ **X-DNS-Prefetch-Control** — Disabled  
✅ **Headers on all routes** — GET, POST, DELETE, HTML, JSON  
✅ **No X-Powered-By leakage** — Removed  

## Best Practices

### Development

1. **Enable Report-Only Mode** for testing:
   ```env
   CSP_REPORT_ONLY=true
   CSP_REPORT_URI=/api/v1/security/csp-report
   ```
   This logs CSP violations without blocking requests.

2. **Allow localhost resources**:
   ```env
   SCRIPT_SOURCES='self','unsafe-inline','http://localhost:*'
   ```

### Production

1. **Strict CSP**:
   ```env
   CSP_ENABLED=true
   CSP_REPORT_ONLY=false
   SCRIPT_SOURCES='self'              # No unsafe-inline
   STYLE_SOURCES='self'               # No unsafe-inline
   ```

2. **HSTS Preload** (optional):
   ```env
   HSTS_PRELOAD=true
   ```
   Submit your domain to the HSTS preload list at https://hstspreload.org/

3. **CSP Reporting** (recommended):
   ```env
   CSP_REPORT_URI=https://your-reporting-service.com/csp-report
   ```

## Troubleshooting

### Issue: CSP Blocking Inline Scripts

**Cause**: `script-src` doesn't include `'unsafe-inline'`

**Solution**: Either:
- Add 'unsafe-inline' to SCRIPT_SOURCES (less secure)
- Use nonces or hashes for inline scripts (recommended)
- Move scripts to separate files

### Issue: Styles Not Loading

**Cause**: `style-src` too restrictive

**Solution**: Adjust STYLE_SOURCES to include CSS sources:
```env
STYLE_SOURCES='self','unsafe-inline','https://cdn.example.com'
```

### Issue: External API Calls Blocked

**Cause**: `connect-src` doesn't include API origin

**Solution**: Add external API to CONNECT_SOURCES:
```env
CONNECT_SOURCES='self','https://api.example.com'
```

## Security Audit Checklist

- [ ] All headers verified in browser DevTools
- [ ] CSP report violations reviewed
- [ ] HSTS preload domain submitted
- [ ] No errors in browser console related to CSP
- [ ] Cross-origin requests working correctly
- [ ] External resources loading from allowed origins
- [ ] Security headers present on all routes
- [ ] X-Powered-By header removed

## References

- [OWASP Security Headers](https://owasp.org/www-project-secure-headers/)
- [Mozilla Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Content Security Policy (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [HSTS Specification](https://tools.ietf.org/html/rfc6797)

## Implementation Timeline

- **Created**: `src/middleware/securityHeaders.js` — Configurable security headers
- **Updated**: `src/app.js` — Applied middleware early in chain
- **Added**: `.env.example` — Security header environment variables
- **Tested**: `__tests__/securityHeaders.test.js` — 33 comprehensive tests
- **Fixed**: Logger imports in service files for compatibility

## Future Enhancements

- [ ] Add CSP violation reporting endpoint
- [ ] Implement Subresource Integrity (SRI) for CDN resources
- [ ] Add Permissions-Policy header (after helmet v8 update)
- [ ] Implement certificate pinning for API communication
- [ ] Add security header audit logging
