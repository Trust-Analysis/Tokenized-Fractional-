# WebSocket Automatic Reconnection with Exponential Backoff

## Overview

The `useWebSocket` hook in `frontend/src/hooks/useWebSocket.js` has been enhanced with automatic reconnection logic featuring exponential backoff, connection state tracking, and subscription restoration. This ensures users maintain real-time updates for share purchases, price changes, and other marketplace events even during network interruptions.

## Key Features

### ✅ Automatic Reconnection
- Automatically attempts to reconnect when the WebSocket connection drops
- Exponential backoff prevents server overload during extended outages
- Optional jitter (±10%) prevents thundering herd problem
- Unlimited reconnection attempts by default (configurable)

### ✅ Exponential Backoff Algorithm
```
delay = min(initialDelay * (multiplier ^ attempt), maxDelay) + jitter
```

**Default Configuration**:
- Initial delay: 1,000ms
- Max delay: 30,000ms (30 seconds)
- Multiplier: 1.5x per attempt
- Jitter: ±10% random variance

**Example Sequence**:
```
Attempt 1: 1,000ms (1s)
Attempt 2: 1,500ms (1.5s)
Attempt 3: 2,250ms (2.25s)
Attempt 4: 3,375ms (3.375s)
...
Attempt 10: ~30,000ms (caps at 30s)
Attempt 11+: ~30,000ms (stays capped)
```

### ✅ Subscription Restoration
- Automatically resubscribes to all topics after reconnection
- Maintains list of active subscriptions
- Handles subscription errors gracefully
- Prevents duplicate subscriptions

### ✅ Connection State Tracking
- `connected`: Boolean indicating if WebSocket is open
- `reconnecting`: Boolean indicating if attempting to reconnect
- `connectionAttempts`: Number of current reconnection attempt
- `clientId`: Server-assigned client identifier

### ✅ Keep-Alive Pings
- Sends ping messages every 30 seconds (configurable)
- Detects dead connections
- Prevents proxies/firewalls from closing idle connections

### ✅ Manual Disconnect
- `disconnect()` method stops automatic reconnection
- Sets flag to prevent further reconnection attempts
- Clears all subscriptions and timers
- Can be called to gracefully stop WebSocket

## Configuration Options

```javascript
const options = {
  // Enable/disable WebSocket connection
  enabled: true,
  
  // Maximum reconnection attempts (default: Infinity for unlimited)
  reconnectAttempts: Infinity,
  
  // Initial reconnection delay in milliseconds
  initialDelay: 1000,
  
  // Maximum reconnection delay cap
  maxDelay: 30000,
  
  // Exponential backoff multiplier
  backoffMultiplier: 1.5,
  
  // Enable keep-alive pings
  enablePing: true,
  
  // Keep-alive ping interval
  pingInterval: 30000,
  
  // Callbacks
  onEvent: (message) => {},           // All incoming messages
  onError: (error) => {},             // Connection errors
  onReconnect: (reconnectInfo) => {}, // Reconnection attempts
};

const ws = useWebSocket('ws://localhost:3001/ws', options);
```

## Usage Examples

### Basic Usage with Error Handling

```javascript
function MarketplaceComponent() {
  const { connected, reconnecting, connectionAttempts } = useWebSocket(
    'ws://localhost:3001/ws',
    {
      onEvent: (message) => {
        // Handle incoming events
        console.log('Event:', message.type);
      },
      onError: (error) => {
        // Handle errors
        console.error('WebSocket error:', error);
      },
      onReconnect: ({ attempt, delay, nextDelay }) => {
        console.log(`Reconnecting (attempt ${attempt}, delay: ${delay}ms)`);
      },
    }
  );

  return (
    <div>
      <Status connected={connected} />
      {reconnecting && <ReconnectingIndicator attempt={connectionAttempts} />}
    </div>
  );
}
```

### Custom Backoff Configuration

```javascript
// More aggressive reconnection for critical apps
const ws = useWebSocket('ws://localhost:3001/ws', {
  initialDelay: 500,        // Start at 500ms
  maxDelay: 10000,          // Cap at 10s (faster than default)
  backoffMultiplier: 2.0,   // Double each time
  reconnectAttempts: 20,    // Limit to 20 attempts
});

// Gentle reconnection for non-critical features
const ws = useWebSocket('ws://localhost:3001/ws', {
  initialDelay: 5000,       // Start at 5s
  maxDelay: 60000,          // Cap at 60s
  backoffMultiplier: 1.2,   // Slow growth
  reconnectAttempts: 10,    // Give up after 10 attempts
});
```

### Asset-Specific Subscriptions with Reconnection

```javascript
function AssetPriceUpdater({ contractId }) {
  const { connected } = useAssetWebSocket(
    'ws://localhost:3001/ws',
    contractId,
    (message) => {
      if (message.type === WS_EVENT_TYPES.PRICE_UPDATED) {
        // Update price display
        updateAssetPrice(message.data);
      }
    }
  );

  return (
    <div>
      <Price data={priceData} />
      {!connected && <OfflineIndicator />}
    </div>
  );
}
```

### Marketplace-Wide Updates with Connection Monitoring

```javascript
function MarketplaceHub() {
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const { connected, reconnecting, connectionAttempts } = useMarketplaceWebSocket(
    'ws://localhost:3001/ws',
    (message) => {
      switch (message.type) {
        case WS_EVENT_TYPES.SHARE_PURCHASED:
          handleSharePurchased(message.data);
          break;
        case WS_EVENT_TYPES.PRICE_UPDATED:
          handlePriceUpdate(message.data);
          break;
        // ... handle other event types
      }
    },
    {
      onReconnect: ({ attempt, delay }) => {
        console.log(`Reconnection attempt ${attempt} in ${delay}ms`);
        // Update UI to show reconnection in progress
      },
    }
  );

  useEffect(() => {
    if (connected) {
      setConnectionStatus('connected');
    } else if (reconnecting) {
      setConnectionStatus(`reconnecting (attempt ${connectionAttempts})`);
    } else {
      setConnectionStatus('disconnected');
    }
  }, [connected, reconnecting, connectionAttempts]);

  return (
    <div>
      <ConnectionStatus status={connectionStatus} />
      {/* Marketplace components */}
    </div>
  );
}
```

## Connection Lifecycle

```
1. INITIAL CONNECTION
   ├─ Component mounts
   ├─ connect() called
   ├─ WebSocket established
   └─ onopen fired
       ├─ Set connected=true
       ├─ Reset reconnectCount to 0
       ├─ Restore subscriptions
       └─ Emit onEvent for CONNECTION_ESTABLISHED

2. NORMAL OPERATION
   ├─ Receive messages
   ├─ Ping every 30s
   └─ Subscribe/unsubscribe as needed

3. CONNECTION DROPS
   ├─ Network interruption, server restart, etc.
   ├─ onclose fired
   ├─ Set connected=false
   └─ Check if manual disconnect

4. AUTOMATIC RECONNECTION
   ├─ If NOT manual disconnect:
   │  ├─ Increment reconnectCount
   │  ├─ Calculate backoff delay
   │  ├─ Set reconnecting=true
   │  ├─ Emit onReconnect callback
   │  └─ Schedule setTimeout for connect()
   ├─ Repeat steps 1-3 until success
   └─ On success:
      ├─ Reset reconnectCount
      ├─ Set reconnecting=false
      └─ Restore all subscriptions

5. MANUAL DISCONNECT
   ├─ User calls disconnect()
   ├─ Set manualDisconnect flag
   ├─ Close WebSocket
   ├─ Clear subscriptions
   └─ Stop reconnection attempts
```

## State Management

### Connection States

| State | Meaning | Action |
|-------|---------|--------|
| `connected=true, reconnecting=false` | ✅ Connected and stable | Send messages, subscribe |
| `connected=false, reconnecting=true` | 🔄 Attempting to reconnect | Wait and show indicator |
| `connected=false, reconnecting=false` | ❌ Disconnected (manual) | Reconnect manually if needed |
| `connected=false, reconnecting=false` | ❌ Max attempts exceeded | Show error to user |

### Subscription Tracking

- Subscriptions stored in `Set<string>` for O(1) lookup
- Automatically restored after reconnection
- Cleared on manual disconnect
- Errors during resubscription logged but don't block connection

## Monitoring & Debugging

### Console Logging

The hook includes detailed console logs prefixed with `[WebSocket]`:

```
[WebSocket] Connecting to ws://localhost:3001/ws...
[WebSocket] Connected: ws://localhost:3001/ws
[WebSocket] Client ID: 550e8400-e29b-41d4-a716-446655440000
[WebSocket] Disconnected
[WebSocket] Reconnecting in 1500ms (attempt 2/∞)
[WebSocket] Failed to subscribe to topic: asset:xyz
[WebSocket] Manual disconnect
```

### Tracking Reconnection Attempts

```javascript
const { connectionAttempts } = useWebSocket('ws://localhost:3001/ws', {
  onReconnect: ({ attempt, delay, nextDelay }) => {
    // Log to analytics
    analytics.track('websocket_reconnection_attempt', {
      attempt,
      delay,
      nextDelay,
      timestamp: new Date().toISOString(),
    });
  },
});
```

### Connection Quality Monitoring

```javascript
function ConnectionMonitor() {
  const [metrics, setMetrics] = useState({
    totalAttempts: 0,
    lastReconnect: null,
    currentDelay: 0,
  });

  const { reconnecting, connectionAttempts } = useWebSocket(
    'ws://localhost:3001/ws',
    {
      onReconnect: ({ attempt, delay }) => {
        setMetrics({
          totalAttempts: attempt,
          lastReconnect: new Date(),
          currentDelay: delay,
        });
      },
    }
  );

  return <MetricsDisplay metrics={metrics} />;
}
```

## Best Practices

### ✅ DO

1. **Always provide error handlers**
   ```javascript
   onError: (error) => {
     logger.error('WebSocket error:', error);
     // Update UI to reflect error state
   }
   ```

2. **Monitor reconnection attempts**
   ```javascript
   onReconnect: (info) => {
     console.log(`Attempt ${info.attempt} with ${info.delay}ms delay`);
   }
   ```

3. **Handle connection state in UI**
   ```javascript
   {!connected && <OfflineIndicator />}
   {reconnecting && <ReconnectingSpinner attempt={connectionAttempts} />}
   ```

4. **Unsubscribe when no longer needed**
   ```javascript
   useEffect(() => {
     if (connected) {
       subscribe('topic');
       return () => unsubscribe('topic');
     }
   }, [connected, subscribe, unsubscribe]);
   ```

5. **Use custom backoff for different scenarios**
   ```javascript
   // Critical features: faster reconnection
   // Non-critical features: slower reconnection
   ```

### ❌ DON'T

1. **Don't manually reconnect if already reconnecting**
   - Hook handles this automatically

2. **Don't create multiple hooks for same URL**
   - Reuse connection with multiple subscribers instead

3. **Don't assume connected state persists**
   - Always check `connected` flag before operations

4. **Don't ignore connection errors**
   - Log and handle errors appropriately

5. **Don't hardcode delays**
   - Use configuration options for flexibility

## Performance Considerations

### Memory Usage
- Subscriptions stored in Set: O(n) where n = number of topics
- Timers: 2 (reconnect timeout, ping timeout) - O(1)
- State: 4 state variables - O(1)

### CPU Usage
- Exponential calculation: O(1) with jitter
- Parsing JSON messages: O(m) where m = message size
- Subscription lookup: O(1) average case

### Network Impact
- Keep-alive pings: 1 message per 30 seconds
- Reconnection backoff reduces server load during outages
- Subscription restoration: n messages on reconnect

## Troubleshooting

### Issue: Continuous Reconnection Loop

**Symptoms**: Rapidly reconnecting without success

**Causes**:
- Server is down or unreachable
- Invalid WebSocket URL
- CORS/firewall blocking

**Solution**:
```javascript
onError: (error) => {
  if (error.code === 'NETWORK_ERROR') {
    // Check server status
    // Verify URL is correct
  }
}
```

### Issue: Subscriptions Not Restored

**Symptoms**: Events not received after reconnection

**Causes**:
- Subscribe called before connected
- Subscription failed silently
- Topic name mismatch

**Solution**:
```javascript
// Only subscribe when connected
useEffect(() => {
  if (connected) {
    subscribe('topic');
  }
}, [connected, subscribe]);
```

### Issue: Memory Leak Warning

**Symptoms**: React warning about cleanup in useEffect

**Causes**:
- Missing return cleanup function
- Timers not cleared

**Solution**: Hook already handles this, but ensure you're not creating multiple instances.

### Issue: Ping Timeouts

**Symptoms**: Connection drops despite no network issues

**Causes**:
- Server not responding to pings
- Firewall closing idle connections
- Proxy issues

**Solution**:
```javascript
// Adjust ping interval
enablePing: true,
pingInterval: 15000,  // Ping every 15s instead of 30s
```

## Migration Guide

### From Old Implementation

**Before** (fixed delay):
```javascript
const { connected } = useWebSocket(wsUrl, {
  reconnectAttempts: 5,
  reconnectDelay: 3000,  // Fixed 3s delay
});
```

**After** (exponential backoff):
```javascript
const { connected, reconnecting, connectionAttempts } = useWebSocket(wsUrl, {
  reconnectAttempts: Infinity,     // Try forever
  initialDelay: 1000,              // Start at 1s
  maxDelay: 30000,                 // Cap at 30s
  backoffMultiplier: 1.5,          // 1.5x each time
  onReconnect: ({ attempt, delay }) => {
    console.log(`Reconnecting in ${delay}ms`);
  },
});
```

### Handling New State

**New state variables**:
- `reconnecting`: Show loading indicator
- `connectionAttempts`: Display attempt count

```javascript
// Show connection status
return (
  <div>
    {connected && <span>✅ Connected</span>}
    {reconnecting && <span>🔄 Reconnecting ({connectionAttempts})</span>}
    {!connected && !reconnecting && <span>❌ Disconnected</span>}
  </div>
);
```

## Testing

### Unit Tests

```javascript
describe('useWebSocket', () => {
  it('should reconnect with exponential backoff', async () => {
    // Test delays: 1s, 1.5s, 2.25s, etc.
  });

  it('should restore subscriptions after reconnection', async () => {
    // Test subscription restoration
  });

  it('should respect maxDelay cap', () => {
    // Verify delay never exceeds maxDelay
  });

  it('should add jitter to prevent thundering herd', () => {
    // Verify jitter is ±10%
  });
});
```

### Integration Tests

```javascript
describe('WebSocket reconnection', () => {
  it('should handle network interruption', async () => {
    // Simulate network drop
    // Verify reconnection attempts
    // Verify subscription restoration
  });

  it('should stop reconnecting on manual disconnect', () => {
    // Call disconnect()
    // Verify no further reconnection attempts
  });
});
```

## FAQ

**Q: What if the server never comes back?**
A: Reconnection continues indefinitely by default. Set `reconnectAttempts` to limit attempts, then show error to user.

**Q: Will reconnection work across network changes (WiFi to mobile)?**
A: Yes, the browser's WebSocket API handles network transitions, and the hook will attempt reconnection.

**Q: How do I know when reconnection gives up?**
A: Check `connectionAttempts` against `reconnectAttempts` option, or listen for final connection failure in `onError`.

**Q: Can I increase reconnection speed?**
A: Yes, reduce `initialDelay`, increase `backoffMultiplier`, or lower `maxDelay`.

**Q: What if I want different backoff for different features?**
A: Create separate hook instances with different options.

**Q: How do I test reconnection?**
A: Use browser DevTools to simulate offline/online events, or mock WebSocket for unit tests.

## Version History

- **v2.0** (Current): Exponential backoff, subscription restoration, improved state tracking
- **v1.0**: Basic reconnection with fixed delay

