# Security Headers Quick Reference

## Production Checklist ✅

### Deployment
```bash
# Verify security headers are set
curl -I https://your-api.example.com/health | grep -E "(Strict-Transport|X-Frame|CSP)"

# Expected output:
# strict-transport-security: max-age=31536000; includeSubDomains
# x-frame-options: DENY
# x-content-type-options: nosniff
# content-security-policy: default-src 'self'; ...
```

### .env Configuration for Production
```env
# HSTS
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true

# CSP
CSP_ENABLED=true
CSP_REPORT_ONLY=false

# Sources (no unsafe-inline for production)
SCRIPT_SOURCES='self'
STYLE_SOURCES='self'
FONT_SOURCES='self'
IMG_SOURCES='self','data:','https:'
CONNECT_SOURCES='self'

# Referrer protection
REFERRER_POLICY=strict-no-referrer

# DNS prevention
DNS_PREFETCH_CONTROL=false

# CORP
CORP=true
CORP_POLICY=cross-origin
```

## Development Configuration (.env)
```env
# Relaxed for local testing
CSP_REPORT_ONLY=true
SCRIPT_SOURCES='self','unsafe-inline','http://localhost:*'
STYLE_SOURCES='self','unsafe-inline'
DNS_PREFETCH_CONTROL=true
```

## Testing
```bash
# Run all security header tests
npm test -- __tests__/securityHeaders.test.js

# Run specific test
npm test -- __tests__/securityHeaders.test.js -t "HSTS"

# View test coverage
npm test -- __tests__/securityHeaders.test.js --coverage
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Content blocked by CSP | Add source to appropriate CSP directive in .env |
| Styles not loading | Add stylesheet source to STYLE_SOURCES |
| API calls blocked | Add API endpoint to CONNECT_SOURCES |
| Scripts in console errors | Add script source to SCRIPT_SOURCES or remove unsafe-inline |
| Images not loading | Check IMG_SOURCES includes required domains |

## CSP Report Endpoint

When CSP_REPORT_URI is configured, CSP violations are POSTed to:
```
POST /api/v1/security/csp-report
Content-Type: application/csp-report

{
  "csp-report": {
    "document-uri": "https://example.com/page",
    "violated-directive": "script-src",
    "original-policy": "script-src 'self'",
    "blocked-uri": "https://evil.com/script.js"
  }
}
```

Implement this endpoint to track security violations in production.

## HSTS Preload Submission

1. Ensure HSTS_PRELOAD=true in .env
2. Visit https://hstspreload.org/
3. Enter your domain
4. Submit for inclusion in HSTS preload list
5. Verify submission in browser (may take weeks)

## Verify Headers Are Set

### Using curl
```bash
curl -I https://api.example.com/health | grep -E "^[a-z-]+:"
```

### Using browser DevTools
1. Open Network tab
2. Make any request to /health
3. Click Response Headers
4. Look for: Strict-Transport-Security, X-Frame-Options, Content-Security-Policy, etc.

### Using online checker
- https://securityheaders.com
- https://csp-evaluator.withgoogle.com
- https://observatory.mozilla.org

## Performance Impact

Security headers add minimal overhead:
- **HSTS**: ~2 bytes per response header
- **CSP**: ~500-2000 bytes depending on configuration
- **Others**: ~50-200 bytes each
- **Total**: < 3KB per response (negligible)

## Related Documentation

- Full docs: `docs/SECURITY_HEADERS.md`
- Middleware code: `src/middleware/securityHeaders.js`
- Tests: `__tests__/securityHeaders.test.js`
- Configuration: `.env.example`

## Key Files Modified

| File | Change |
|------|--------|
| `src/middleware/securityHeaders.js` | **NEW** — Security headers middleware |
| `src/app.js` | Updated to use new middleware |
| `.env.example` | Added security header variables |
| `__tests__/securityHeaders.test.js` | **NEW** — 33 security tests |
| `src/services/*.js` | Fixed logger imports (4 files) |
| `docs/SECURITY_HEADERS.md` | **NEW** — Full documentation |

## Support

For security concerns or questions:
1. Check `docs/SECURITY_HEADERS.md`
2. Review test cases in `__tests__/securityHeaders.test.js`
3. Check environment variables in `.env.example`
4. Refer to OWASP and Mozilla security guidelines
