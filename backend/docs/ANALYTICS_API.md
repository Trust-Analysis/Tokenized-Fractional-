# Analytics & Purchase Tracking API

This document describes the analytics and purchase tracking endpoints for the RWA Marketplace backend.

## Overview

The backend now tracks all purchase transactions and computes marketplace analytics, providing admins and users with insights into:
- Total trading volume and transaction counts
- User engagement and activity
- Asset performance metrics
- Purchase trends over time
- User portfolio tracking

## Database Schema

### tables/transactions
Records every share purchase event from the blockchain.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| transaction_id | STRING UNIQUE | Unique tx identifier |
| contract_id | STRING | RWA contract being purchased |
| buyer_address | STRING | Stellar wallet address |
| shares_purchased | DECIMAL | Number of shares bought |
| price_per_share | DECIMAL | Price per share in payment token |
| total_amount | DECIMAL | Total USD/token value |
| payment_token | STRING | Token used for payment |
| status | STRING | 'completed', 'pending', or 'failed' |
| blockchain_hash | STRING | Soroban transaction hash |
| metadata | JSONB | Additional data |
| created_at | TIMESTAMP | Transaction timestamp |
| updated_at | TIMESTAMP | Last update |

### tables/user_activity
Tracks user engagement and purchase history.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| wallet_address | STRING UNIQUE | User's Stellar wallet |
| total_purchases | INTEGER | Number of purchases |
| total_spent | DECIMAL | Total USD spent |
| shares_owned | DECIMAL | Total shares owned |
| last_purchase_at | TIMESTAMP | When user last bought |
| first_seen_at | TIMESTAMP | When user first appeared |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update |

### tables/daily_analytics
Pre-computed daily marketplace snapshots.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| date | DATE UNIQUE | YYYY-MM-DD |
| transactions_count | INTEGER | Transactions that day |
| total_volume | DECIMAL | Total USD volume |
| unique_buyers | INTEGER | Number of unique buyers |
| unique_assets_traded | INTEGER | Assets with purchases |
| average_transaction_size | DECIMAL | Avg transaction value |
| metadata | JSONB | Top assets, breakdowns |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update |

## Public Endpoints

### GET /api/analytics/overview
Get marketplace overview metrics.

**Response:**
```json
{
  "data": {
    "totalTransactions": 256,
    "totalVolume": 12500000.50,
    "totalVolumeFormatted": "$12,500,000.50",
    "totalShares": 45000,
    "uniqueBuyers": 128,
    "uniqueAssets": 12,
    "averageTransactionSize": 48828.13,
    "averageTransactionSizeFormatted": "$48,828.13",
    "activeUsers": {
      "week": 32,
      "month": 85
    },
    "timestamp": "2026-06-30T09:43:41.156Z"
  }
}
```

### GET /api/analytics/volume?days=30
Get volume metrics for a time period.

**Query Parameters:**
- `days`: Number of days to look back (default: 30, max: 365)

**Response:**
```json
{
  "data": {
    "currentPeriod": {
      "period": "2026-06-01 to 2026-06-30",
      "totalVolume": 5000000,
      "totalTransactions": 100,
      "uniqueBuyers": 50,
      "uniqueAssets": 8,
      "averageTransactionSize": 50000
    },
    "allTime": {
      "totalVolume": 12500000.50,
      "totalVolumeFormatted": "$12,500,000.50"
    },
    "growth": "40.00%"
  }
}
```

### GET /api/analytics/popular?limit=10&days=30
Get popular assets by trading volume.

**Query Parameters:**
- `limit`: Number of assets to return (default: 10, max: 100)
- `days`: Lookback period (default: 30, max: 365)

**Response:**
```json
{
  "data": {
    "assets": [
      {
        "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
        "volume": 2500000,
        "volumeFormatted": "$2,500,000.00",
        "transactionCount": 25,
        "averageTransactionSize": 100000
      }
    ],
    "period": "30 days"
  }
}
```

### GET /api/analytics/active-users?period=month
Get active user metrics.

**Query Parameters:**
- `period`: 'week', 'month', or 'all' (default: 'month')

**Response:**
```json
{
  "data": {
    "period": "Last 30 days",
    "activeUsers": 85,
    "timestamp": "2026-06-30T09:43:41.156Z"
  }
}
```

### GET /api/analytics/top-buyers?limit=10
Get top buyers by total spending.

**Query Parameters:**
- `limit`: Number of buyers (default: 10, max: 100)

**Response:**
```json
{
  "data": {
    "buyers": [
      {
        "walletAddress": "GXYZ...",
        "totalPurchases": 15,
        "totalSpent": 750000,
        "totalSpentFormatted": "$750,000.00",
        "sharesOwned": 1500,
        "firstPurchase": "2026-05-15T10:00:00.000Z",
        "lastPurchase": "2026-06-28T14:30:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### GET /api/analytics/purchase-trends?days=30&interval=day
Get purchase trends over time.

**Query Parameters:**
- `days`: Period to analyze (default: 30, max: 365)
- `interval`: 'day', 'week', or 'month' (default: 'day')

**Response:**
```json
{
  "data": {
    "trends": [
      {
        "date": "2026-06-30",
        "transactions": 5,
        "volume": 250000,
        "volumeFormatted": "$250,000.00",
        "uniqueBuyers": 4,
        "uniqueAssets": 2,
        "averageTransactionSize": 50000
      }
    ],
    "period": "30 days",
    "interval": "day"
  }
}
```

### GET /api/analytics/asset-performance/:contractId
Get performance metrics for a specific asset.

**Response:**
```json
{
  "data": {
    "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
    "transactionCount": 25,
    "volume": 2500000,
    "volumeFormatted": "$2,500,000.00",
    "uniqueBuyers": 12,
    "totalShares": 5000,
    "averageTransactionSize": 100000,
    "recentTransactions": [
      {
        "transaction_id": "tx_abc123...",
        "buyer_address": "GXYZ...",
        "shares_purchased": "500",
        "total_amount": "500000",
        "created_at": "2026-06-30T09:30:00.000Z"
      }
    ],
    "timestamp": "2026-06-30T09:43:41.156Z"
  }
}
```

### GET /api/analytics/user/:address?limit=20
Get user portfolio and purchase history.

**Path Parameters:**
- `address`: Stellar wallet address

**Query Parameters:**
- `limit`: Number of transactions (default: 20, max: 100)

**Response:**
```json
{
  "data": {
    "walletAddress": "GXYZ...",
    "activity": {
      "totalPurchases": 15,
      "totalSpent": 750000,
      "totalSpentFormatted": "$750,000.00",
      "sharesOwned": 1500,
      "firstPurchase": "2026-05-15T10:00:00.000Z",
      "lastPurchase": "2026-06-28T14:30:00.000Z"
    },
    "purchases": [
      {
        "transactionId": "tx_abc123...",
        "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
        "shares": "500",
        "amount": 50000,
        "amountFormatted": "$50,000.00",
        "date": "2026-06-28T14:30:00.000Z",
        "status": "completed"
      }
    ],
    "timestamp": "2026-06-30T09:43:41.156Z"
  }
}
```

## Purchase Recording Endpoints

### POST /api/purchases
Record a purchase/share buy event from the blockchain.

**Required Body:**
```json
{
  "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
  "buyerAddress": "GXYZ...",
  "sharesPurchased": 500,
  "pricePerShare": 1000,
  "totalAmount": 500000,
  "paymentToken": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "blockchainHash": "abc123def456..."
}
```

**Response (201 Created):**
```json
{
  "data": {
    "transactionId": "tx_abc123def456...",
    "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
    "status": "completed",
    "createdAt": "2026-06-30T09:43:41.156Z"
  },
  "message": "Purchase recorded successfully"
}
```

### GET /api/purchases/:transactionId
Get purchase details.

**Response:**
```json
{
  "data": {
    "transactionId": "tx_abc123...",
    "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
    "buyerAddress": "GXYZ...",
    "sharesPurchased": 500,
    "pricePerShare": 1000,
    "totalAmount": 500000,
    "totalAmountFormatted": "$500,000.00",
    "paymentToken": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "status": "completed",
    "blockchainHash": "abc123def456...",
    "createdAt": "2026-06-30T09:43:41.156Z"
  }
}
```

### GET /api/purchases/contract/:contractId?limit=20&offset=0
Get recent purchases for a specific asset.

**Query Parameters:**
- `limit`: Number of records (default: 20, max: 100)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "data": [
    {
      "transactionId": "tx_abc123...",
      "buyerAddress": "GXYZ...",
      "sharesPurchased": 500,
      "pricePerShare": 1000,
      "totalAmount": 500000,
      "totalAmountFormatted": "$500,000.00",
      "createdAt": "2026-06-30T09:30:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "count": 1
  }
}
```

## Admin Endpoints

All admin endpoints require the `x-api-key` header with a valid admin API key.

### GET /api/analytics/dashboard (Admin)
Full admin dashboard with all metrics.

**Response:**
```json
{
  "data": {
    "overview": {
      "totalTransactions": 256,
      "totalVolume": 12500000.50,
      "totalShares": 45000,
      "uniqueBuyers": 128,
      "uniqueAssets": 12
    },
    "activeUsers": {
      "week": 32,
      "month": 85
    },
    "topBuyers": [
      {
        "address": "GXYZ...",
        "spent": 750000,
        "purchases": 15
      }
    ],
    "dailyMetrics": [
      {
        "date": "2026-06-30",
        "transactions_count": 5,
        "total_volume": 250000,
        "unique_buyers": 4,
        "unique_assets_traded": 2,
        "average_transaction_size": 50000
      }
    ],
    "timestamp": "2026-06-30T09:43:41.156Z"
  }
}
```

### POST /api/analytics/compute-daily (Admin)
Compute daily analytics snapshot for a specific date.

**Optional Body:**
```json
{
  "date": "2026-06-30"
}
```

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "date": "2026-06-30",
      "transactions_count": 5,
      "total_volume": 250000,
      "unique_buyers": 4,
      "unique_assets_traded": 2,
      "average_transaction_size": 50000,
      "metadata": {...},
      "created_at": "2026-06-30T09:43:41.156Z"
    }
  ],
  "message": "Daily analytics computed successfully"
}
```

### GET /api/analytics/daily?from=2026-06-01&to=2026-06-30 (Admin)
Get daily analytics time series.

**Query Parameters:**
- `from`: Start date (ISO format)
- `to`: End date (ISO format)
- `limit`: Max records (default: 100, max: 365)

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "date": "2026-06-30",
      "transactions_count": 5,
      "total_volume": 250000,
      "unique_buyers": 4,
      "unique_assets_traded": 2,
      "average_transaction_size": 50000,
      "metadata": {...},
      "created_at": "2026-06-30T09:43:41.156Z",
      "updated_at": "2026-06-30T09:43:41.156Z"
    }
  ]
}
```

## Frontend Integration

### Recording a Purchase

After a successful blockchain transaction (shares purchased), call:

```javascript
const response = await fetch('/api/purchases', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contractId: contract.id,
    buyerAddress: userWalletAddress,
    sharesPurchased: 500,
    pricePerShare: 1000,
    totalAmount: 500000,
    paymentToken: paymentTokenContract,
    blockchainHash: transactionHash,
  }),
});

const { data } = await response.json();
console.log('Purchase recorded:', data.transactionId);
```

### Fetching Analytics

```javascript
// Get overview metrics
const overview = await fetch('/api/analytics/overview').then(r => r.json());
console.log('Total volume:', overview.data.totalVolumeFormatted);

// Get user portfolio
const portfolio = await fetch(`/api/analytics/user/${walletAddress}`)
  .then(r => r.json());
console.log('User spending:', portfolio.data.activity.totalSpentFormatted);

// Get purchase trends
const trends = await fetch('/api/analytics/purchase-trends?days=30')
  .then(r => r.json());
console.log('Transactions:', trends.data.trends);
```

## Error Handling

All endpoints return appropriate HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created (POST /purchases) |
| 400 | Bad request (invalid params) |
| 401 | Unauthorized (invalid API key) |
| 404 | Not found |
| 500 | Server error |

Error responses include a message:
```json
{
  "error": "Failed to record purchase",
  "message": "Invalid contractId format"
}
```

## Caching

- Public analytics endpoints use 5-minute in-memory cache
- Admin endpoints bypass cache (always fresh)
- Cache can be cleared by computing daily snapshots

## Migration

Run migrations to create tables:
```bash
npm run migrate
```

Rollback if needed:
```bash
npm run migrate:rollback
```
