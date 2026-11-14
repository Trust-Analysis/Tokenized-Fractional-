/**
 * Multi-node WebSocket delivery test (Issue #593)
 *
 * Simulates two horizontally-scaled backend nodes connected through the Redis
 * Pub/Sub adapter. A real WebSocket client subscribed to node B receives a
 * broadcast made on node A, proving that order book / price / availability
 * updates fan out across every instance.
 *
 * Run inside docker-compose (starts Redis automatically):
 *   docker compose --profile ws-scale up --build ws-multinode-test
 *
 * Or manually against a local Redis:
 *   REDIS_URL=redis://localhost:6379 node backend/scripts/websocket-multinode-test.js
 */

import { createServer } from 'http';
import WebSocket from 'ws';
import { WebSocketManager } from '../websocket.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TOPIC = 'share-purchases';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Boot a WebSocketManager on an ephemeral port and attach the Redis adapter.
 */
async function startNode(name) {
  const manager = new WebSocketManager();
  const server = createServer();
  manager.initialize(server);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, async () => {
      const { port } = server.address();
      try {
        await manager.connectRedisAdapter({ redisUrl: REDIS_URL });
        if (!manager.redisAdapter || !manager.redisAdapter.connected) {
          reject(new Error(`Redis adapter failed to connect for ${name}`));
          return;
        }
        resolve({ name, manager, server, url: `ws://127.0.0.1:${port}/ws` });
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Connect a real WebSocket client and subscribe it to TOPIC.
 * Resolves once the server confirms the subscription.
 */
function connectSubscriber(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    let confirmed = false;

    const timer = setTimeout(() => {
      if (!confirmed) {
        ws.close();
        reject(new Error('Timed out waiting for subscription confirmation'));
      }
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'subscribe', topic: TOPIC }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'subscription_confirmed' && msg.topic === TOPIC) {
        confirmed = true;
        clearTimeout(timer);
        resolve({ ws, messages });
        return;
      }

      // Control messages (connection_established, subscription_confirmed) are
      // not broadcasts — only actual event messages end up in `messages`.
      if (msg.type !== 'connection_established') {
        messages.push(msg);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  console.log('🌐 Multi-node WebSocket delivery test (Issue #593)\n');
  console.log(`Redis: ${REDIS_URL}`);

  // ── Start two logical nodes sharing the same Redis ─────────────────────
  const nodeA = await startNode('node-a');
  console.log(`✓ Node A listening on ${nodeA.url}`);
  const nodeB = await startNode('node-b');
  console.log(`✓ Node B listening on ${nodeB.url}`);
  console.log(`✓ Both nodes connected to Redis Pub/Sub (channel ws:broadcast)\n`);

  // ── Subscribe a client to Node B only ──────────────────────────────────
  const clientB = await connectSubscriber(nodeB.url);
  console.log(`✓ Client subscribed to "${TOPIC}" on Node B (only)`);

  // Give Redis and the local subscription state a moment to settle.
  await sleep(300);

  // ── Broadcast on Node A ────────────────────────────────────────────────
  nodeA.manager.broadcastSharePurchase(
    'CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG',
    'GBUYERABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    10,
    100000000
  );
  console.log('➡️  Broadcast sent on Node A');

  // ── Wait for the message to cross instances ────────────────────────────
  const deadline = Date.now() + 5000;
  let received = null;
  while (Date.now() < deadline && !received) {
    received = clientB.messages.find((m) => m.topic === TOPIC);
    if (!received) await sleep(100);
  }

  if (!received) {
    console.error('✗ Node B did NOT receive the broadcast from Node A');
    process.exitCode = 1;
  } else {
    console.log(`✓ Node B received broadcast from Node A: type="${received.type}" seqId=${received.seqId}`);
    console.log(`  payload: ${JSON.stringify(received.data)}`);
  }

  // ── Stats should expose the Redis adapter on both nodes ────────────────
  const statsA = nodeA.manager.getStats();
  const statsB = nodeB.manager.getStats();
  console.log(`\nNode A stats: ${JSON.stringify(statsA)}`);
  console.log(`Node B stats: ${JSON.stringify(statsB)}`);
  console.log(`✓ Redis adapter visible in stats (A=${statsA.redisConnected}, B=${statsB.redisConnected})`);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  clientB.ws.close();
  await nodeA.manager.close();
  await nodeB.manager.close();
  nodeA.server.close();
  nodeB.server.close();

  if (process.exitCode) {
    console.error('\n❌ Multi-node WebSocket test FAILED');
    process.exit(process.exitCode);
  }
  console.log('\n✅ Multi-node WebSocket test PASSED');
}

main().catch((error) => {
  console.error('❌ Multi-node WebSocket test FAILED:', error.message);
  process.exit(1);
});
