# GraphQL Real-Time Subscriptions

## Overview

GraphQL subscriptions enable real-time updates for RWA Marketplace events. Clients can subscribe to specific events and receive live notifications as they occur without polling.

**Endpoint:** `ws://localhost:3001/graphql/subscriptions` (WebSocket)

## Quick Start

### 1. Connect to the Subscriptions Endpoint

```graphql
subscription {
  onSharePurchased {
    contractId
    buyer
    shareCount
    totalPrice
    remainingShares
    timestamp
  }
}
```

### 2. Using Apollo Client (Frontend)

```javascript
import { gql, useSubscription } from '@apollo/client';

const SHARE_PURCHASED_SUBSCRIPTION = gql`
  subscription OnSharePurchased($contractId: String) {
    onSharePurchased(contractId: $contractId) {
      contractId
      buyer
      shareCount
      totalPrice
      remainingShares
      timestamp
    }
  }
`;

function LiveShares() {
  const { data, loading, error } = useSubscription(SHARE_PURCHASED_SUBSCRIPTION, {
    variables: { contractId: 'C123abc...' }
  });

  if (loading) return <p>Listening for updates...</p>;
  if (error) return <p>Subscription error: {error.message}</p>;

  return (
    <div>
      <h2>Live Share Purchase</h2>
      <p>Buyer: {data?.onSharePurchased?.buyer}</p>
      <p>Shares: {data?.onSharePurchased?.shareCount}</p>
      <p>Time: {data?.onSharePurchased?.timestamp}</p>
    </div>
  );
}
```

### 3. Using WebSockets with graphql-ws

```javascript
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'ws://localhost:3001/graphql/subscriptions',
});

client.subscribe(
  {
    query: `
      subscription {
        onSharePurchased {
          contractId
          buyer
          shareCount
          timestamp
        }
      }
    `,
  },
  {
    next: (msg) => console.log('New purchase:', msg.data),
    error: (err) => console.error('Subscription error:', err),
    complete: () => console.log('Subscription ended'),
  }
);
```

## Available Subscriptions

### 1. Share Purchase Events

Subscribe to share purchase transactions.

```graphql
subscription OnSharePurchased($contractId: String) {
  onSharePurchased(contractId: $contractId) {
    contractId       # The asset being purchased
    buyer            # Buyer address
    shareCount       # Number of shares purchased
    totalPrice       # Total purchase price in stroops
    remainingShares  # Remaining available shares after purchase
    timestamp        # Purchase timestamp (ISO 8601)
  }
}
```

**Variables:**
```json
{
  "contractId": "C123abc..."  // Optional: filter by specific asset
}
```

**Usage Example:**
Listen for all share purchases across the marketplace:
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

Listen for purchases of a specific asset:
```graphql
subscription {
  onSharePurchased(contractId: "C123abc...") {
    contractId
    buyer
    shareCount
    totalPrice
    timestamp
  }
}
```

---

### 2. Price Update Events

Subscribe to asset price changes.

```graphql
subscription OnPriceUpdated($contractId: String) {
  onPriceUpdated(contractId: $contractId) {
    contractId   # Asset with updated price
    newPrice     # New price per share in stroops
    oldPrice     # Previous price per share in stroops
    timestamp    # Update timestamp
  }
}
```

**Example:**
```graphql
subscription {
  onPriceUpdated {
    contractId
    oldPrice
    newPrice
    timestamp
  }
}
```

---

### 3. Asset Listing Events

Subscribe to newly listed assets.

```graphql
subscription OnAssetListed {
  onAssetListed {
    contractId
    title
    location
    description
    assetType
    totalShares
    pricePerShare
    availableShares
    createdAt
    updatedAt
  }
}
```

**Example:**
```graphql
subscription {
  onAssetListed {
    contractId
    title
    location
    assetType
    pricePerShare
  }
}
```

---

### 4. Asset Update Events

Subscribe to modifications of existing assets.

```graphql
subscription OnAssetUpdated($contractId: String) {
  onAssetUpdated(contractId: $contractId) {
    contractId
    title
    location
    description
    assetType
    totalShares
    pricePerShare
    availableShares
    updatedAt
  }
}
```

---

### 5. Availability Change Events

Subscribe to inventory changes.

```graphql
subscription OnAvailabilityChanged($contractId: String) {
  onAvailabilityChanged(contractId: $contractId) {
    contractId            # Asset with changed availability
    availableShares       # New available share count
    previousAvailable     # Previous available share count
    timestamp             # Change timestamp
  }
}
```

**Example:**
```graphql
subscription {
  onAvailabilityChanged(contractId: "C123abc...") {
    contractId
    availableShares
    previousAvailable
    timestamp
  }
}
```

---

### 6. Marketplace Pause Events

Subscribe to marketplace pause notifications.

```graphql
subscription OnMarketplacePaused {
  onMarketplacePaused {
    contractId  # Affected asset
    isPaused    # Whether paused (always true for this event)
    reason      # Optional reason for pause
    timestamp   # Pause timestamp
  }
}
```

---

### 7. Marketplace Unpause Events

Subscribe to marketplace resume notifications.

```graphql
subscription OnMarketplaceUnpaused {
  onMarketplaceUnpaused {
    contractId  # Affected asset
    isPaused    # Whether paused (always false for this event)
    reason      # Optional reason for unpause
    timestamp   # Unpause timestamp
  }
}
```

---

### 8. Transaction Completion Events

Subscribe to transaction completion notifications.

```graphql
subscription OnTransactionCompleted($contractId: String) {
  onTransactionCompleted(contractId: $contractId) {
    transactionId  # Unique transaction identifier
    contractId     # Affected asset
    type           # Transaction type (buy, sell, transfer)
    status         # Transaction status (completed, failed, pending)
    metadata       # Additional transaction data (JSON string)
    timestamp      # Completion timestamp
  }
}
```

---

## Publishing Events from Backend

### Triggering Subscriptions

When backend events occur, publish them to trigger subscriptions:

```javascript
import {
  publishSharePurchased,
  publishPriceUpdated,
  publishAssetListed,
  publishAssetUpdated,
  publishAvailabilityChanged,
  publishMarketplacePaused,
  publishMarketplaceUnpaused,
  publishTransactionCompleted,
} from './pubsub.js';

// When a share purchase happens
publishSharePurchased({
  contractId: 'C123abc...',
  buyer: 'GBUYERABC...',
  shareCount: 10,
  totalPrice: 50000000,
  remainingShares: 990,
});

// When price updates
publishPriceUpdated({
  contractId: 'C123abc...',
  newPrice: 5000,
  oldPrice: 4000,
});

// When new asset is listed
publishAssetListed({
  contractId: 'C456def...',
  title: 'Downtown Office Building',
  location: 'Manhattan, NY',
  assetType: 'commercial_real_estate',
  totalShares: 1000,
  pricePerShare: 100000,
  availableShares: 1000,
});

// When marketplace is paused
publishMarketplacePaused({
  contractId: 'C123abc...',
  reason: 'Maintenance window',
});

// When transaction completes
publishTransactionCompleted({
  transactionId: 'tx_abc123...',
  contractId: 'C123abc...',
  type: 'buy',
  status: 'completed',
  metadata: JSON.stringify({ shareCount: 10, totalPrice: 50000000 }),
});
```

---

## Advanced Usage

### Multiple Subscriptions

Combine multiple subscriptions in a single client:

```graphql
subscription MarketplaceMonitor {
  sharePurchases: onSharePurchased {
    contractId
    buyer
    shareCount
    timestamp
  }
  
  priceUpdates: onPriceUpdated {
    contractId
    newPrice
    oldPrice
    timestamp
  }
  
  assetListings: onAssetListed {
    contractId
    title
    pricePerShare
  }
}
```

### Filtering by Asset

Monitor specific assets only:

```javascript
const { data } = useSubscription(gql`
  subscription {
    onSharePurchased(contractId: "C123abc...") {
      buyer
      shareCount
      timestamp
    }
    
    onPriceUpdated(contractId: "C123abc...") {
      newPrice
      oldPrice
    }
    
    onAvailabilityChanged(contractId: "C123abc...") {
      availableShares
    }
  }
`);
```

### Real-Time Dashboard

```javascript
function MarketplaceDashboard() {
  const [events, setEvents] = useState([]);

  const { data: purchase } = useSubscription(gql`
    subscription { onSharePurchased { contractId buyer shareCount timestamp } }
  `);

  const { data: priceUpdate } = useSubscription(gql`
    subscription { onPriceUpdated { contractId newPrice timestamp } }
  `);

  const { data: listing } = useSubscription(gql`
    subscription { onAssetListed { contractId title pricePerShare } }
  `);

  useEffect(() => {
    if (purchase) {
      setEvents(prev => [
        { type: 'purchase', data: purchase.onSharePurchased },
        ...prev
      ]);
    }
  }, [purchase]);

  useEffect(() => {
    if (priceUpdate) {
      setEvents(prev => [
        { type: 'price', data: priceUpdate.onPriceUpdated },
        ...prev
      ]);
    }
  }, [priceUpdate]);

  useEffect(() => {
    if (listing) {
      setEvents(prev => [
        { type: 'listing', data: listing.onAssetListed },
        ...prev
      ]);
    }
  }, [listing]);

  return (
    <div>
      <h1>Live Marketplace Events</h1>
      <EventsFeed events={events} />
    </div>
  );
}
```

---

## Error Handling

### Connection Errors

```javascript
const client = new ApolloClient({
  link: new GraphQLWsLink({
    webSocketImpl: WebSocket,
    url: 'ws://localhost:3001/graphql/subscriptions',
    connectionParams: {
      authorization: `Bearer ${authToken}`,
    },
    shouldRetry: (errOrCloseEvent) => true,
  }),
  cache: new InMemoryCache(),
});
```

### Subscription Errors

```javascript
const { data, loading, error } = useSubscription(SUBSCRIPTION_QUERY);

if (error) {
  console.error('Subscription error:', {
    message: error.message,
    graphQLErrors: error.graphQLErrors,
    networkError: error.networkError,
  });

  return (
    <div className="error">
      <p>Failed to connect to real-time updates</p>
      <button onClick={() => window.location.reload()}>Reconnect</button>
    </div>
  );
}
```

---

## Performance Considerations

### Subscription Management

- **Limit concurrent subscriptions** per client (recommended: 3-5)
- **Unsubscribe when components unmount** to free resources
- **Filter by asset ID** when monitoring specific assets

```javascript
useEffect(() => {
  // Subscribe
  const subscription = client.subscribe({...}).subscribe(...)

  // Cleanup on unmount
  return () => subscription.unsubscribe();
}, []);
```

### Network Optimization

- **Use selective fields** - only request data you need
- **Combine related subscriptions** - use aliases
- **Implement backoff** for reconnection attempts

```graphql
subscription {
  listings: onAssetListed { contractId title }
  purchases: onSharePurchased { contractId buyer }
  # Not: requesting all fields on every event
}
```

---

## Monitoring

### Subscription Metrics

The backend tracks subscription metrics:

```javascript
import { pubsub } from './pubsub.js';

// Get subscription statistics
const stats = pubsub.getStats();
console.log(stats);
// Output:
// {
//   totalTopics: 3,
//   totalSubscribers: 5,
//   topicStats: {
//     share_purchased: { subscriberCount: 2, ... },
//     price_updated: { subscriberCount: 1, ... },
//     asset_listed: { subscriberCount: 2, ... }
//   }
// }
```

### Active Topics

```javascript
const topics = pubsub.getActiveTopics();
console.log('Active subscription topics:', topics);
```

---

## Testing Subscriptions

### Unit Tests

```javascript
import { pubsub, SUBSCRIPTION_EVENTS } from '../pubsub.js';

test('should receive share purchase events', () => {
  const callback = jest.fn();
  pubsub.subscribe(SUBSCRIPTION_EVENTS.SHARE_PURCHASED, callback);

  pubsub.publish(SUBSCRIPTION_EVENTS.SHARE_PURCHASED, {
    contractId: 'C123',
    buyer: 'BUYER',
    shareCount: 5,
  });

  expect(callback).toHaveBeenCalledWith({
    event: 'share_purchased',
    timestamp: expect.any(String),
    data: {
      contractId: 'C123',
      buyer: 'BUYER',
      shareCount: 5,
    },
  });
});
```

### Integration Tests

```javascript
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

describe('GraphQL Subscriptions', () => {
  let client;

  beforeEach(() => {
    client = createClient({
      url: 'ws://localhost:3001/graphql/subscriptions',
      webSocketImpl: WebSocket,
    });
  });

  test('receives real-time updates', (done) => {
    const data = [];

    client.subscribe(
      {
        query: `subscription { onSharePurchased { contractId buyer } }`,
      },
      {
        next: (msg) => data.push(msg.data),
        error: (err) => done(err),
        complete: () => {
          expect(data.length).toBeGreaterThan(0);
          done();
        },
      }
    );

    // Simulate event after short delay
    setTimeout(() => {
      publishSharePurchased({ contractId: 'C123', buyer: 'BUYER', shareCount: 1 });
    }, 100);
  });
});
```

---

## Troubleshooting

### Connection Issues

**Problem:** `WebSocket is closed before the message is sent`

**Solution:** Ensure WebSocket server is running and endpoint is correct:
```bash
# Check server is running
curl http://localhost:3001/health

# Verify WebSocket endpoint
ws://localhost:3001/graphql/subscriptions
```

### No Events Received

**Problem:** Subscriptions connect but no events are received

**Solution:** Verify events are being published from backend:
```javascript
import { publishSharePurchased } from './pubsub.js';

// Test publishing
publishSharePurchased({
  contractId: 'C123',
  buyer: 'TEST_BUYER',
  shareCount: 1,
  totalPrice: 10000,
  remainingShares: 999,
});
```

### Memory Leaks

**Problem:** Connection persists even after component unmounts

**Solution:** Properly clean up subscriptions:
```javascript
useEffect(() => {
  const { unsubscribe } = client.subscribe(...);
  return () => unsubscribe(); // Cleanup
}, []);
```

---

## Architecture

### Data Flow

```
Backend Event
    ↓
publishEvent() call
    ↓
pubsub.publish(topic, payload)
    ↓
GraphQL subscription resolvers notified
    ↓
Active subscriptions receive data
    ↓
Client receives update via WebSocket
```

### Subscription Lifecycle

1. **Connection** - Client connects to `/graphql/subscriptions`
2. **Subscribe** - Client sends GraphQL subscription
3. **Listen** - Server adds client to topic subscribers
4. **Event** - Backend publishes event to topic
5. **Notify** - Server sends event to all subscribers
6. **Unsubscribe** - Client disconnects or unsubscribes
7. **Cleanup** - Server removes client from subscribers

---

## Reference

### Helper Functions

```javascript
// Import helpers
import {
  publishSharePurchased,
  publishPriceUpdated,
  publishAssetListed,
  publishAssetUpdated,
  publishAvailabilityChanged,
  publishMarketplacePaused,
  publishMarketplaceUnpaused,
  publishTransactionCompleted,
  publishError,
} from './pubsub.js';
```

### Event Types

```javascript
import { SUBSCRIPTION_EVENTS } from './pubsub.js';

SUBSCRIPTION_EVENTS.SHARE_PURCHASED         // 'share_purchased'
SUBSCRIPTION_EVENTS.PRICE_UPDATED           // 'price_updated'
SUBSCRIPTION_EVENTS.ASSET_LISTED            // 'asset_listed'
SUBSCRIPTION_EVENTS.ASSET_UPDATED           // 'asset_updated'
SUBSCRIPTION_EVENTS.AVAILABILITY_CHANGED    // 'availability_changed'
SUBSCRIPTION_EVENTS.MARKETPLACE_PAUSED      // 'marketplace_paused'
SUBSCRIPTION_EVENTS.MARKETPLACE_UNPAUSED    // 'marketplace_unpaused'
SUBSCRIPTION_EVENTS.TRANSACTION_COMPLETED   // 'transaction_completed'
SUBSCRIPTION_EVENTS.ERROR_OCCURRED          // 'error_occurred'
```

---

## Advantages

✅ **Real-time Updates** - No polling needed  
✅ **Efficient** - Only send changed data  
✅ **Scalable** - Handle many concurrent connections  
✅ **Type-Safe** - GraphQL schema validation  
✅ **Developer-Friendly** - Apollo integration  
✅ **Flexible** - Filter by asset or listen to all events  

---

## Related Documentation

- [GraphQL API](./GRAPHQL_API.md)
- [WebSocket Implementation](../WEBSOCKET_IMPLEMENTATION.md)
- [Architecture Overview](./architecture.md)
- [Apollo Server Docs](https://www.apollographql.com/docs/apollo-server/)

---

## Support

For issues, questions, or contributions, please open an issue on GitHub or consult the [Troubleshooting Guide](./troubleshooting.md).
