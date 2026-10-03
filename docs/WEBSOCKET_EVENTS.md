# WebSocket Real-Time Updates

This document describes the WebSocket implementation for real-time updates in the RWA Marketplace.

## Overview

The RWA Marketplace uses WebSocket to provide real-time notifications of marketplace events to all connected clients. This enables users to see share purchases, price updates, asset changes, and marketplace status changes instantly without polling the API.

## Connection

### Establishing a Connection

Connect to the WebSocket server at the `/ws` endpoint:

**URL:** `ws://localhost:3001/ws` (or `wss://` for HTTPS)

**Example (JavaScript):**

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from WebSocket');
};
```

### Initial Connection Response

Upon successful connection, you'll receive:

```json
{
  "type": "connection_established",
  "clientId": "client-1719740658000-a1b2c3d4e",
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

## Subscriptions

### Subscribe to Topics

Send a subscription message to receive events for a specific topic:

```json
{
  "action": "subscribe",
  "topic": "share-purchases"
}
```

### Subscription Confirmation

After subscribing, you'll receive a confirmation:

```json
{
  "type": "subscription_confirmed",
  "topic": "share-purchases",
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

### Unsubscribe from Topics

```json
{
  "action": "unsubscribe",
  "topic": "share-purchases"
}
```

### Keep-Alive Ping

To keep the connection alive, send a ping message:

```json
{
  "action": "ping"
}
```

You'll receive a pong response:

```json
{
  "type": "pong",
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

## Topics

### `share-purchases`

Broadcasts all share purchase events across the marketplace.

**Event:**
```json
{
  "type": "share_purchased",
  "topic": "share-purchases",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "buyerAddress": "GAAA...AAA",
    "sharesToBuy": 10,
    "totalCost": 100000000
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

### `asset:<contractId>`

Broadcasts events specific to a particular asset (contract).

**Available Events:**

#### Share Purchase (Asset-Specific)
```json
{
  "type": "share_purchased",
  "topic": "asset:CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "buyerAddress": "GAAA...AAA",
    "sharesToBuy": 10,
    "totalCost": 100000000
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

#### Price Updated
```json
{
  "type": "price_updated",
  "topic": "asset:CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "newPrice": 15000000
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

#### Availability Changed
```json
{
  "type": "availability_changed",
  "topic": "asset:CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "availableShares": 50
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

#### Asset Updated
```json
{
  "type": "asset_updated",
  "topic": "asset:CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "asset": {
      "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
      "title": "Commercial Real Estate",
      "location": "New York, NY",
      "description": "Premium office building...",
      "assetType": "commercial_real_estate"
    }
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

### `marketplace-status`

Broadcasts marketplace pause/unpause events.

**Events:**

#### Marketplace Paused
```json
{
  "type": "marketplace_paused",
  "topic": "marketplace-status",
  "data": {
    "isPaused": true
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

#### Marketplace Unpaused
```json
{
  "type": "marketplace_unpaused",
  "topic": "marketplace-status",
  "data": {
    "isPaused": false
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

### `assets`

Broadcasts asset-level events across all assets.

**Events:**
- `asset_updated` - when any asset is updated

```json
{
  "type": "asset_updated",
  "topic": "assets",
  "data": {
    "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
    "asset": { /* asset object */ }
  },
  "timestamp": "2026-06-30T08:24:32.774Z"
}
```

## Broadcasting Events

### Backend API Endpoints

To broadcast events to connected WebSocket clients, use the following REST API endpoints:

#### Broadcast Share Purchase

```http
POST /api/v1/notify/share-purchased
Content-Type: application/json

{
  "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "buyerAddress": "GAAA...AAA",
  "sharesToBuy": 10,
  "totalCost": 100000000
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Event broadcasted"
}
```

#### Broadcast Price Update

```http
POST /api/v1/notify/price-updated
Content-Type: application/json
x-api-key: <admin-api-key>

{
  "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "newPrice": 15000000
}
```

#### Broadcast Availability Change

```http
POST /api/v1/notify/availability-changed
Content-Type: application/json
x-api-key: <admin-api-key>

{
  "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "availableShares": 50
}
```

#### Broadcast Asset Update

```http
POST /api/v1/notify/asset-updated
Content-Type: application/json
x-api-key: <admin-api-key>

{
  "contractId": "CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG",
  "asset": { /* asset metadata object */ }
}
```

#### Broadcast Marketplace Status

```http
POST /api/v1/notify/marketplace-status
Content-Type: application/json
x-api-key: <admin-api-key>

{
  "isPaused": true
}
```

#### Get WebSocket Statistics

```http
GET /api/v1/ws/stats
```

**Response:**
```json
{
  "connectedClients": 42,
  "activeTopics": 15,
  "totalSubscriptions": 67
}
```

## React Hook Usage

The frontend provides a `useWebSocket` hook for easy integration:

### `useWebSocket` Hook

```javascript
import { useWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function MyComponent() {
  const { connected, clientId, subscribe, unsubscribe } = useWebSocket(
    'ws://localhost:3001/ws',
    {
      onEvent: (message) => {
        console.log('Event received:', message);
      },
      enabled: true,
      reconnectAttempts: 5,
      reconnectDelay: 3000,
    }
  );

  useEffect(() => {
    if (connected) {
      subscribe('share-purchases');
    }
  }, [connected, subscribe]);

  return <div>Connected: {connected ? 'Yes' : 'No'}</div>;
}
```

### `useMarketplaceWebSocket` Hook

Higher-level hook that automatically subscribes to marketplace topics:

```javascript
import { useMarketplaceWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function Marketplace() {
  const { connected } = useMarketplaceWebSocket(
    'ws://localhost:3001/ws',
    (message) => {
      switch (message.type) {
        case WS_EVENT_TYPES.SHARE_PURCHASED:
          console.log('Share purchased:', message.data);
          break;
        case WS_EVENT_TYPES.MARKETPLACE_PAUSED:
          console.log('Marketplace paused');
          break;
      }
    }
  );

  return <div>Marketplace Connected: {connected ? 'Yes' : 'No'}</div>;
}
```

### `useAssetWebSocket` Hook

Hook for asset-specific updates:

```javascript
import { useAssetWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function AssetDetail({ contractId }) {
  const { connected } = useAssetWebSocket(
    'ws://localhost:3001/ws',
    contractId,
    (message) => {
      switch (message.type) {
        case WS_EVENT_TYPES.PRICE_UPDATED:
          console.log('Price updated:', message.data.newPrice);
          break;
        case WS_EVENT_TYPES.AVAILABILITY_CHANGED:
          console.log('Availability:', message.data.availableShares);
          break;
      }
    }
  );

  return <div>Asset {contractId} Connected: {connected ? 'Yes' : 'No'}</div>;
}
```

## Error Handling

### Connection Errors

```javascript
const { connected } = useWebSocket(wsUrl, {
  onError: (error) => {
    console.error('WebSocket error:', error);
    // Handle error - show notification, retry, etc.
  },
});
```

### Invalid Messages

Invalid JSON or malformed messages are logged but don't disconnect the client.

### Disconnection and Reconnection

The hook automatically attempts to reconnect with exponential backoff:
- Default: 5 reconnection attempts
- Default delay: 3000ms between attempts

## Performance Considerations

- **Connection Pooling:** Each client maintains a single WebSocket connection
- **Message Compression:** Large events are sent as JSON strings over WebSocket
- **Keep-Alive:** Clients should send a ping every 30 seconds to maintain the connection
- **Memory:** Subscription sets are cleaned up when clients disconnect

## Security

- **No Authentication Required:** WebSocket endpoint is publicly accessible
- **API Key Required:** Broadcasting endpoints require `x-api-key` header (except share-purchased)
- **Input Validation:** All incoming messages are validated
- **Rate Limiting:** Use the same rate limiters as REST API for broadcast endpoints

## Troubleshooting

### Connection Won't Establish

1. Check that the backend is running on the correct host/port
2. Verify WebSocket proxy configuration (if behind a proxy)
3. Check browser console for connection errors
4. Ensure the URL is `ws://` or `wss://` (not `http://`)

### Not Receiving Events

1. Verify you're subscribed to the correct topic
2. Check that the event is being broadcast from the backend
3. Verify the message handler is correctly processing the event

### Connection Drops Frequently

1. Check server logs for errors
2. Verify network stability
3. Increase `reconnectAttempts` and `reconnectDelay` options
4. Ensure client is sending ping messages

## Future Enhancements

- Message filtering on the server side
- Subscription pattern matching (e.g., `asset:*`)
- Message queuing for offline clients
- Compression for large payloads
- Binary message support for better performance
