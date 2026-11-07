# API Documentation — Issues #335-337

## Overview

This document provides comprehensive API documentation for the Tokenized Fractional RWA Marketplace backend.

## Authentication

All admin endpoints require an API key passed via the `x-api-key` header.

```http
x-api-key: YOUR_API_KEY
```

## Base URL

```
https://api.example.com/api/v1
```

## Endpoints

### Assets (RWA)

#### List Assets
```http
GET /rwa
```

Query parameters:
- `search` — Full-text search across title, description
- `type` — Filter by asset type
- `page` — Page number (default: 1)
- `limit` — Items per page (default: 20)

Response:
```json
{
  "assets": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### Get Asset
```http
GET /rwa/:contractId
```

#### Create Asset (Admin)
```http
POST /rwa
Content-Type: multipart/form-data

- contractId: string (required)
- title: string (required)
- description: string
- location: string
- assetType: string
- totalValuation: number
- imageUrl: string
- document: file (PDF, JPEG, PNG, WEBP)
```

#### Update Asset (Admin)
```http
PATCH /rwa/:contractId
```

#### Delete Asset (Admin)
```http
DELETE /rwa/:contractId
```

#### Export Assets (Admin)
```http
GET /rwa/export?format=json|csv&from=ISO_DATE&to=ISO_DATE
```

### Analytics

#### Get Dashboard (Admin)
```http
GET /analytics/dashboard
```

#### Get Summary
```http
GET /analytics/summary
```

#### Compute Daily Analytics (Admin)
```http
POST /analytics/compute-daily
```

### Purchases

#### Record Purchase
```http
POST /purchases
Content-Type: application/json

{
  "contractId": "...",
  "shares": 10,
  "pricePerShare": 1000000,
  "txHash": "...",
  "network": "testnet"
}
```

#### Get Purchase History
```http
GET /purchases/:contractId
```

### Webhooks (Admin)

#### List Webhooks
```http
GET /webhooks
```

#### Create Webhook
```http
POST /webhooks
Content-Type: application/json

{
  "url": "https://your-webhook.com",
  "events": ["purchase", "asset.created"]
}
```

#### Test Webhook
```http
POST /webhooks/:id/test
```

### Flash Loan Protection (Admin)

#### Get Config
```http
GET /flash-loan-protection/config
```

#### Update Config
```http
PATCH /flash-loan-protection/config
Content-Type: application/json

{
  "minHoldTimeSeconds": 600,
  "maxBuyPercentage": 10
}
```

### API Monitoring

#### Health Check (Public)
```http
GET /api-monitor/health
```

Response:
```json
{
  "status": "healthy",
  "errorRate": "0.5%",
  "p95Duration": 150,
  "totalRequests": 1000
}
```

#### Get Metrics (Admin)
```http
GET /api-monitor/metrics?window=3600000
```

#### Get Errors (Admin)
```http
GET /api-monitor/errors?limit=50
```

#### Get Performance (Admin)
```http
GET /api-monitor/performance/:operation?limit=100
```

#### Get Dashboard (Admin)
```http
GET /api-monitor/dashboard
```

### Admin Configuration

#### Get Config (Admin)
```http
GET /admin/config
```

#### Update Config (Admin)
```http
PATCH /admin/config
Content-Type: application/json

{
  "pricePerShare": 1000000,
  "totalShares": 100000,
  "maxSharesPerUser": 10000,
  "platformFeePercent": 250,
  "royaltyPercent": 100
}
```

#### Reset Config (Admin)
```http
POST /admin/config/reset
```

#### Export Config (Admin)
```http
POST /admin/config/export
Content-Type: application/json

{
  "includeAudit": true
}
```

#### Import Config (Admin)
```http
POST /admin/config/import
Content-Type: application/json

{
  "config": { ... },
  "overwrite": false
}
```

#### Get Audit Log (Admin)
```http
GET /admin/config/audit?limit=100&offset=0
```

### Rate Limiting

#### Get Rate Limit Config (Admin)
```http
GET /rate-limiting/config
```

#### Update Rate Limit (Admin)
```http
PATCH /rate-limiting/config
Content-Type: application/json

{
  "tier": "read",
  "windowMs": 60000,
  "max": 100
}
```

### API Keys

#### List API Keys (Admin)
```http
GET /api-keys
```

#### Create API Key (Admin)
```http
POST /api-keys
Content-Type: application/json

{
  "name": "Production Key",
  "tier": "admin"
}
```

#### Revoke API Key (Admin)
```http
DELETE /api-keys/:id
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "requestId": "req_..."
}
```

Common error codes:
- `UNAUTHORIZED` — Invalid or missing API key
- `FORBIDDEN` — Insufficient permissions
- `NOT_FOUND` — Resource not found
- `VALIDATION_ERROR` — Invalid request body
- `RATE_LIMITED` — Too many requests
- `SERVICE_UNAVAILABLE` — Service not initialized

## Rate Limits

| Tier | Window | Max Requests |
|------|--------|--------------|
| Anonymous | 1 minute | 60 |
| Authenticated | 1 minute | 300 |
| Admin | 1 minute | 1000 |

## Webhooks

Supported events:
- `purchase` — New purchase recorded
- `asset.created` — New asset created
- `asset.updated` — Asset updated
- `asset.deleted` — Asset deleted
- `webhook.test` — Test webhook
