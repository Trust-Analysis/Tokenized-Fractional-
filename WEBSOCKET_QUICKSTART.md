# WebSocket Quick Start Guide

## Installation

### Backend

```bash
cd backend
npm install  # Installs ws v8.17.0 automatically
```

No additional configuration needed.

## Running the Application

### Backend with WebSocket Support

```bash
cd backend
npm run dev
# Output: RWA Off-chain Metadata Backend started with WebSocket support
# WebSocket available at: ws://localhost:3001/ws
```

### Frontend

```bash
cd frontend
npm run dev
# Open http://localhost:5173
```

## Testing WebSocket Locally

### Using Browser DevTools

Open browser console and run:

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('Connected!');
  
  // Subscribe to share-purchases
  ws.send(JSON.stringify({
    action: 'subscribe',
    topic: 'share-purchases'
  }));
};

ws.onmessage = (event) => {
  console.log('Event:', JSON.parse(event.data));
};
```

### Using cURL to Broadcast Events

```bash
# Broadcast a share purchase
curl -X POST http://localhost:3001/api/v1/notify/share-purchased \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "buyerAddress": "GAAA1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567",
    "sharesToBuy": 10,
    "totalCost": 100000000
  }'
```

### Get WebSocket Statistics

```bash
curl http://localhost:3001/api/v1/ws/stats | jq .
```

Example output:
```json
{
  "connectedClients": 5,
  "activeTopics": 8,
  "totalSubscriptions": 12
}
```

## Integration in Components

### Basic Usage

```javascript
import { useMarketplaceWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function MyComponent() {
  const { connected } = useMarketplaceWebSocket(
    'ws://localhost:3001/ws',
    (message) => {
      console.log('Event received:', message.type, message.data);
      
      // Handle events
      switch(message.type) {
        case WS_EVENT_TYPES.SHARE_PURCHASED:
          console.log(`${message.data.sharesToBuy} shares purchased for ${message.data.totalCost}`);
          break;
        case WS_EVENT_TYPES.MARKETPLACE_PAUSED:
          alert('Marketplace is paused');
          break;
      }
    }
  );

  return <div>Status: {connected ? 'Connected' : 'Disconnected'}</div>;
}
```

### Asset-Specific Updates

```javascript
import { useAssetWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function AssetDetail({ contractId }) {
  const { connected } = useAssetWebSocket(
    'ws://localhost:3001/ws',
    contractId,
    (message) => {
      if (message.type === WS_EVENT_TYPES.PRICE_UPDATED) {
        console.log('New price:', message.data.newPrice);
        // Refresh UI
      }
    }
  );

  return <div>Asset {contractId} - {connected ? '🟢' : '🔴'}</div>;
}
```

### Broadcasting Share Purchase (After Transaction)

In your purchase handler:

```javascript
const handleTransactionConfirmed = async (contractId, buyerAddress, sharesToBuy, pricePerShare) => {
  const totalCost = sharesToBuy * pricePerShare;
  
  // Notify all WebSocket subscribers
  const response = await fetch('http://localhost:3001/api/v1/notify/share-purchased', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      buyerAddress,
      sharesToBuy,
      totalCost,
    }),
  });
  
  if (response.ok) {
    console.log('Share purchase broadcasted to all connected clients');
  }
};
```

## Available Topics

### Global Topics
- `share-purchases` - All share purchase events
- `assets` - All asset updates
- `marketplace-status` - Marketplace pause/unpause

### Asset-Specific Topics
- `asset:<contractId>` - Events for specific asset

## Event Types

All event types available:

```javascript
{
  SHARE_PURCHASED: 'share_purchased',
  PRICE_UPDATED: 'price_updated',
  ASSET_LISTED: 'asset_listed',
  ASSET_UPDATED: 'asset_updated',
  AVAILABILITY_CHANGED: 'availability_changed',
  MARKETPLACE_PAUSED: 'marketplace_paused',
  MARKETPLACE_UNPAUSED: 'marketplace_unpaused',
  CONNECTION_ESTABLISHED: 'connection_established',
  SUBSCRIPTION_CONFIRMED: 'subscription_confirmed',
  ERROR: 'error',
}
```

## Troubleshooting

### WebSocket Won't Connect

**Check backend is running:**
```bash
curl http://localhost:3001/health
```

**Check WebSocket endpoint:**
```bash
# Should return connection established message
wscat -c ws://localhost:3001/ws
```

### Not Receiving Events

1. Verify subscription:
```javascript
ws.send(JSON.stringify({
  action: 'subscribe',
  topic: 'share-purchases'
}));
```

2. Check for subscription confirmation:
```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg.type); // Should be 'subscription_confirmed'
};
```

### Connection Drops

1. Enable keep-alive pings:
```javascript
setInterval(() => {
  ws.send(JSON.stringify({ action: 'ping' }));
}, 30000);
```

2. Add reconnection logic (already in useWebSocket hook)

## Docker Deployment

The existing Dockerfile works with WebSocket support:

```bash
cd backend
docker build -t rwa-backend .
docker run -p 3001:3001 rwa-backend
# WebSocket at: ws://localhost:3001/ws
```

## Production Deployment

### Nginx Proxy Configuration

Add WebSocket support to nginx.conf:

```nginx
location /ws {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

### Environment Variables

No new environment variables needed. WebSocket uses the same port as REST API.

```bash
PORT=3001  # WebSocket will be at ws://localhost:3001/ws
```

## Performance Tips

1. **Limit subscriptions** - Only subscribe to needed topics
2. **Handle reconnection gracefully** - Use the built-in retry logic
3. **Batch updates** - Don't broadcast for every small change
4. **Use topics wisely** - Narrow down to asset-specific topics when possible

## Next Steps

1. ✅ Backend has WebSocket server running
2. ✅ Frontend has WebSocket hooks ready to use
3. ✅ Broadcasting endpoints configured
4. Start integrating WebSocket events into your components
5. Monitor WebSocket stats with `/api/v1/ws/stats`

## Documentation

- **Full API Reference**: `docs/WEBSOCKET_EVENTS.md`
- **Implementation Details**: `WEBSOCKET_IMPLEMENTATION.md`
- **Backend Code**: `backend/websocket.js`
- **Frontend Hook**: `frontend/src/hooks/useWebSocket.js`

## Support

Check test files for working examples:
- `backend/__tests__/websocket.test.js` - Unit tests
- `websocket-logic-test.js` - Logic validation tests

---

**WebSocket is ready to use! 🚀**
