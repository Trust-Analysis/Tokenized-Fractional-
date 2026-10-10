# GraphQL Subscriptions Quick Start

Get real-time updates from the RWA Marketplace in 5 minutes.

## 1. Verify Backend is Running

```bash
npm run dev  # in /backend directory
```

Check: `http://localhost:3001/health` should return `{"ok":true}`

## 2. Test Subscriptions in Apollo Sandbox

Open `http://localhost:3001/graphql` in your browser.

## 3. First Subscription (Copy & Paste)

Listen for share purchases across the marketplace:

```graphql
subscription {
  onSharePurchased {
    contractId
    buyer
    shareCount
    timestamp
  }
}
```

Click the play button. You'll see `Listening...` in the response panel.

## 4. Trigger an Event (From Backend)

In another terminal, open Node and trigger an event:

```bash
node
```

```javascript
import { publishSharePurchased } from './backend/pubsub.js';

publishSharePurchased({
  contractId: 'C123abc',
  buyer: 'GBUYER123',
  shareCount: 10,
  totalPrice: 50000000,
  remainingShares: 990,
});
```

**Result:** The subscription in Apollo Sandbox shows the event!

## 5. Filter by Asset

Listen only to a specific asset:

```graphql
subscription {
  onSharePurchased(contractId: "C123abc") {
    buyer
    shareCount
    timestamp
  }
}
```

## Common Subscriptions

### All Share Purchases
```graphql
subscription {
  onSharePurchased {
    contractId
    buyer
    shareCount
    totalPrice
    timestamp
  }
}
```

### Price Updates
```graphql
subscription {
  onPriceUpdated {
    contractId
    newPrice
    oldPrice
    timestamp
  }
}
```

### New Assets Listed
```graphql
subscription {
  onAssetListed {
    contractId
    title
    location
    pricePerShare
  }
}
```

### Availability Changes
```graphql
subscription {
  onAvailabilityChanged(contractId: "C123abc") {
    availableShares
    previousAvailable
    timestamp
  }
}
```

## Frontend Integration (React)

```javascript
import { useSubscription, gql } from '@apollo/client';

const SHARE_PURCHASED = gql`
  subscription OnSharePurchased($contractId: String) {
    onSharePurchased(contractId: $contractId) {
      buyer
      shareCount
      timestamp
    }
  }
`;

function LiveFeed() {
  const { data, loading } = useSubscription(SHARE_PURCHASED, {
    variables: { contractId: 'C123abc' }
  });

  if (loading) return <p>Waiting for updates...</p>;

  return (
    <div>
      <p>Buyer: {data?.onSharePurchased?.buyer}</p>
      <p>Shares: {data?.onSharePurchased?.shareCount}</p>
      <p>Time: {data?.onSharePurchased?.timestamp}</p>
    </div>
  );
}
```

## Multiple Subscriptions

Monitor everything at once:

```graphql
subscription {
  shares: onSharePurchased {
    contractId
    buyer
    shareCount
  }
  
  prices: onPriceUpdated {
    contractId
    newPrice
  }
  
  listings: onAssetListed {
    contractId
    title
  }
}
```

## Publishing Events from Backend

```javascript
import {
  publishSharePurchased,
  publishPriceUpdated,
  publishAssetListed,
  publishMarketplacePaused,
} from './backend/pubsub.js';

// When share is bought
publishSharePurchased({
  contractId: 'C123',
  buyer: 'GBUYER456',
  shareCount: 5,
  totalPrice: 25000000,
  remainingShares: 985,
});

// When price changes
publishPriceUpdated({
  contractId: 'C123',
  newPrice: 5000,
  oldPrice: 4500,
});

// When new asset listed
publishAssetListed({
  contractId: 'C456',
  title: 'Downtown Office',
  location: 'NYC',
  pricePerShare: 100000,
});

// When marketplace paused
publishMarketplacePaused({
  contractId: 'C789',
  reason: 'Maintenance',
});
```

## Troubleshooting

**Q: Subscription connects but gets no events**
A: Make sure to call `publishXxx()` function from backend in same process/server instance

**Q: WebSocket connection refused**
A: Check that backend is running on port 3001

**Q: "Cannot GET /graphql/subscriptions"**
A: This is normal - subscriptions use WebSocket protocol, not HTTP. Connection happens automatically when you send a subscription query.

## Next Steps

- [Full Subscription Documentation](./GRAPHQL_SUBSCRIPTIONS.md)
- [GraphQL API Guide](./GRAPHQL_API.md)
- [Architecture Overview](./architecture.md)
- [Run Tests](../backend/__tests__/subscriptions.test.js)

---

## Key Points

✅ WebSocket endpoint: `ws://localhost:3001/graphql/subscriptions`  
✅ Subscribe in Apollo Sandbox at `http://localhost:3001/graphql`  
✅ Trigger events with `publishXxx()` functions  
✅ Filter subscriptions by `contractId` parameter  
✅ All events include `timestamp` in ISO 8601 format  

That's it! You now have real-time updates working. 🚀
