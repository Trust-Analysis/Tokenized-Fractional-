# WebSocket Reconnection - Practical Examples

## Example 1: Connection Status Display

A component that shows real-time connection status with reconnection indicator.

```javascript
import React from 'react';
import { useWebSocket, WS_EVENT_TYPES } from '../hooks/useWebSocket';
import styles from './ConnectionStatus.module.css';

export function ConnectionStatus() {
  const { connected, reconnecting, connectionAttempts } = useWebSocket(
    import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws',
    {
      onError: (error) => {
        console.error('WebSocket connection error:', error);
      },
      onReconnect: ({ attempt, delay, nextDelay }) => {
        console.log(
          `Reconnection attempt ${attempt}: waiting ${delay}ms (next: ${nextDelay}ms)`
        );
      },
    }
  );

  if (connected) {
    return (
      <div className={styles.container}>
        <span className={styles.indicator}>●</span>
        <span className={styles.text}>Connected</span>
      </div>
    );
  }

  if (reconnecting) {
    return (
      <div className={styles.container}>
        <span className={styles.indicator + ' ' + styles.reconnecting}>◐</span>
        <span className={styles.text}>
          Reconnecting... (attempt {connectionAttempts})
        </span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <span className={styles.indicator + ' ' + styles.error}>●</span>
      <span className={styles.text}>Disconnected</span>
    </div>
  );
}
```

## Example 2: Real-Time Price Updates

Monitor price changes with automatic recovery.

```javascript
import React, { useState, useEffect } from 'react';
import { useAssetWebSocket, WS_EVENT_TYPES } from '../hooks/useWebSocket';

export function AssetPriceMonitor({ contractId }) {
  const [price, setPrice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  const { connected } = useAssetWebSocket(
    import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws',
    contractId,
    (message) => {
      try {
        if (message.type === WS_EVENT_TYPES.PRICE_UPDATED) {
          setPrice(message.data.price);
          setLastUpdate(new Date());
          setUpdateError(null);
        }
      } catch (error) {
        console.error('Error processing price update:', error);
        setUpdateError('Failed to update price');
      }
    },
    {
      enabled: !!contractId,
    }
  );

  return (
    <div>
      <div className="price-display">
        <span className="label">Current Price:</span>
        <span className="value">${price?.toFixed(2) || 'Loading...'}</span>
        {!connected && <span className="badge">Offline</span>}
      </div>
      <div className="meta">
        {lastUpdate && (
          <span>Last updated: {lastUpdate.toLocaleTimeString()}</span>
        )}
        {updateError && <span className="error">{updateError}</span>}
      </div>
    </div>
  );
}
```

## Example 3: Share Purchase Feed with Notifications

Display real-time share purchases with connection recovery.

```javascript
import React, { useState, useCallback } from 'react';
import { useMarketplaceWebSocket, WS_EVENT_TYPES } from '../hooks/useWebSocket';

export function SharePurchaseFeed() {
  const [purchases, setPurchases] = useState([]);
  const [connectionError, setConnectionError] = useState(null);
  const [stats, setStats] = useState({ attempts: 0, lastReconnect: null });

  const handleSharePurchased = useCallback((data) => {
    setPurchases((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        ...data,
        timestamp: new Date(),
      },
      ...prev.slice(0, 99), // Keep last 100
    ]);
  }, []);

  const { connected, reconnecting } = useMarketplaceWebSocket(
    import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws',
    (message) => {
      if (message.type === WS_EVENT_TYPES.SHARE_PURCHASED) {
        handleSharePurchased(message.data);
      }
    },
    {
      onError: (error) => {
        setConnectionError(`Connection error: ${error.message}`);
      },
      onReconnect: ({ attempt, delay }) => {
        setStats({
          attempts: attempt,
          lastReconnect: new Date(),
        });
        console.log(`Reconnecting in ${delay}ms (attempt ${attempt})`);
      },
    }
  );

  return (
    <div className="feed">
      <div className="header">
        <h2>Recent Share Purchases</h2>
        {!connected && (
          <div className="status-banner">
            {reconnecting ? (
              <span className="reconnecting">
                Reconnecting (attempt {stats.attempts})...
              </span>
            ) : (
              <span className="disconnected">Disconnected</span>
            )}
          </div>
        )}
      </div>

      {connectionError && (
        <div className="error-banner">{connectionError}</div>
      )}

      <div className="feed-list">
        {purchases.length === 0 ? (
          <div className="empty">
            <p>Waiting for share purchases...</p>
            {!connected && <p className="hint">Connection temporarily lost</p>}
          </div>
        ) : (
          purchases.map((purchase) => (
            <div key={purchase.id} className="feed-item">
              <div className="avatar">{purchase.buyer?.slice(0, 2)}</div>
              <div className="details">
                <p className="buyer">{purchase.buyer}</p>
                <p className="amount">
                  {purchase.shares} shares @ ${purchase.price}
                </p>
                <p className="time">
                  {purchase.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

## Example 4: Custom Backoff Configuration

Example showing how to configure reconnection behavior for different scenarios.

```javascript
// Critical feature: fast reconnection, unlimited retries
export function CriticalMarketDataService() {
  return useWebSocket(import.meta.env.VITE_WS_URL, {
    initialDelay: 500,        // Start quickly
    maxDelay: 5000,           // Cap at 5s
    backoffMultiplier: 1.5,
    reconnectAttempts: Infinity,  // Never give up
    onReconnect: ({ attempt, delay }) => {
      console.log(`Critical feature reconnecting in ${delay}ms`);
    },
  });
}

// Non-critical feature: gentle reconnection, limited retries
export function OptionalFeatureService() {
  return useWebSocket(import.meta.env.VITE_WS_URL, {
    initialDelay: 3000,       // Start slower
    maxDelay: 60000,          // Cap at 60s
    backoffMultiplier: 1.2,   // Slower growth
    reconnectAttempts: 10,    // Give up after 10 attempts
    onReconnect: ({ attempt, delay }) => {
      console.log(`Optional feature will reconnect in ${delay}ms`);
    },
  });
}

// Development: fast feedback, lots of logging
export function DevelopmentWebSocket() {
  return useWebSocket(import.meta.env.VITE_WS_URL, {
    initialDelay: 100,        // Instant feedback
    maxDelay: 2000,           // Cap at 2s
    backoffMultiplier: 2,     // Double each time
    reconnectAttempts: 50,    // Keep trying for dev
    onReconnect: ({ attempt, delay, nextDelay }) => {
      console.log(
        `[DEV] Reconnect attempt ${attempt}: ${delay}ms delay, ` +
          `next will be ${nextDelay}ms`
      );
    },
  });
}
```

## Example 5: Connection Health Monitoring

Track connection metrics and health.

```javascript
import React, { useState, useEffect } from 'react';
import { useWebSocket, WS_EVENT_TYPES } from '../hooks/useWebSocket';

export function ConnectionHealthMonitor() {
  const [health, setHealth] = useState({
    isHealthy: true,
    totalAttempts: 0,
    averageReconnectTime: 0,
    reconnectTimes: [],
    eventCount: 0,
    lastEventTime: null,
    uptime: 0,
    downtime: 0,
  });

  const [connectionStartTime] = useState(Date.now());
  const [downtimeStart, setDowntimeStart] = useState(null);

  const { connected, connectionAttempts } = useWebSocket(
    import.meta.env.VITE_WS_URL,
    {
      onEvent: (message) => {
        setHealth((prev) => ({
          ...prev,
          eventCount: prev.eventCount + 1,
          lastEventTime: new Date(),
        }));
      },
      onReconnect: ({ attempt, delay }) => {
        const now = Date.now();
        setHealth((prev) => {
          const newTimes = [...prev.reconnectTimes, delay];
          return {
            ...prev,
            totalAttempts: attempt,
            reconnectTimes: newTimes.slice(-10), // Keep last 10
            averageReconnectTime:
              newTimes.reduce((a, b) => a + b, 0) / newTimes.length,
          };
        });
      },
    }
  );

  // Track uptime/downtime
  useEffect(() => {
    if (connected && downtimeStart) {
      setHealth((prev) => ({
        ...prev,
        downtime: prev.downtime + (Date.now() - downtimeStart),
      }));
      setDowntimeStart(null);
    } else if (!connected && !downtimeStart) {
      setDowntimeStart(Date.now());
    }
  }, [connected, downtimeStart]);

  // Calculate uptime percentage
  const totalTime = Date.now() - connectionStartTime;
  const uptimePercent = (
    ((totalTime - health.downtime - (downtimeStart ? Date.now() - downtimeStart : 0)) /
      totalTime) *
    100
  ).toFixed(2);

  return (
    <div className="health-monitor">
      <h2>Connection Health</h2>

      <div className="metrics-grid">
        <div className="metric">
          <label>Status</label>
          <span className={connected ? 'green' : 'red'}>
            {connected ? '✓ Connected' : '✗ Disconnected'}
          </span>
        </div>

        <div className="metric">
          <label>Uptime</label>
          <span>{uptimePercent}%</span>
        </div>

        <div className="metric">
          <label>Reconnect Attempts</label>
          <span>{health.totalAttempts}</span>
        </div>

        <div className="metric">
          <label>Avg Reconnect Delay</label>
          <span>{health.averageReconnectTime.toFixed(0)}ms</span>
        </div>

        <div className="metric">
          <label>Events Received</label>
          <span>{health.eventCount}</span>
        </div>

        <div className="metric">
          <label>Last Event</label>
          <span>
            {health.lastEventTime?.toLocaleTimeString() || 'None'}
          </span>
        </div>
      </div>

      <div className="recent-reconnects">
        <h3>Recent Reconnection Times (ms)</h3>
        <div className="timeline">
          {health.reconnectTimes.map((time, idx) => (
            <div
              key={idx}
              className="bar"
              style={{
                height: `${(time / Math.max(...health.reconnectTimes, 1)) * 100}px`,
              }}
              title={`Reconnect ${idx + 1}: ${time}ms`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Example 6: Fallback to Polling

Example showing graceful degradation when WebSocket repeatedly fails.

```javascript
import React, { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

export function DataWithFallback() {
  const [data, setData] = useState(null);
  const [usingPolling, setUsingPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const maxWebSocketAttempts = 5;
  const { connected, connectionAttempts } = useWebSocket(
    import.meta.env.VITE_WS_URL,
    {
      reconnectAttempts: maxWebSocketAttempts,
      onEvent: (message) => {
        setData(message.data);
        setPollCount(0);
      },
    }
  );

  // Fallback to polling if WebSocket keeps failing
  useEffect(() => {
    if (connectionAttempts >= maxWebSocketAttempts && !connected) {
      console.log('WebSocket failed after', maxWebSocketAttempts, 'attempts, falling back to polling');
      setUsingPolling(true);
    }
  }, [connected, connectionAttempts]);

  // Polling fallback
  useEffect(() => {
    if (!usingPolling) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(import.meta.env.VITE_API_URL + '/api/data');
        const newData = await response.json();
        setData(newData);
        setPollCount((prev) => prev + 1);
      } catch (error) {
        console.error('Polling failed:', error);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [usingPolling]);

  return (
    <div>
      <div className="data-display">
        {data ? (
          <>
            <p>Data: {JSON.stringify(data)}</p>
            <p className="mode">
              {usingPolling
                ? `Polling (${pollCount} polls)`
                : 'WebSocket (Real-time)'}
            </p>
          </>
        ) : (
          <p>Waiting for data...</p>
        )}
      </div>
    </div>
  );
}
```

## Example 7: Testing Reconnection

Example showing how to test reconnection behavior.

```javascript
import { render, screen, waitFor } from '@testing-library/react';
import { useWebSocket } from '../hooks/useWebSocket';

describe('WebSocket Reconnection', () => {
  it('should reconnect with exponential backoff', async () => {
    const mockWs = jest.fn();
    jest.mock('WebSocket', () => mockWs);

    const delays = [];
    const { rerender } = render(
      <TestComponent
        onReconnect={({ delay }) => delays.push(delay)}
      />
    );

    // Simulate connection drop
    mockWs.mockImplementation(() => {
      throw new Error('Connection failed');
    });

    // Wait for reconnection attempts
    await waitFor(() => {
      expect(delays.length).toBeGreaterThan(0);
    });

    // Verify exponential backoff
    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
  });

  it('should restore subscriptions after reconnection', async () => {
    const mockSend = jest.fn();
    
    const { rerender } = render(
      <TestComponent
        topics={['asset:123', 'marketplace-status']}
      />
    );

    // Verify initial subscriptions
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('subscribe')
    );

    // Simulate reconnection
    // ...

    // Verify resubscriptions
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('subscribe')
    );
  });
});
```

## Integration with App.jsx

Example showing how to integrate connection monitoring into the main app.

```javascript
// In App.jsx

import { useWebSocket, WS_EVENT_TYPES } from './hooks/useWebSocket';

function App() {
  const { connected, reconnecting, connectionAttempts } = useWebSocket(
    import.meta.env.VITE_WS_URL || `ws://${new URL(API_URL).host}/ws`,
    {
      onEvent: (message) => {
        // Handle all WebSocket events
        handleWebSocketEvent(message);
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
        // Emit toast notification
      },
      onReconnect: ({ attempt, delay }) => {
        console.log(`Reconnecting (attempt ${attempt}, delay: ${delay}ms)`);
      },
    }
  );

  return (
    <div className={styles.app}>
      <Header />
      <Navbar />
      
      {/* Connection Status */}
      <div className="connection-status">
        {!connected && (
          <Alert type={reconnecting ? 'warning' : 'error'}>
            {reconnecting
              ? `Reconnecting... (attempt ${connectionAttempts})`
              : 'Offline - Real-time updates unavailable'}
          </Alert>
        )}
      </div>

      {/* Main Content */}
      <main>
        {/* Your components */}
      </main>
    </div>
  );
}
```

## CSS Styling Examples

```css
/* Connection Status Indicator */
.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
}

.indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e; /* Green */
  animation: pulse 2s infinite;
}

.indicator.reconnecting {
  background: #f59e0b; /* Amber */
  animation: spin 1s linear infinite;
}

.indicator.error {
  background: #ef4444; /* Red */
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Feed List */
.feed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 500px;
  overflow-y: auto;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

/* Status Banner */
.status-banner {
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fee2e2;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
}

.status-banner.reconnecting {
  background: #fef3c7;
  border-color: #fde68a;
  color: #92400e;
}

.status-banner.disconnected {
  background: #fee2e2;
  border-color: #fecaca;
  color: #991b1b;
}
```

