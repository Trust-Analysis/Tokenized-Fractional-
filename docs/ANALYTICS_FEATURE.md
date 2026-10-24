# Analytics & Purchase Tracking Feature

## Overview

This document describes the new analytics and purchase tracking system added to the RWA Marketplace. It enables admins to understand marketplace activity, users to track their portfolios, and the system to compute marketplace insights.

## What's New

### Database Tables

Three new tables track purchase events and compute analytics:

1. **transactions** — Every share purchase recorded with buyer, asset, amount, and blockchain hash
2. **user_activity** — Aggregated user stats: total purchases, spending, shares owned
3. **daily_analytics** — Daily snapshots of marketplace metrics computed at end of day

See [ANALYTICS_API.md](../backend/docs/ANALYTICS_API.md) for schema details.

### New API Endpoints

#### Public Analytics (No Auth Required)

- `GET /api/analytics/overview` — Marketplace totals and key metrics
- `GET /api/analytics/volume` — Trading volume by time period
- `GET /api/analytics/popular` — Top assets by volume
- `GET /api/analytics/active-users` — Active user counts
- `GET /api/analytics/top-buyers` — Buyers ranked by spending
- `GET /api/analytics/purchase-trends` — Volume trends over time
- `GET /api/analytics/asset-performance/:contractId` — Asset-specific metrics
- `GET /api/analytics/user/:address` — User portfolio and history

#### Purchase Recording (Public)

- `POST /api/purchases` — Record a blockchain purchase (called by frontend)
- `GET /api/purchases/:transactionId` — Get purchase details
- `GET /api/purchases/contract/:contractId` — Get asset purchase history

#### Admin Dashboard (API Key Required)

- `GET /api/analytics/dashboard` — Full admin dashboard
- `POST /api/analytics/compute-daily` — Compute daily snapshot
- `GET /api/analytics/daily` — Daily metrics time series

See [ANALYTICS_API.md](../backend/docs/ANALYTICS_API.md) for full endpoint documentation.

## Backend Implementation

### TransactionService (`src/services/transactionService.js`)

Handles recording and querying purchase transactions:

```javascript
import { createTransactionService } from './src/services/transactionService.js';

const txService = createTransactionService(db, logger);

// Record a purchase
const tx = await txService.recordPurchase({
  contractId: 'C...',
  buyerAddress: 'G...',
  sharesPurchased: 500,
  pricePerShare: 1000,
  totalAmount: 500000,
  paymentToken: 'C...',
  blockchainHash: 'abc123...',
});

// Query metrics
const metrics = await txService.getAllTimeMetrics();
const topBuyers = await txService.getTopBuyers(10);
const userActivity = await txService.getUserActivity(walletAddress);
const contractVolume = await txService.getContractVolume(contractId);
```

**Key Methods:**
- `recordPurchase(data)` — Insert transaction and update user activity
- `getTransaction(id)` — Get single transaction
- `getContractTransactions(id, limit, offset)` — Get purchases for an asset
- `getBuyerTransactions(address, limit, offset)` — Get user's purchases
- `getContractTransactionCount(id)` — Count purchases for asset
- `getContractVolume(id)` — Total USD volume for asset
- `getUserActivity(address)` — Get user stats
- `getTopBuyers(limit)` — Buyers by spending
- `getActiveUsersCount(days)` — Active users in period
- `getAllTimeMetrics()` — Marketplace totals
- `getMetricsForDateRange(from, to)` — Metrics for period
- `computeDailyAnalytics(date)` — Compute daily snapshot
- `getDailyAnalyticsForRange(from, to)` — Daily metrics for period

### Analytics Routes (`src/routes/analytics.js`)

Express routes for analytics endpoints. Factory function returns configured router:

```javascript
import { createAnalyticsRoutes } from './src/routes/analytics.js';

const analyticsRouter = createAnalyticsRoutes(transactionService, logger, adminAuth);
app.use('/api/analytics', analyticsRouter);
```

### Purchase Routes (`src/routes/purchases.js`)

Express routes for recording purchases:

```javascript
import { createPurchaseRoutes } from './src/routes/purchases.js';

const purchasesRouter = createPurchaseRoutes(transactionService, logger);
app.use('/api/purchases', purchasesRouter);
```

### App Integration (`src/app.js`)

The services are initialized during app setup:

```javascript
export async function initializeApp() {
  const db = await initDatabase(NODE_ENV);
  
  const transactionService = createTransactionService(db, logger);
  const analyticsRouter = createAnalyticsRoutes(transactionService, logger, adminAuth);
  const purchasesRouter = createPurchaseRoutes(transactionService, logger);
  
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/purchases', purchasesRouter);
}
```

## Frontend Integration

### Recording a Purchase

After a successful Soroban blockchain transaction (buy_shares), call the purchase recording endpoint:

```javascript
async function recordPurchase(contractId, buyerAddress, shares, pricePerShare, txHash) {
  try {
    const response = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractId,
        buyerAddress,
        sharesPurchased: shares,
        pricePerShare,
        totalAmount: shares * pricePerShare,
        paymentToken: process.env.VITE_PAYMENT_TOKEN,
        blockchainHash: txHash,
      }),
    });

    if (!response.ok) {
      console.error('Purchase recording failed:', response.status);
      return null;
    }

    const { data } = await response.json();
    console.log('Purchase recorded:', data.transactionId);
    return data;
  } catch (error) {
    console.error('Error recording purchase:', error);
  }
}

// Usage after buy_shares transaction succeeds
const txResult = await invokeContract('buy_shares', {
  buyer: userAddress,
  shares: 500,
  amount: 500000,
});

if (txResult.status === 'success') {
  await recordPurchase(
    contractId,
    userAddress,
    500,
    1000,
    txResult.txHash
  );
}
```

### Displaying Analytics

Fetch and display analytics on dashboard:

```javascript
// Overview metrics
async function getMarketplaceOverview() {
  const res = await fetch('/api/analytics/overview');
  const { data } = await res.json();
  return data;
}

// User portfolio
async function getUserPortfolio(walletAddress) {
  const res = await fetch(`/api/analytics/user/${walletAddress}`);
  const { data } = await res.json();
  return data;
}

// Asset performance
async function getAssetStats(contractId) {
  const res = await fetch(`/api/analytics/asset-performance/${contractId}`);
  const { data } = await res.json();
  return data;
}

// Purchase trends chart
async function getPurchaseTrends(days = 30) {
  const res = await fetch(`/api/analytics/purchase-trends?days=${days}`);
  const { data } = await res.json();
  return data.trends;
}

// Popular assets
async function getPopularAssets(limit = 10) {
  const res = await fetch(`/api/analytics/popular?limit=${limit}`);
  const { data } = await res.json();
  return data.assets;
}

// Usage in React component
function AnalyticsDashboard() {
  const [overview, setOverview] = useState(null);
  const [userPortfolio, setUserPortfolio] = useState(null);

  useEffect(() => {
    async function load() {
      const ov = await getMarketplaceOverview();
      setOverview(ov);

      if (walletAddress) {
        const portfolio = await getUserPortfolio(walletAddress);
        setUserPortfolio(portfolio);
      }
    }
    load();
  }, [walletAddress]);

  return (
    <div>
      {overview && (
        <>
          <h2>Marketplace Volume: {overview.totalVolumeFormatted}</h2>
          <p>Unique Buyers: {overview.uniqueBuyers}</p>
          <p>Total Transactions: {overview.totalTransactions}</p>
        </>
      )}

      {userPortfolio && (
        <>
          <h3>Your Portfolio</h3>
          <p>Total Spent: {userPortfolio.activity.totalSpentFormatted}</p>
          <p>Shares Owned: {userPortfolio.activity.sharesOwned}</p>
        </>
      )}
    </div>
  );
}
```

## Migration & Setup

### 1. Create Migrations

The migration file `20260630000000_create_transactions_table.js` is automatically included when you upgrade the backend code.

### 2. Run Migrations

```bash
cd backend
npm run migrate
```

This creates three new tables:
- `transactions` — Purchase events
- `user_activity` — User stats
- `daily_analytics` — Daily snapshots

### 3. Verify Tables

```bash
npm run migrate:status
```

### 4. Rollback (if needed)

```bash
npm run migrate:rollback
```

## Admin Dashboard

Admins can view comprehensive analytics through the admin dashboard.

**Requires:** Valid API key in `x-api-key` header

### Overview
- Total transactions and volume
- Active users (7-day, 30-day)
- Top buyers by spending
- Popular assets

### Daily Metrics
- Date-based breakdown
- Transactions per day
- Volume trends
- Unique buyer counts
- Average transaction size

### Compute Manual Snapshot

Trigger daily snapshot computation manually:

```bash
curl -X POST http://localhost:3001/api/analytics/compute-daily \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-06-30"}'
```

## Performance Considerations

### Caching

Public analytics endpoints use 5-minute in-memory cache to improve performance:

- `GET /analytics/overview` — 5 min cache
- `GET /analytics/volume` — 5 min cache per date range
- `GET /analytics/popular` — 5 min cache per limit
- etc.

Admin endpoints bypass cache for real-time data.

### Database Indexing

The migration creates indexes on frequently queried columns:

- `transactions.contract_id` — Asset queries
- `transactions.buyer_address` — User queries
- `transactions.created_at` — Time-range queries
- `user_activity.total_purchases` — Ranking queries
- `daily_analytics.date` — Daily snapshots

### Query Optimization

- Daily snapshots pre-compute expensive aggregations
- User activity table maintains running totals
- Time-range queries use date-based filtering

## Monitoring & Maintenance

### Monitor Purchase Recording

Check that purchases are being recorded:

```bash
# Check total transactions in DB
sqlite3 dev.db "SELECT COUNT(*) FROM transactions;"

# Check daily volume
sqlite3 dev.db "SELECT date, total_volume FROM daily_analytics ORDER BY date DESC LIMIT 10;"

# Check top users
sqlite3 dev.db "SELECT wallet_address, total_spent FROM user_activity ORDER BY total_spent DESC LIMIT 5;"
```

### Troubleshooting

**Q: Purchases not recording**
A: Ensure frontend is calling `POST /api/purchases` after blockchain transaction. Check backend logs for errors.

**Q: Analytics endpoint 500 errors**
A: Verify database tables were created with `npm run migrate:status`. Check logs for query errors.

**Q: Stale analytics data**
A: Public endpoints cache for 5 minutes. Either wait or admin can call `POST /api/analytics/compute-daily` to refresh.

## Future Enhancements

Potential future improvements:

1. **Real-time WebSocket Analytics** — Push updates to connected clients
2. **Cohort Analysis** — Track user groups and their behavior
3. **Predictive Analytics** — ML models for volume forecasting
4. **Custom Reports** — Admin can generate CSV exports by date range
5. **Asset Performance Scoring** — Calculate scores based on volume, buyers, trends
6. **Referral Tracking** — If referral system is added
7. **Geographic Analytics** — If asset locations are in metadata
8. **Fraud Detection** — Anomaly detection on purchase patterns

## Support

For issues or questions:
1. Check [ANALYTICS_API.md](../backend/docs/ANALYTICS_API.md) for endpoint details
2. Check backend logs: `npm run dev 2>&1 | grep -i analytics`
3. Review migration status: `npm run migrate:status`
4. Test manually with curl before integrating in frontend
