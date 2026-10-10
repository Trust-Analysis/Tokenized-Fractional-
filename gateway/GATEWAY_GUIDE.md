# Enterprise API Gateway Integration Guide

**Status**: Complete  
**Version**: 1.0.0  
**Last Updated**: August 26, 2024

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Supported Gateways](#supported-gateways)
4. [Configuration](#configuration)
5. [Authentication](#authentication)
6. [Rate Limiting](#rate-limiting)
7. [Monitoring](#monitoring)
8. [Deployment](#deployment)
9. [Security](#security)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This API Gateway integration provides centralized management, routing, security, and monitoring for the RWA Marketplace API. It supports three enterprise gateway platforms:

- **AWS API Gateway** - AWS-native serverless API management
- **Kong** - Open-source lightweight gateway
- **Apigee** - Enterprise API management platform

### Key Features

✅ **Routing Rules** - Conditional routing based on paths, methods, and headers  
✅ **Authentication** - Multi-method (API Key, JWT, OAuth 2.0)  
✅ **Authorization** - Scope-based access control  
✅ **Rate Limiting** - Sliding window & token bucket algorithms  
✅ **Throttling** - Per-tier and per-endpoint limits  
✅ **Request/Response Transformation** - Data mapping and validation  
✅ **Monitoring** - CloudWatch, Prometheus, and distributed tracing  
✅ **Security** - WAF, CORS, DDoS protection  
✅ **Deployment Automation** - Scripts for all platforms

---

## Architecture

### Component Stack

```
┌─────────────────────────────────────────────────────────┐
│                 Client Applications                      │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│           API Gateway (AWS/Kong/Apigee)                 │
├──────────────────────────────────────────────────────────┤
│  ├─ Routing Engine                                       │
│  ├─ Authentication & Authorization                       │
│  ├─ Rate Limiting & Throttling                          │
│  ├─ Request/Response Transformation                     │
│  └─ Monitoring & Logging                               │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│          Express.js Backend Service                      │
├──────────────────────────────────────────────────────────┤
│  ├─ /api/rwa (GET, POST, DELETE)                       │
│  ├─ Authentication Validation                           │
│  ├─ Business Logic                                      │
│  └─ Data Persistence                                   │
└──────────────────────────────────────────────────────────┘
```

### Request Flow

```
1. Client Request
        ↓
2. API Gateway Receives
        ↓
3. Authentication Check
        ↓
4. Rate Limit Check
        ↓
5. Request Transformation
        ↓
6. Route to Backend
        ↓
7. Backend Processes
        ↓
8. Response Transformation
        ↓
9. Response Headers Added
        ↓
10. Send to Client
```

---

## Supported Gateways

### AWS API Gateway

**Best for**: AWS-first organizations, serverless architectures  
**Location**: `gateway/aws/`

**Features**:
- CloudWatch integration
- WAF (Web Application Firewall)
- Lambda authorizers
- CloudFront CDN support
- VPC integration

**Configuration**:
```typescript
// CDK stack defining API Gateway, Lambda, WAF
const stack = new RwaApiGatewayStack(app, 'RwaApiGatewayStack', {
  env: { region: 'us-east-1' }
});
```

### Kong

**Best for**: Hybrid/multi-cloud, open-source preference  
**Location**: `gateway/kong/`

**Features**:
- Open-source (free)
- Declarative configuration
- Plugin ecosystem
- Konga admin UI
- Prometheus metrics

**Configuration**:
```yaml
services:
  - name: rwa-backend
    url: http://rwa-backend:3001
    routes:
      - methods: [GET]
        paths: [/api/rwa]
```

### Apigee

**Best for**: Enterprise governance, advanced analytics  
**Location**: `gateway/apigee/`

**Features**:
- Advanced analytics
- Developer portal
- API versioning
- Shared flows
- OAuth 2.0 support

**Configuration**:
```xml
<APIProxy name="rwa-marketplace">
  <ProxyEndpoints>...</ProxyEndpoints>
  <TargetEndpoints>...</TargetEndpoints>
</APIProxy>
```

---

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
cp gateway/.env.example gateway/.env
```

**Key Variables**:

```
GATEWAY_TYPE=kong              # aws, kong, apigee
ENVIRONMENT=production
JWT_SECRET=your-secret-key     # Change in production
ADMIN_API_KEY=your-admin-key
BACKEND_URL=http://localhost:3001
```

### Per-Gateway Configuration

#### AWS CDK Configuration

```bash
# Set AWS region
export AWS_REGION=us-east-1

# Set environment
export CDK_CONTEXT_ENVIRONMENT=production

# Deploy
cd gateway/aws
cdk deploy
```

#### Kong Configuration

```bash
# Kong loads configuration from kong.yml
# Customize routes, plugins, and consumers

cd gateway/kong
docker-compose up -d
```

#### Apigee Configuration

```bash
# Set credentials
export APIGEE_USERNAME=admin@example.com
export APIGEE_PASSWORD=your-password

# Deploy proxy
apigee deployments deploy \
  --organization your-org \
  --environment prod \
  --proxy rwa-marketplace
```

---

## Authentication

The gateway supports three authentication methods:

### 1. API Key Authentication

**Header**: `X-API-Key`

```bash
curl -H "X-API-Key: your-api-key" \
  https://api.example.com/api/rwa
```

**Implementation**:
```javascript
import { validateApiKey } from './middleware/authentication.js';

app.get('/api/rwa', validateApiKey, (req, res) => {
  // Authenticated request
});
```

### 2. JWT Bearer Token

**Header**: `Authorization: Bearer <token>`

```bash
curl -H "Authorization: Bearer eyJhbGc..." \
  https://api.example.com/api/rwa
```

**Token Generation**:
```javascript
import { generateToken } from './middleware/authentication.js';

const token = generateToken({
  sub: 'user-123',
  email: 'user@example.com',
  scope: 'read write'
}, '1h');
```

### 3. OAuth 2.0

**Scopes**: `read`, `write`, `admin`

```javascript
import { validateOAuth } from './middleware/authentication.js';

app.post('/api/rwa', validateOAuth, (req, res) => {
  // OAuth authenticated request
});
```

---

## Rate Limiting

### Algorithms

#### Sliding Window

Tracks requests in a time window. Simple and effective.

```javascript
const limiter = new SlidingWindowLimiter();
limiter.isAllowed('user-123', 100, 3600); // 100 requests per hour
```

#### Token Bucket

Allows bursts while maintaining overall rate. Better for traffic patterns.

```javascript
const limiter = new TokenBucketLimiter();
limiter.isAllowed('user-123', 100, 10); // 100 capacity, 10 req/sec refill
```

### Rate Limit Tiers

```javascript
RATE_LIMIT_TIERS = {
  free: { requests: 100/hour, burst: 10 },
  basic: { requests: 1000/hour, burst: 100 },
  professional: { requests: 10000/hour, burst: 1000 },
  enterprise: { requests: unlimited },
};
```

### Per-Endpoint Limits

```javascript
ENDPOINT_RATE_LIMITS = {
  'GET:/api/rwa': { default: 60, burst: 5 },        // 60/min
  'POST:/api/rwa': { default: 10, burst: 2 },       // 10/min
  'DELETE:/api/rwa/:contractId': { default: 5 },    // 5/min
};
```

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1693065600
```

---

## Monitoring

### CloudWatch Metrics

**For AWS API Gateway**:

```javascript
const metrics = new MetricsCollector({
  namespace: 'RWA-Gateway',
  region: 'us-east-1'
});

metrics.recordApiRequest('/api/rwa', 200, 150, 1024);
metrics.recordRateLimit('user-123', '/api/rwa');
metrics.recordError('/api/rwa', 'ValidationError');
```

### Prometheus Metrics

**Exposed at `/metrics`**:

```
api_request_duration_ms_total 15000
api_request_duration_ms_count 100
api_request_duration_ms_bucket{le="100"} 45
api_request_duration_ms_bucket{le="1000"} 98
```

### Distributed Tracing

```javascript
const trace = traceCollector.startTrace('trace-123', 'span-456');
// Process request
traceCollector.addSpan('trace-123', 'span-456', 'validateRequest', 50, 'ok');
traceCollector.endTrace('trace-123');
```

### Health Checks

```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-08-26T12:00:00Z",
  "checks": {
    "database": { "status": "ok" },
    "redis": { "status": "ok" },
    "backend": { "status": "ok" }
  }
}
```

---

## Deployment

### Using Deployment Script

```bash
# Make script executable
chmod +x gateway/scripts/deploy.sh

# Deploy to AWS
./gateway/scripts/deploy.sh aws production us-east-1

# Deploy to Kong
./gateway/scripts/deploy.sh kong production

# Deploy to Apigee
./gateway/scripts/deploy.sh apigee production
```

### AWS Deployment

```bash
cd gateway/aws
npm install
cdk deploy --all
```

### Kong Deployment

```bash
cd gateway/kong
docker-compose up -d
# Configure via Kong Admin API (port 8001)
# Or Admin GUI at http://localhost:8002
```

### Apigee Deployment

```bash
cd gateway/apigee
apigee deployments deploy \
  --organization your-org \
  --environment prod \
  --proxy rwa-marketplace
```

---

## Security

### Authentication & Authorization

- ✅ API Key validation
- ✅ JWT signature verification
- ✅ Scope-based authorization
- ✅ Token expiration checks

### Request Validation

- ✅ JSON schema validation
- ✅ Content-Type checking
- ✅ Size limits (10KB default)
- ✅ SQL injection prevention

### Response Security

- ✅ Sensitive field redaction
- ✅ Security headers (CSP, X-Frame-Options)
- ✅ CORS restrictions
- ✅ Rate limit headers

### Network Security (AWS)

- ✅ WAF (Web Application Firewall)
- ✅ DDoS protection via CloudFront
- ✅ VPC integration
- ✅ Security groups

### Best Practices

1. **Secrets Management**
   - Store credentials in environment variables
   - Use AWS Secrets Manager for AWS deployments
   - Rotate keys regularly

2. **CORS Configuration**
   - Restrict origins to known domains in production
   - Never use `*` in production

3. **Rate Limiting**
   - Set appropriate limits per tier
   - Monitor for abuse patterns
   - Alert on threshold exceeds

4. **Logging**
   - Log all authentication failures
   - Sanitize sensitive data in logs
   - Centralize logs in CloudWatch or ELK

---

## Troubleshooting

### Common Issues

**Issue**: 401 Unauthorized
```
Solution:
- Verify API key is correct
- Check JWT token expiration
- Verify Authorization header format
- Check scope/permissions
```

**Issue**: 429 Too Many Requests
```
Solution:
- Check rate limit tier
- Wait for rate limit window to reset
- Implement exponential backoff retry
- Check per-endpoint limits
```

**Issue**: Gateway Not Responding
```
Solution:
- Check health endpoint: GET /health
- Verify backend is running
- Check network connectivity
- Review logs for errors
```

**Issue**: Slow Responses
```
Solution:
- Check backend latency
- Review CloudWatch metrics
- Analyze request size
- Check database performance
```

### Log Analysis

**Access logs** (Kong):
```
curl http://localhost:8001/logs
```

**Metrics** (Prometheus):
```
curl http://localhost:9090/api/v1/query?query=api_request_duration_ms
```

**Traces** (if enabled):
```
Check Datadog or Jaeger dashboard
```

---

## File Structure

```
gateway/
├── aws/
│   ├── cdk-stack.ts              # CDK infrastructure
│   ├── lambda/
│   │   └── authorizer/
│   │       └── authorizer.js     # Lambda authorizer
│   └── package.json
├── kong/
│   ├── docker-compose.yml        # Kong services
│   ├── kong.yml                  # Declarative config
│   └── .env.example
├── apigee/
│   ├── apiproxy/
│   │   └── rwa-marketplace.xml  # API proxy definition
│   └── policies/                 # Policy definitions
├── middleware/
│   ├── authentication.js         # Auth middleware
│   ├── rateLimiting.js          # Rate limiting
│   └── requestTransform.js      # Transformation
├── monitoring/
│   └── observability.js         # Monitoring utilities
├── scripts/
│   └── deploy.sh                # Deployment script
├── .env.example                 # Environment template
└── README.md
```

---

## Support & Resources

- [AWS API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)
- [Kong Documentation](https://docs.konghq.com/)
- [Apigee Documentation](https://cloud.google.com/apigee/docs)
- [RFC 6750 - OAuth 2.0 Bearer Token Usage](https://tools.ietf.org/html/rfc6750)

---

## Next Steps

1. **Configure Environment** - Copy `.env.example` to `.env` and customize
2. **Choose Gateway** - Select AWS, Kong, or Apigee
3. **Deploy** - Run deployment script or manual steps
4. **Test** - Verify with sample requests
5. **Monitor** - Set up dashboards and alerts
6. **Optimize** - Fine-tune rate limits and caching

---

**Documentation Version**: 1.0.0  
**Last Updated**: August 26, 2024
