# WebSocket Automatic Reconnection Implementation

## Summary

The `useWebSocket` hook in `frontend/src/hooks/useWebSocket.js` has been enhanced with automatic reconnection using exponential backoff with jitter. This ensures users maintain real-time updates for share purchases, price changes, and other marketplace events even during network interruptions or server restarts.

## What Changed

### Enhanced Features

✅ **Exponential Backoff**: Reconnection delays grow exponentially (1s → 1.5s → 2.25s → ... → 30s max)  
✅ **Jitter**: ±10% random variance prevents thundering herd  
✅ **Subscription Restoration**: Automatically resubscribes to all topics after reconnection  
✅ **Connection State**: Tracks `connected`, `reconnecting`, and `connectionAttempts`  
✅ **Graceful Degradation**: Manual disconnect stops reconnection attempts  
✅ **Keep-Alive Pings**: Detects dead connections every 30 seconds  
✅ **Detailed Logging**: Console logs prefixed with `[WebSocket]` for debugging  
✅ **Callbacks**: `onReconnect` callback provides reconnection details  

### Before vs After

**Before** (Fixed 3-second delay):
```javascript
// Would retry every 3 seconds indefinitely
// No topic restoration
// Silent failures

const { connected } = useWebSocket(wsUrl, {
  reconnectAttempts: 5,
  reconnectDelay: 3000,  // Fixed 3s
});
```

**After** (Exponential backoff):
```javascript
// Retries with growing delays: 1s, 1.5s, 2.25s, 3.4s, 5.1s, ...
// Automatically restores subscriptions
// Detailed state and callbacks

const { connected, reconnecting, connectionAttempts } = useWebSocket(wsUrl, {
  reconnectAttempts: Infinity,     // Try forever
  initialDelay: 1000,              // 1s
  maxDelay: 30000,                 // Cap at 30s
  backoffMultiplier: 1.5,
  onReconnect: ({ attempt, delay }) => {
    console.log(`Reconnecting in ${delay}ms (attempt ${attempt})`);
  },
});
```

## Key Algorithms

### Exponential Backoff Calculation

```javascript
// Formula with jitter
const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attemptNumber - 1);
const cappedDelay = Math.min(exponentialDelay, maxDelay);
const jitter = cappedDelay * 0.1 * (Math.random() - 0.5) * 2;  // ±10%
return Math.max(0, Math.round(cappedDelay + jitter));
```

**Example delays (1000ms initial, 1.5x multiplier, 30000ms max):**
- Attempt 1: ~1,000ms (1s)
- Attempt 2: ~1,500ms (1.5s)
- Attempt 3: ~2,250ms (2.25s)
- Attempt 4: ~3,375ms (3.4s)
- Attempt 5: ~5,062ms (5.1s)
- Attempt 6: ~7,593ms (7.6s)
- Attempt 7: ~11,390ms (11.4s)
- Attempt 8: ~17,085ms (17.1s)
- Attempt 9: ~25,628ms (25.6s)
- Attempt 10+: ~30,000ms (30s, capped)

### Subscription Restoration

After successful reconnection:
1. Connection established → `onopen` fired
2. Iterate over all active subscriptions in `Set`
3. Send subscribe message for each topic
4. Handle errors gracefully
5. Restore client state

```javascript
resubscribeToTopics() {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
    return;
  }
  subscriptionsRef.current.forEach((topic) => {
    // Send subscribe for each topic
  });
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Whether to connect |
| `reconnectAttempts` | number | Infinity | Max reconnection attempts |
| `initialDelay` | number | 1000 | First reconnection delay (ms) |
| `maxDelay` | number | 30000 | Maximum reconnection delay cap (ms) |
| `backoffMultiplier` | number | 1.5 | Exponential growth factor |
| `enablePing` | boolean | true | Enable keep-alive pings |
| `pingInterval` | number | 30000 | Ping interval (ms) |
| `onEvent` | function | - | Callback for all messages |
| `onError` | function | - | Callback for errors |
| `onReconnect` | function | - | Callback for reconnection attempts |

## Returned State

```javascript
{
  connected: boolean,           // True if WebSocket is open
  reconnecting: boolean,        // True if attempting to reconnect
  connectionAttempts: number,   // Current attempt number
  clientId: string,             // Server-assigned ID
  subscribe: (topic) => boolean,
  unsubscribe: (topic) => void,
  ping: () => void,
  disconnect: () => void,       // Manual disconnect (stops reconnection)
}
```

## Usage Example

```javascript
import { useMarketplaceWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function Marketplace() {
  const { connected, reconnecting, connectionAttempts } = useMarketplaceWebSocket(
    'ws://localhost:3001/ws',
    (message) => {
      if (message.type === WS_EVENT_TYPES.SHARE_PURCHASED) {
        // Handle share purchase
        handleSharePurchased(message.data);
      }
    },
    {
      onError: (error) => {
        console.error('WebSocket error:', error);
        showErrorToast('Connection error');
      },
      onReconnect: ({ attempt, delay }) => {
        console.log(`Reconnecting in ${delay}ms (attempt ${attempt})`);
      },
    }
  );

  return (
    <div>
      {!connected && (
        <Alert>
          {reconnecting
            ? `Reconnecting (attempt ${connectionAttempts})...`
            : 'Offline'}
        </Alert>
      )}
      {/* Marketplace content */}
    </div>
  );
}
```

## Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    INITIAL CONNECTION                            │
├─────────────────────────────────────────────────────────────────┤
│ 1. Component mounts                                              │
│ 2. connect() called                                              │
│ 3. new WebSocket(wsUrl) created                                 │
│ 4. onopen handler:                                               │
│    ├─ connected = true                                           │
│    ├─ reconnectCount = 0                                         │
│    └─ Restore subscriptions                                      │
│ 5. Ready for operation                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    NORMAL OPERATION                              │
├─────────────────────────────────────────────────────────────────┤
│ • Receive messages via onmessage                                │
│ • Ping every 30 seconds (keep-alive)                            │
│ • Subscribe/unsubscribe as needed                               │
│ • No reconnection attempts                                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  CONNECTION DROPS                                │
├─────────────────────────────────────────────────────────────────┤
│ Trigger: Network error, server restart, etc.                    │
│ onclose handler:                                                │
│ ├─ connected = false                                             │
│ ├─ Check if manual disconnect                                    │
│ └─ If NOT manual: proceed to AUTOMATIC RECONNECTION             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│            AUTOMATIC RECONNECTION (Exponential Backoff)          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Calculate backoff delay: f(attempt) = min(init * mult^n, max)│
│    + jitter (±10%)                                               │
│ 2. Increment reconnectCount                                      │
│ 3. Set reconnecting = true                                       │
│ 4. Emit onReconnect callback                                     │
│ 5. setTimeout(connect, delay)                                    │
│ 6. When timer fires:                                             │
│    ├─ Back to INITIAL CONNECTION                                │
│    └─ If successful: restore subscriptions                       │
│ 7. If fails again: repeat steps 1-5                              │
│ 8. After max attempts: stop reconnection                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  MANUAL DISCONNECT                               │
├─────────────────────────────────────────────────────────────────┤
│ 1. User/component calls disconnect()                             │
│ 2. Set manualDisconnect flag = true                              │
│ 3. Cancel any pending reconnect timers                           │
│ 4. Close WebSocket                                               │
│ 5. Clear subscriptions                                           │
│ 6. Set connected = false, reconnecting = false                   │
│ 7. Stop all reconnection attempts                                │
└─────────────────────────────────────────────────────────────────┘
```

## Files Modified

✏️ `frontend/src/hooks/useWebSocket.js` (Enhanced implementation)
- Added exponential backoff calculation
- Added subscription restoration
- Added connection state tracking
- Added detailed callbacks and logging
- Added keep-alive ping improvements

## Files Created

📄 `frontend/WEBSOCKET_RECONNECTION_GUIDE.md` (586 lines)
- Complete reference guide
- Configuration options
- Usage examples
- Performance considerations
- Troubleshooting guide

📄 `frontend/WEBSOCKET_EXAMPLES.md` (657 lines)
- 7 practical example components
- Connection monitoring
- Fallback strategies
- Health tracking
- Testing patterns
- CSS styling

## Build Status

✅ Build Successful
```
✓ 1877 modules transformed
✓ built in 15.56s
✓ 104 modules transformed
✓ built in 401ms
```

## Testing Recommendations

### Manual Testing

1. **Normal Operation**
   - Start marketplace
   - Verify real-time events received
   - Check no reconnection logs

2. **Network Interrupt**
   - Toggle network offline in DevTools
   - Verify reconnection attempts start
   - Check exponential backoff in console
   - Toggle network online
   - Verify automatic reconnection success

3. **Server Restart**
   - Stop backend server
   - Verify reconnection attempts
   - Start backend server
   - Verify automatic reconnection
   - Verify subscriptions restored

4. **Connection Monitoring**
   - Check `[WebSocket]` console logs
   - Verify delays follow exponential backoff
   - Monitor `connectionAttempts` counter
   - Verify reconnection eventually succeeds

### Automated Testing

```javascript
// Test exponential backoff
// Test subscription restoration
// Test manual disconnect
// Test keep-alive pings
// Test jitter variance
```

## Performance Impact

- **Memory**: 
  - Subscriptions: O(n) where n = number of topics
  - Refs & timers: O(1)
  - State: O(1)

- **CPU**:
  - Backoff calculation: O(1)
  - Message parsing: O(m) where m = message size

- **Network**:
  - Keeps connection alive: 1 ping per 30 seconds
  - Backoff reduces server load during outages

## Browser Compatibility

✅ All modern browsers with WebSocket support:
- Chrome 43+
- Firefox 49+
- Safari 10.1+
- Edge 15+

## Debugging

Enable detailed logging by checking DevTools console for `[WebSocket]` prefix:

```javascript
// Connection established
[WebSocket] Connecting to ws://localhost:3001/ws...
[WebSocket] Connected: ws://localhost:3001/ws
[WebSocket] Client ID: 550e8400-e29b-41d4-a716-446655440000

// Reconnection attempts
[WebSocket] Disconnected
[WebSocket] Reconnecting in 1500ms (attempt 2/∞)
[WebSocket] Reconnecting in 2250ms (attempt 3/∞)

// Errors
[WebSocket] Error: Network error
[WebSocket] Failed to resubscribe to topic: asset:123
```

## Rollback (if needed)

To revert to previous implementation:
```bash
git checkout HEAD~1 frontend/src/hooks/useWebSocket.js
```

## Next Steps

1. **Test in development**
   - Verify reconnection works
   - Check console logs
   - Monitor network tab

2. **Deploy to staging**
   - Full integration test
   - Network condition testing
   - Load testing with many connections

3. **Deploy to production**
   - Monitor error rates
   - Check WebSocket connection success rate
   - Monitor reconnection attempts
   - Verify real-time updates working

4. **Monitor metrics**
   - Connection success rate
   - Average reconnection time
   - Reconnection frequency
   - Event delivery latency

## References

- WebSocket MDN: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Exponential Backoff: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Current Implementation: `frontend/src/hooks/useWebSocket.js`
- Detailed Guide: `frontend/WEBSOCKET_RECONNECTION_GUIDE.md`
- Examples: `frontend/WEBSOCKET_EXAMPLES.md`

## Support

For questions about the implementation, refer to:
1. `WEBSOCKET_RECONNECTION_GUIDE.md` - Complete reference
2. `WEBSOCKET_EXAMPLES.md` - Practical examples
3. Console logs with `[WebSocket]` prefix - Debug info

