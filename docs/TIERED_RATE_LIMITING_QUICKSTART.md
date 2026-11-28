# Tiered Rate Limiting - Implementation Guide

## Quick Start

### 1. Enable Redis (Optional but Recommended)

Add to `.env`:
```bash
REDIS_URL=redis://localhost:6379
```

Or use an existing Redis service:
```bash
# AWS ElastiCache
REDIS_URL=redis://:password@my-redis.xxx.ng.0001.use1.cache.amazonaws.com:6379

# Heroku Redis
REDIS_URL=redis://default:password@hostname:port
```

### 2. Deploy

No code changes needed! The system:
- ✅ Automatically initializes Redis on startup
- ✅ Falls back to memory if Redis unavailable
- ✅ Applies tiered limits to all `/api/*` routes
- ✅ Detects user tiers automatically

### 3. Monitor

```bash
# Check rate limiter status
curl http://localhost:3001/api/rate-limiting/status

# View configuration
curl -H "x-api-key: YOUR_KEY" \
  http://localhost:3001/api/rate-limiting/config

# Check backend health
curl -H "x-api-key: YOUR_KEY" \
  http://localhost:3001/api/rate-limiting/health
```

## Rate Limits by Tier

### Anonymous Users
- **Read:** 50 requests/15 min (3.3 req/sec)
- **Write:** 10 requests/15 min (0.67 req/sec)
- **Detection:** No API key, no wallet address

### Authenticated Users
- **Read:** 500 requests/15 min (33 req/sec)
- **Write:** 100 requests/15 min (6.7 req/sec)
- **Detection:** Wallet address OR user credentials

### Admin Users
- **Read:** 5,000 requests/15 min (333 req/sec)
- **Write:** 1,000 requests/15 min (67 req/sec)
- **Detection:** Valid API key in `x-api-key` header

## Adjusting Limits

Edit `src/middleware/tieredRateLimiter.js`:

```javascript
const RATE_LIMIT_TIERS = {
  anonymous: {
    read: {
      windowMs: 15 * 60 * 1000,
      max: 50,  // ← Change here
    },
    write: {
      windowMs: 15 * 60 * 1000,
      max: 10,  // ← Change here
    },
  },
  // ... authenticated, admin ...
};
```

Then restart the backend.

## Marking Users as Authenticated

To mark a user as authenticated (and get higher limits), include wallet address:

### Option 1: Query Parameter
```
GET /api/rwa?wallet=GXYZ...
```

### Option 2: Request Body
```json
POST /api/purchases
{
  "wallet": "GXYZ...",
  ...
}
```

### Option 3: Custom Header
```
GET /api/analytics/user/...
X-Wallet-Address: GXYZ...
```

## Multi-Instance Deployment

For multiple backend instances, use **Redis**:

### Docker Compose Example

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  backend-1:
    image: rwa-backend
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis

  backend-2:
    image: rwa-backend
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis

  backend-3:
    image: rwa-backend
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis

volumes:
  redis_data:
```

All instances share rate limit state in Redis.

## Admin Operations

### View Rate Limit Configuration

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/rate-limiting/config
```

Shows all tiers, limits, and calculated req/sec.

### Check Statistics

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/rate-limiting/stats
```

Returns:
- Backend type (Redis or memory)
- Total keys in use
- Memory consumption
- Connection status

### Reset a User's Limits

```bash
# Reset all limits for an IP
curl -X POST \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "192.168.1.100"}' \
  http://localhost:3001/api/rate-limiting/reset

# Reset only read limits
curl -X POST \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "192.168.1.100", "type": "read"}' \
  http://localhost:3001/api/rate-limiting/reset

# Reset only anonymous tier
curl -X POST \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "192.168.1.100", "tier": "anonymous"}' \
  http://localhost:3001/api/rate-limiting/reset
```

### Check Backend Health

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/rate-limiting/health
```

## Troubleshooting

### Check If Rate Limiter Is Working

```bash
# Get your current status
curl http://localhost:3001/api/rate-limiting/status

# Response should include:
# - tier: "anonymous" (or "authenticated"/"admin")
# - remaining: number of requests left
# - resetInSeconds: when limit resets
```

### Verify Redis Connection

```bash
# Check health
curl -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/rate-limiting/health

# Should return: "status": "ok", "backend": "redis", "connected": true
```

### Test Rate Limiting

```bash
# Make requests until you hit the limit
for i in {1..60}; do
  curl http://localhost:3001/api/analytics/overview
done

# Last requests should return 429 Too Many Requests
```

### Check Logs

```bash
# Backend logs should show:
npm run dev 2>&1 | grep -i "rate\|redis"

# Expected output:
# [INFO] Redis rate limiter connected
# [WARN] Rate limit exceeded (tier: anonymous)
```

## Testing

In test environment, all limits are relaxed (10,000 req/60s) to prevent test failures.

Run tests normally:
```bash
npm test
```

Tests won't be affected by rate limiting.

## Performance

**Redis Overhead:** ~1-2ms per request
**Memory Overhead:** <0.1ms per request
**Recommended:** Use Redis for production, memory for development

## Caching Responses

**Don't** rely on rate limiting for performance. Use caching:

```javascript
// Cached endpoints bypass rate limit impact
GET /api/analytics/overview      // Cached for 5 minutes
GET /api/rate-limiting/status    // No cache (per-request state)
```

## Security Notes

1. **Admin Limits**: Admins have high limits but can still be abused
2. **IP Spoofing**: Configure proxy headers in reverse proxy
3. **Quotas**: Consider daily/monthly quotas in addition to per-window
4. **Alerting**: Monitor for unusual patterns

## Environment Variables

| Variable | Example | Required | Default |
|----------|---------|----------|---------|
| REDIS_URL | redis://localhost:6379 | No | None (uses memory) |
| NODE_ENV | production | No | development |

## Customization

### Custom Rate Limit Tiers

Edit `src/middleware/tieredRateLimiter.js`:

```javascript
const RATE_LIMIT_TIERS = {
  premium: {
    name: 'Premium User',
    read: { windowMs: 15*60*1000, max: 10000 },
    write: { windowMs: 15*60*1000, max: 2000 },
  },
};
```

Then detect in `getUserTier()`:
```javascript
if (req.user?.tier === 'premium') return 'premium';
```

### Custom Endpoints

Add custom rate limiter to specific endpoints:

```javascript
app.get('/api/expensive-operation',
  createTieredRateLimiter('read'),  // Apply rate limiter
  handler
);
```

## Monitoring Dashboard

Add to your monitoring (Prometheus, Datadog, etc.):

```bash
# Collect stats periodically
curl -H "x-api-key: ${API_KEY}" \
  http://backend:3001/api/rate-limiting/stats | jq .data.stats
```

Parse:
- `totalKeys` — Active rate limit windows
- `memoryUsage` — Redis memory consumption
- `backend` — redis or memory

## References

- Full documentation: `docs/TIERED_RATE_LIMITING.md`
- Rate limiter code: `src/middleware/tieredRateLimiter.js`
- Admin routes: `src/routes/rateLimiting.js`
- Integration: `src/app.js`
