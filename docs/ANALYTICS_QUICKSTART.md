# Analytics QuickStart Guide

Get marketplace analytics up and running in 5 minutes.

## 1. Setup (One-time)

### Run Migrations
```bash
cd backend
npm run migrate
```

This creates three new database tables:
- `transactions` — Every purchase
- `user_activity` — User stats  
- `daily_analytics` — Daily snapshots

Verify:
```bash
npm run migrate:status
```

## 2. Test Endpoints

### Get Overview Metrics
```bash
curl http://localhost:3001/api/analytics/overview
```

**Response:**
```json
{
  "data": {
    "totalTransactions": 0,
    "totalVolume": 0,
    "uniqueBuyers": 0,
    "activeUsers": { "week": 0, "month": 0 }
  }
}
```

### Record a Purchase
```bash
curl -X POST http://localhost:3001/api/purchases \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "CBKJ5G3XLQQ2N2CTJVQ7H2L3L5M6N7O8P9Q1R2S3T4U5V6W7X8Y9Z0",
    "buyerAddress": "GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5",
    "sharesPurchased": 500,
    "pricePerShare": 1000,
    "totalAmount": 500000,
    "paymentToken": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
  }'
```

**Response:**
```json
{
  "data": {
    "transactionId": "tx_abc123def456...",
    "status": "completed",
    "createdAt": "2026-06-30T09:43:41.156Z"
  },
  "message": "Purchase recorded successfully"
}
```

### Check Updated Metrics
```bash
curl http://localhost:3001/api/analytics/overview
```

Now shows the recorded purchase!

## 3. Frontend Integration

### After Blockchain Purchase
```javascript
// After buy_shares transaction succeeds
const txResult = await invokeContract('buy_shares', {
  buyer: userAddress,
  shares: 500,
  amount: 500000,
});

if (txResult.status === 'success') {
  // Record the purchase for analytics
  await fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId: contractId,
      buyerAddress: userAddress,
      sharesPurchased: 500,
      pricePerShare: 1000,
      totalAmount: 500000,
      paymentToken: process.env.VITE_PAYMENT_TOKEN,
      blockchainHash: txResult.hash,
    }),
  });
}
```

### Display Analytics
```javascript
// Show marketplace overview
const overview = await fetch('/api/analytics/overview').then(r => r.json());
console.log(`Total Volume: ${overview.data.totalVolumeFormatted}`);
console.log(`Active Buyers: ${overview.data.uniqueBuyers}`);

// Show user portfolio
const portfolio = await fetch(`/api/analytics/user/${walletAddress}`)
  .then(r => r.json());
console.log(`You spent: ${portfolio.data.activity.totalSpentFormatted}`);
console.log(`You own: ${portfolio.data.activity.sharesOwned} shares`);

// Show purchase trends
const trends = await fetch('/api/analytics/purchase-trends?days=30')
  .then(r => r.json());
trends.data.trends.forEach(day => {
  console.log(`${day.date}: ${day.transactions} purchases, ${day.volumeFormatted}`);
});
```

## 4. Common Endpoints

| Purpose | Endpoint | Method |
|---------|----------|--------|
| Marketplace overview | `/api/analytics/overview` | GET |
| Volume metrics | `/api/analytics/volume?days=30` | GET |
| Popular assets | `/api/analytics/popular?limit=10` | GET |
| Active users | `/api/analytics/active-users` | GET |
| Top buyers | `/api/analytics/top-buyers?limit=10` | GET |
| Purchase trends | `/api/analytics/purchase-trends?days=30` | GET |
| Asset stats | `/api/analytics/asset-performance/{id}` | GET |
| User portfolio | `/api/analytics/user/{address}` | GET |
| **Record purchase** | `/api/purchases` | **POST** |
| Purchase details | `/api/purchases/{id}` | GET |
| Asset purchases | `/api/purchases/contract/{id}` | GET |

## 5. Admin Dashboard

### Get Full Dashboard
```bash
curl -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/analytics/dashboard
```

### Get Daily Analytics
```bash
curl -H "x-api-key: YOUR_API_KEY" \
  "http://localhost:3001/api/analytics/daily?from=2026-06-01&to=2026-06-30"
```

### Compute Daily Snapshot
```bash
curl -X POST -H "x-api-key: YOUR_API_KEY" \
  http://localhost:3001/api/analytics/compute-daily \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-06-30"}'
```

## 6. Schema

### transactions
```
id, transaction_id*, contract_id, buyer_address, 
shares_purchased, price_per_share, total_amount, 
payment_token, status, blockchain_hash, metadata, 
created_at, updated_at
```

### user_activity
```
id, wallet_address*, total_purchases, total_spent, 
shares_owned, last_purchase_at, first_seen_at, 
created_at, updated_at
```

### daily_analytics
```
id, date*, transactions_count, total_volume, 
unique_buyers, unique_assets_traded, 
average_transaction_size, metadata, created_at, updated_at
```

## 7. Example Response: User Portfolio

```bash
curl http://localhost:3001/api/analytics/user/GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5
```

```json
{
  "data": {
    "walletAddress": "GBRPYHIL2CI3FV4BMSXIGTZTZMSMSCGVMFKFPGBCYDNBRJSVH4RRPCP5",
    "activity": {
      "totalPurchases": 1,
      "totalSpent": 500000,
      "totalSpentFormatted": "$500,000.00",
      "sharesOwned": 500,
      "firstPurchase": "2026-06-30T09:43:41.156Z",
      "lastPurchase": "2026-06-30T09:43:41.156Z"
    },
    "purchases": [
      {
        "transactionId": "tx_abc123...",
        "contractId": "CBKJ5G3X...",
        "shares": "500",
        "amount": 500000,
        "amountFormatted": "$500,000.00",
        "date": "2026-06-30T09:43:41.156Z",
        "status": "completed"
      }
    ]
  }
}
```

## 8. Troubleshooting

**Q: Migration failed**
```
A: Ensure database is initialized. Check `npm run migrate:status`
   If needed, rollback with `npm run migrate:rollback`
```

**Q: POST /purchases returns 400 "Missing required fields"**
```
A: Verify all required fields are present:
   - contractId (string starting with "C")
   - buyerAddress (string starting with "G", 56+ chars)
   - sharesPurchased (number > 0)
   - pricePerShare (number > 0)
   - totalAmount (number > 0)
   - paymentToken (contract address)
```

**Q: Analytics endpoints return empty data**
```
A: This is normal! Record purchases first with POST /api/purchases
   Then query analytics. Data updates immediately.
```

**Q: "API key service not initialized" error**
```
A: Ensure backend started with npm run dev (not direct node start)
   The app.js initializes services during startup
```

## 9. Next Steps

1. ✅ Run migrations
2. ✅ Test endpoints with curl
3. ➡️ **Integrate `POST /api/purchases` in frontend after blockchain transaction**
4. ➡️ **Add analytics UI showing overview, trends, user portfolio**
5. ➡️ **Set up admin dashboard for admins**

## 10. Documentation

- **Full API Reference:** `backend/docs/ANALYTICS_API.md`
- **Feature Guide:** `docs/ANALYTICS_FEATURE.md`
- **Implementation Details:** `ANALYTICS_IMPLEMENTATION_SUMMARY.md`

---

**Need help?** Check the docs or ask in issues!
