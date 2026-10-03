/**
 * WebSocket reconnection fallback with exponential backoff,
 * heartbeat mechanism, and connection status tracking.
 */

const DEFAULT_CONFIG = {
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 1.5,
  jitterFactor: 0.1,
  pingInterval: 30000,
  pongTimeout: 5000,
  maxReconnectAttempts: Infinity,
};

export function createReconnectConfig(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export function calculateBackoff(attempt, config) {
  const delay = Math.min(
    config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelay
  );
  const jitter = delay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

export class ReconnectionManager {
  constructor(config = {}) {
    this.config = createReconnectConfig(config);
    this.attempt = 0;
    this._timer = null;
    this._pingTimer = null;
    this._pongTimer = null;
    this._lastPong = 0;
    this.onReconnect = null;
    this.onDisconnect = null;
    this.onConnectionLost = null;
  }

  scheduleReconnect(callback) {
    if (this.attempt >= this.config.maxReconnectAttempts) {
      return false;
    }
    const delay = calculateBackoff(this.attempt, this.config);
    this.attempt++;
    this._timer = setTimeout(() => {
      callback();
    }, delay);
    return true;
  }

  startHeartbeat(sendPing) {
    this._pingTimer = setInterval(() => {
      sendPing();
      this._pongTimer = setTimeout(() => {
        if (this.onConnectionLost) this.onConnectionLost();
      }, this.config.pongTimeout);
    }, this.config.pingInterval);
  }

  stopHeartbeat() {
    clearInterval(this._pingTimer);
    clearTimeout(this._pongTimer);
  }

  reset() {
    this.attempt = 0;
    this.stopHeartbeat();
  }

  destroy() {
    this.reset();
    clearTimeout(this._timer);
  }
}
