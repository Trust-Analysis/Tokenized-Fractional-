/**
 * Mock backend for local load-test validation (Issue #524)
 *
 * Reproduces the minimal behaviour of the real backend that the Artillery
 * scenarios depend on, so the suite can be validated end-to-end (and a baseline
 * captured) WITHOUT requiring the full backend + database + Redis stack:
 *
 *   - WebSocket `/ws`: sends `connection_established`, honours `subscribe`
 *     (`share-purchases`, `asset:*`, `marketplace-status`) with
 *     `subscription_confirmed`, and answers `ping` with `pong`. It then fans out
 *     `share_purchased` events to all subscribers when a trade is POSTed.
 *   - `POST /api/v1/notify/share-purchased`: validates a minimal body and
 *     broadcasts a `share_purchased` event to subscribed WebSocket clients.
 *   - `POST /api/v1/purchases`: records and returns a purchase, exercising the
 *     HTTP order path.
 *
 * Optional artificial latency to approximate backend processing:
 *   HTTP_LATENCY_MS  (default 5)  -> delay before HTTP responses
 *   WS_LATENCY_MS    (default 1)  -> delay before WS handshake confirmation
 *
 * Run:
 *   node load-test/mock-server.js            # listens on :3001
 *   PORT=3002 node load-test/mock-server.js
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 3001);
const HTTP_LATENCY_MS = Number(process.env.HTTP_LATENCY_MS || 5);
const WS_LATENCY_MS = Number(process.env.WS_LATENCY_MS || 1);

const topics = new Map(); // topic -> Set<ws>

function broadcastTopic(topic, message) {
  const clients = topics.get(topic);
  if (!clients) return;
  const payload = JSON.stringify({ ...message, seqId: Math.floor(Math.random() * 1e9), timestamp: new Date().toISOString() });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function handleWs(wss) {
  wss.on('connection', (ws) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'connection_established', clientId, timestamp: new Date().toISOString() }));
    }, WS_LATENCY_MS);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.action === 'subscribe') {
        if (!topics.has(msg.topic)) topics.set(msg.topic, new Set());
        topics.get(msg.topic).add(ws);
        ws.send(JSON.stringify({ type: 'subscription_confirmed', topic: msg.topic, timestamp: new Date().toISOString() }));
      } else if (msg.action === 'unsubscribe') {
        topics.get(msg.topic)?.delete(ws);
      } else if (msg.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    });

    ws.on('close', () => {
      for (const [topic, set] of topics) {
        set.delete(ws);
        if (set.size === 0) topics.delete(topic);
      }
    });
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(body).toString();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore malformed */
    }

    const respond = (status, data) => {
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      }, HTTP_LATENCY_MS);
    };

    if (req.method === 'GET' && url.pathname === '/health') {
      return respond(200, { status: 'ok' });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/notify/share-purchased') {
      const { contractId, buyerAddress, sharesToBuy, totalCost } = payload;
      if (!contractId || !buyerAddress) {
        return respond(400, { error: 'Missing required fields' });
      }
      broadcastTopic('share-purchases', { type: 'share_purchased', data: { contractId, buyerAddress, sharesToBuy, totalCost } });
      return respond(200, { ok: true, message: 'Event broadcasted' });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/purchases') {
      const { contractId, buyerAddress, sharesPurchased, pricePerShare, totalAmount } = payload;
      if (!contractId || !buyerAddress) {
        return respond(400, { error: 'Missing required fields' });
      }
      return respond(201, {
        data: { transactionId: `tx-${Date.now()}`, contractId, status: 'completed', createdAt: new Date().toISOString() },
        message: 'Purchase recorded successfully',
      });
    }

    respond(404, { error: 'Not found' });
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
handleWs(wss);

server.listen(PORT, () => {
  console.log(`[load-test mock] listening on http://localhost:${PORT} (ws path /ws)`);
  console.log(`  HTTP_LATENCY_MS=${HTTP_LATENCY_MS} WS_LATENCY_MS=${WS_LATENCY_MS}`);
});
