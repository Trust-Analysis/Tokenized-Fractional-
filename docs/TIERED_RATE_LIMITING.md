# Tiered Rate Limiting with Redis

Comprehensive guide to the new tiered rate limiting system for the RWA Marketplace API.

## Overview

The system implements **three-tier rate limiting** with different thresholds for:
- **Anonymous Users** — No API key, no wallet address
- **Authenticated Users** — Connected wallet or user credentials
- **Admin Users** — Valid API key

Rate limits differ for **read** and **write** operations, and the system uses **Redis** for distributed rate limiting across multiple instances, with an **in-memory fallback** when Redis is unavailable.

## Rate Limit Tiers

### Production Environment

| Tier | Type | Requests | Window | Req/sec |
|------|------|----------|--------|---------|
| **Anonymous** | Read | 50 | 15 min | 3.33 |
| | Write | 10 | 15 min | 0.67 |
| **Authenticated** | Read | 500 | 15 min | 33.3 |
| | Write | 100 | 15 min | 6.67 |
| **Admin** | Read | 5,000 | 15 min | 333 |
| | Write | 1,000 | 15 min | 67 |

### Test Environment

All tiers set to 10,000 requests per 60 seconds for easy testing.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Request                           │
├─────────────────────────────────────────────────────────────┤
│  1. Extract Wallet (extractWalletMiddleware)                │
│     - Detects authenticated users                           │
├─────────────────────────────────────────────────────────────┤
│  2. Rate Limit Check (createTieredRateLimiter)              │
│     - Determines user tier (anonymous/auth/admin)           │
│     - Checks Redis or memory store                          │
│     - Increment counter                                      │
│     - Add response headers                                  │
├─────────────────────────────────────────────────────────────┤
│  3. Proceed to Route Handler                                │
│     - If allowed: continue                                  │
│     - If blocked: 429 Too Many Requests                     │
└─────────────────────────────────────────────────────────────┘
```

### Storage Backends

**Redis (Preferred for Multi-Instance)**
- Distributed across instances
- Persistent across restarts
- Automatic TTL management
- Scales horizontally

**Memory (Fallback)**
- Single-instance only
- Lost on restart
- Automatic cleanup
- No external dependency

## Setup

### 1. Environment Configuration

Add to `.env`:

```bash
# Optional: Connect to Redis for distributed rate limiting
REDIS_URL=redis://localhost:6379

# Or with authentication:
REDIS_URL=redis://:password@redis.example.com:6379

# Or for Redis Cluster:
REDIS_URL=redis://:password@redis-node1:6379,redis-node2:6379,redis-node3:6379
```

### 2. Initialize in Application

The tiered rate limiter is automatically initialized in `src/app.js`:

```javascript
import { initializeRedisLimiter, closeRedisLimiter } from './middleware/tieredRateLimiter.js';

// During app startup
await initializeApp(); // Initializes Redis automatically

// During app shutdown
await closeApp(); // Closes Redis connection
```

### 3. Middleware Setup

The middleware is automatically applied to all `/api/*` routes:

```javascript
// All read operations use read limits
app.use('/api/', createTieredRateLimiter('read'));

// Write operations (POST/PATCH/DELETE) use write limits
app.use('/api/', (req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    return createTieredRateLimiter('write')(req, res, next);
  }
  next();
});
```

## API Endpoints

### GET /api/rate-limiting/config (Admin)

View current rate limit configuration for all tiers.

**Headers:**
```
x-api-key: YOUR_API_KEY
```

**Response:**
```json
{
  "data": [
    {
      "tier": "anonymous",
      "name": "Anonymous User",
      "read": {
        "windowMs": 900000,
        "windowMinutes": 15,
        "maxRequests": 50,
        "requestsPerSecond": 3.33
      },
      "write": {
        "windowMs": 900000,
        "windowMinutes": 15,
        "maxRequests": 10,
        "requestsPerSecond": 0.67
      }
    },
    // ... authenticated, admin tiers
  ]
}
```

### GET /api/rate-limiting/stats (Admin)

Get rate limiter statistics and backend information.

**Response:**
```json
{
  "data": {
    "stats": {
      "backend": "redis",
      "connected": true,
      "totalKeys": 1234,
      "memoryUsage": "used_memory_human:2.5M"
    },
    "health": {
      "status": "ok",
      "backend": "redis",
      "connected": true
    },
    "timestamp": "2026-06-30T10:00:00.000Z"
  }
}
```

### POST /api/rate-limiting/reset (Admin)

Reset rate limits for a specific user or IP address.

**Request:**
```json
{
  "identifier": "192.168.1.1",
  "tier": "all",
  "type": "all"
}
```

**Parameters:**
- `identifier` (required) — IP address or user identifier
- `tier` (optional) — `all`, `anonymous`, `authenticated`, or `admin` (default: `all`)
- `type` (optional) — `all`, `read`, or `write` (default: `all`)

**Response:**
```json
{
  "message": "Rate limits reset successfully",
  "identifier": "192.168.1.1",
  "tier": "all",
  "type": "all"
}
```

### GET /api/rate-limiting/status (Public)

Get current rate limit status for this request.

**Response:**
```json
{
  "data": {
    "tier": "anonymous",
    "type": "read",
    "limit": 50,
    "current": 23,
    "remaining": 27,
    "resetInSeconds": 423,
    "percentageUsed": "46.00%"
  }
}
```

### GET /api/rate-limiting/health (Admin)

Check rate limiter backend health.

**Response:**
```json
{
  "data": {
    "health": {
      "status": "ok",
      "backend": "redis",
      "connected": true
    },
    "timestamp": "2026-06-30T10:00:00.000Z"
  }
}
```

## Response Headers

All rate-limited requests include headers:

```
X-RateLimit-Limit: 50                  // Max requests in window
X-RateLimit-Remaining: 27              // Remaining requests
X-RateLimit-Reset: 2026-06-30T10:07:00 // When limit resets
X-RateLimit-Tier: anonymous            // User tier
```

## Error Responses

### 429 Too Many Requests

```json
{
  "error": "Too many requests",
  "code": "RATE_LIMIT_EXCEEDED",
  "tier": "anonymous",
  "retryAfter": 423,
  "message": "Rate limit exceeded for anonymous users. Try again in 423s."
}
```

Headers:
```
Retry-After: 423
```

## User Tier Detection

The system automatically detects user tiers:

### 1. Admin Tier
```javascript
if (req.apiKey) {
  // User has valid API key
  tier = 'admin';
}
```

### 2. Authenticated Tier
```javascript
if (req.user || req.wallet) {
  // User is logged in or has wallet connected
  tier = 'authenticated';
}
```

### 3. Anonymous Tier
```javascript
// Default for all other users
tier = 'anonymous';
```

## Wallet Detection

To mark a user as authenticated, include wallet in:

**Option 1: Query Parameter**
```
GET /api/rwa?wallet=GXYZ...
```

**Option 2: Request Body**
```json
{
  "wallet": "GXYZ..."
}
```

**Option 3: Custom Header**
```
X-Wallet-Address: GXYZ...
```

## Redis Configuration

### Single Instance

```bash
REDIS_URL=redis://localhost:6379
```

### With Authentication

```bash
REDIS_URL=redis://:mypassword@redis.example.com:6379/0
```

### Redis Cluster

```bash
REDIS_URL=redis://:password@node1:6379,node2:6379,node3:6379
```

### Redis Sentinel

```bash
REDIS_URL=sentinel://master-name:password@sentinel1:26379,sentinel2:26379
```

## Fallback Behavior

If Redis is unavailable:

1. **Connection Fails**: Logger warns, switches to memory-based limiting
2. **During Operation**: If Redis command fails, falls back to memory for that request
3. **Memory Store**: In-memory Map with automatic cleanup
4. **Performance**: Single instance only, limits lost on restart

## Monitoring & Observability

### Logs

- **INFO**: Rate limiter initialized, connections made
- **WARN**: Redis disconnected, falling back to memory
- **ERROR**: Rate limiter errors (logged but request allowed)

Example:
```
[INFO] Redis rate limiter connected
[WARN] Redis rate limiter disconnected, falling back to memory
[ERROR] Redis rate limit check failed, falling back to memory
[INFO] Rate limit reset (identifier: 192.168.1.1, keysDeleted: 45)
```

### Metrics

Monitor via `/api/rate-limiting/stats`:
- Total rate limit keys in Redis
- Memory usage
- Backend type (Redis or memory)
- Connection status

### Health Check

```bash
curl http://localhost:3001/api/rate-limiting/health
```

Useful for monitoring dashboards and load balancer health checks.

## Implementation Details

### Key Format

Rate limit keys in Redis follow this format:
```
ratelimit:{type}:{tier}:{identifier}:{window}
```

Example:
```
ratelimit:read:anonymous:192.168.1.1:1234567
ratelimit:write:authenticated:user123:1234567
ratelimit:read:admin:api-key-1:1234567
```

### TTL Management

- Redis keys auto-expire after window ends
- Memory store cleans up on next request in that window
- Prevents unbounded growth

### Atomic Increments

- Redis: `INCR` command is atomic
- Memory: Single-threaded Node.js makes increments atomic
- No race conditions in distributed setup

## Performance Considerations

### Redis

- **Latency**: ~1-2ms per request for Redis check
- **Throughput**: 10,000+ requests/sec per instance
- **Scalability**: Horizontal (multiple instances sharing Redis)

### Memory

- **Latency**: <0.1ms per request
- **Throughput**: 50,000+ requests/sec per instance
- **Scalability**: Single instance only
- **Memory**: ~1KB per active rate limit key

### Optimization Tips

1. **Use Redis for Production** — Better scalability
2. **Monitor Rate Limit Stats** — Check for abuse patterns
3. **Adjust Tiers** — Based on your traffic patterns
4. **Enable Caching** — Cache analytics responses
5. **Use CDN** — For static assets and cacheable endpoints

## Testing

### Test Environment

Rate limits are relaxed in test mode:
- 10,000 requests per 60 seconds for all tiers
- All types (anonymous/auth/admin) have same limits
- Prevents test failures due to rate limiting

### Manual Testing

```bash
# Check your current rate limit status
curl http://localhost:3001/api/rate-limiting/status

# Get config
curl -H "x-api-key: YOUR_KEY" \
  http://localhost:3001/api/rate-limiting/config

# Reset limits for an IP
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "127.0.0.1"}' \
  http://localhost:3001/api/rate-limiting/reset
```

### Load Testing

```bash
# Apache Bench: 1000 requests, 10 concurrent
ab -n 1000 -c 10 http://localhost:3001/api/rwa

# Expected result: Most requests succeed, some get 429 after limit
```

## Troubleshooting

### Redis Connection Failed

```
Error: Failed to initialize Redis rate limiter
Using in-memory rate limiting
```

**Solution:**
1. Check REDIS_URL environment variable
2. Verify Redis server is running: `redis-cli ping`
3. Check firewall rules
4. Verify authentication credentials

### Rate Limit Too Strict

**Solution:**
1. Check user tier: Is user authenticated?
2. View config: `GET /api/rate-limiting/config`
3. Reset limits: `POST /api/rate-limiting/reset`
4. Adjust tier in `src/middleware/tieredRateLimiter.js`

### Rate Limit Not Working

**Solution:**
1. Check if middleware is mounted
2. Verify Redis connection: `GET /api/rate-limiting/health`
3. Check logs for errors
4. Ensure requests are to `/api/*` routes

## Future Enhancements

1. **Per-Route Limits** — Different limits for different endpoints
2. **Burst Allowance** — Short-term bursts above limits
3. **Dynamic Adjustment** — Adjust limits based on load
4. **Cost-Based** — Different costs for different operations
5. **Quotas** — Daily/monthly quotas instead of per-window
6. **WebSocket Support** — Rate limiting for WebSocket connections

## Security Considerations

1. **IP Spoofing** — Use trusted proxy settings in reverse proxy
2. **Distributed Attacks** — Multiple IPs defeat per-IP limiting
3. **Quotas** — Consider usage-based quotas for sensitive ops
4. **Admin Bypass** — Admins have high limits (can still be abused)
5. **Logging** — Monitor and alert on unusual patterns

## References

- [Express Rate Limit](https://www.npmjs.com/package/express-rate-limit)
- [ioredis Documentation](https://github.com/luin/ioredis)
- [Redis Rate Limiting Patterns](https://redis.io/commands/INCR)
- [HTTP Status Codes](https://httpwg.org/specs/rfc7231.html#status.429)
