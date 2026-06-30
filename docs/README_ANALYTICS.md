# Analytics Feature Documentation Index

Welcome! This folder contains comprehensive documentation for the new Analytics & Purchase Tracking feature.

## Quick Navigation

### 🚀 Getting Started
- **[ANALYTICS_QUICKSTART.md](ANALYTICS_QUICKSTART.md)** — 5-minute setup guide
  - Run migrations
  - Test endpoints with curl
  - Record purchases
  - Display analytics
  - Troubleshooting

### 📚 Complete Reference
- **[ANALYTICS_FEATURE.md](ANALYTICS_FEATURE.md)** — Full feature documentation
  - Overview of all components
  - Backend implementation details
  - Frontend integration guide
  - Admin dashboard setup
  - Performance optimization tips
  - Monitoring and maintenance

### 🔌 API Documentation
- **[../backend/docs/ANALYTICS_API.md](../backend/docs/ANALYTICS_API.md)** — Complete API reference
  - Database schema documentation
  - All 14 endpoints with examples
  - Request/response samples
  - Error handling
  - Frontend code examples
  - Admin endpoints guide

### 📋 Summary
- **[../ANALYTICS_IMPLEMENTATION_SUMMARY.md](../ANALYTICS_IMPLEMENTATION_SUMMARY.md)** — Implementation overview
  - Files created and modified
  - Endpoint summary
  - Database tables
  - Key features
  - Integration points
  - Testing checklist

## Feature Overview

The RWA Marketplace now includes comprehensive analytics for tracking marketplace activity:

### What You Can Track
- **Total marketplace volume** — Total USD value of all purchases
- **Active users** — Number of unique buyers in different time periods
- **Popular assets** — Top assets by trading volume
- **Purchase trends** — Volume trends over time
- **User portfolios** — Individual user purchase history and holdings
- **Asset performance** — Metrics for specific tokenized assets

### Key Endpoints

#### For Users (Public, No Auth Required)
```
GET  /api/analytics/overview              - Marketplace metrics
GET  /api/analytics/volume                - Trading volume breakdown
GET  /api/analytics/popular               - Popular assets
GET  /api/analytics/active-users          - Active user counts
GET  /api/analytics/top-buyers            - Top buyers by spending
GET  /api/analytics/purchase-trends       - Volume trends
GET  /api/analytics/asset-performance/:id - Asset metrics
GET  /api/analytics/user/:address         - User portfolio
```

#### For Recording Purchases (Public)
```
POST /api/purchases                       - Record blockchain purchase
GET  /api/purchases/:id                   - Get purchase details
GET  /api/purchases/contract/:id          - Asset purchase history
```

#### For Admins (Requires API Key)
```
GET  /api/analytics/dashboard             - Full dashboard
POST /api/analytics/compute-daily         - Compute daily snapshot
GET  /api/analytics/daily                 - Daily metrics time series
```

### Database Tables

Three new tables track the data:

1. **transactions** — Every share purchase with buyer, amount, asset
2. **user_activity** — Aggregated user stats (total spent, shares owned, etc.)
3. **daily_analytics** — Pre-computed daily snapshots for performance

## Setup

### 1. Create Database Tables
```bash
cd backend
npm run migrate
```

### 2. Test an Endpoint
```bash
curl http://localhost:3001/api/analytics/overview
```

### 3. Record a Purchase
After a user buys shares on the blockchain, call:
```bash
curl -X POST http://localhost:3001/api/purchases \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "CBKJ5G3X...",
    "buyerAddress": "GXYZ...",
    "sharesPurchased": 500,
    "pricePerShare": 1000,
    "totalAmount": 500000,
    "paymentToken": "CDLZFC3S..."
  }'
```

### 4. View Updated Metrics
```bash
curl http://localhost:3001/api/analytics/overview
```

## Frontend Integration

### Step 1: After Blockchain Transaction
```javascript
// After buy_shares transaction succeeds
if (transactionSuccess) {
  await fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      buyerAddress,
      sharesPurchased: 500,
      pricePerShare: 1000,
      totalAmount: 500000,
      paymentToken,
      blockchainHash: txHash,
    }),
  });
}
```

### Step 2: Display Analytics
```javascript
// Show marketplace overview
const overview = await fetch('/api/analytics/overview').then(r => r.json());
console.log(`Total Volume: ${overview.data.totalVolumeFormatted}`);

// Show user portfolio
const portfolio = await fetch(`/api/analytics/user/${walletAddress}`)
  .then(r => r.json());
console.log(`Your spending: ${portfolio.data.activity.totalSpentFormatted}`);
```

## Common Questions

### Q: Why create a new database?
A: The transaction tracking requires persistent storage. The `transactions` table records every purchase, `user_activity` aggregates stats, and `daily_analytics` pre-computes metrics for performance.

### Q: Will this slow down my API?
A: No. Public endpoints use 5-minute caching. Admin endpoints bypass cache for freshness. Database indexes optimize queries.

### Q: How do I display purchase trends?
A: Call `GET /api/analytics/purchase-trends?days=30` to get daily data, then plot with Chart.js, D3.js, or similar.

### Q: Can users see other users' wallets?
A: No. The `/api/analytics/user/:address` endpoint returns portfolio data for any wallet, but no sensitive info is exposed — just public purchase history.

### Q: How do I add purchase tracking to the frontend?
A: After the blockchain transaction succeeds, call `POST /api/purchases` with the transaction details. See [ANALYTICS_FEATURE.md](ANALYTICS_FEATURE.md) for code examples.

## File Structure

```
docs/
  ├── ANALYTICS_QUICKSTART.md          ← Start here (5 min)
  ├── ANALYTICS_FEATURE.md             ← Full guide
  └── README_ANALYTICS.md              ← This file

backend/
  ├── docs/
  │   └── ANALYTICS_API.md             ← API reference
  ├── src/
  │   ├── services/
  │   │   └── transactionService.js    ← Core service
  │   └── routes/
  │       ├── analytics.js             ← Analytics endpoints
  │       └── purchases.js             ← Purchase recording
  ├── migrations/
  │   └── 20260630000000_create_transactions_table.js
  └── __tests__/
      └── analytics.test.js            ← Integration tests

ANALYTICS_IMPLEMENTATION_SUMMARY.md    ← What's new
```

## Support

### Troubleshooting
1. Check [ANALYTICS_QUICKSTART.md](ANALYTICS_QUICKSTART.md) for common issues
2. Read [ANALYTICS_FEATURE.md](ANALYTICS_FEATURE.md) for detailed explanations
3. Review [../backend/docs/ANALYTICS_API.md](../backend/docs/ANALYTICS_API.md) for endpoint details

### Need Help?
- Verify migrations ran: `npm run migrate:status`
- Check logs: `npm run dev 2>&1 | grep -i analytics`
- Test manually with curl before integrating in frontend
- Review test file: `backend/__tests__/analytics.test.js`

## Next Steps

1. ✅ Read [ANALYTICS_QUICKSTART.md](ANALYTICS_QUICKSTART.md)
2. ✅ Run `npm run migrate` in backend
3. ✅ Test endpoints with curl
4. ➡️ Integrate `POST /api/purchases` in frontend
5. ➡️ Display analytics on dashboard
6. ➡️ Set up admin analytics dashboard

---

**Ready to get started?** → [ANALYTICS_QUICKSTART.md](ANALYTICS_QUICKSTART.md)
