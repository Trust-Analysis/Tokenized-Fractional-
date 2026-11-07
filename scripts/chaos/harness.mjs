#!/usr/bin/env node

// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * harness.mjs — shared primitives for the graceful-degradation failure-injection
 * exercise (GitHub issue #802).
 *
 * Design notes
 * ------------
 * The harness is a *characterization* harness, not an assertion suite. Each
 * experiment records what the system actually does when a dependency is broken,
 * and the runner compares that against a checked-in baseline
 * (`scripts/chaos/baseline.json`). This matters because the point of the exercise
 * is to *document* degradation behaviour — including behaviour that is currently
 * bad — and to alert on subsequent *drift*, not to assert an aspirational ideal
 * that would simply fail forever.
 *
 * Every primitive here is dependency-free (node: builtins only) so the exercise
 * runs on a bare checkout, matching the conventions in
 * `scripts/test-nginx-rate-limit.mjs` and `scripts/check-dependency-audit.mjs`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BACKEND_DIR = join(REPO_ROOT, 'backend');

/** Verdict values an experiment can produce. */
export const VERDICT = {
  /** System failed in a way an operator would consider acceptable. */
  GRACEFUL: 'GRACEFUL',
  /** System failed in a way that is confusing, silent, or unbounded. */
  UNGRACEFUL: 'UNGRACEFUL',
  /** Experiment could not run here (missing dep, no docker, ...). */
  SKIPPED: 'SKIPPED',
};

export const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Race a promise against a deadline.
 *
 * Returns `{ timedOut: false, value }` when the promise settles in time, and
 * `{ timedOut: true }` when the deadline wins. The underlying promise is *not*
 * cancelled — we deliberately keep it alive so the caller can observe that
 * something is still in flight. Callers are responsible for cleaning up the
 * server/process that owns it.
 */
export async function withDeadline(promise, deadlineMs) {
  let timer;
  const deadline = new Promise((done) => {
    // The timer must stay referenced. Unref'ing it lets the event loop exit
    // while we are still waiting, so the race would never settle and the
    // deadline would never fire. It is cleared in `finally`, so it cannot
    // outlive this call.
    timer = setTimeout(() => done({ timedOut: true, value: undefined }), deadlineMs);
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false, value })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll a URL until it answers with one of `acceptStatuses`, or give up.
 * Mirrors the readiness loop in `scripts/test-nginx-rate-limit.mjs:68-79`.
 */
export async function waitForHttp(url, { acceptStatuses = [200], attempts = 40, intervalMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await probeHttp(url, { timeoutMs: 2000 });
      if (acceptStatuses.includes(response.status)) return response;
    } catch {
      /* not up yet */
    }
    await delay(intervalMs);
  }
  return null;
}

/**
 * Issue a single HTTP(S) request and classify the outcome.
 *
 * Never throws for network-level failures — a chaos run treats "connection
 * refused" and "read timeout" as *observations*, not errors. Returns:
 *
 *   { outcome: 'response', status, headers, body, durationMs }
 *   { outcome: 'refused',    code,      durationMs }   // nothing listening
 *   { outcome: 'reset',      code,      durationMs }   // peer severed mid-flight
 *   { outcome: 'timeout',    code,      durationMs }   // no response within budget
 *   { outcome: 'other',      code,      message, durationMs }
 */
export function probeHttp(url, { timeoutMs = 5000, method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const transport = url.startsWith('https:') ? httpsRequest : httpRequest;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      done({ ...result, durationMs: Date.now() - started });
    };

    const outgoing = transport(url, { method, headers, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', (err) => finish({ outcome: classifyError(err), code: err.code, message: err.message }));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* not JSON — leave null, callers assert on status instead */
        }
        finish({
          outcome: 'response',
          status: response.statusCode,
          contentType: response.headers['content-type'] || null,
          headers: response.headers,
          body: parsed,
          text,
        });
      });
    });

    outgoing.on('timeout', () => {
      outgoing.destroy(Object.assign(new Error('probe timed out'), { code: 'PROBE_TIMEOUT' }));
    });

    outgoing.on('error', (err) => finish({ outcome: classifyError(err), code: err.code, message: err.message }));

    if (body !== null) outgoing.write(typeof body === 'string' ? body : JSON.stringify(body));
    outgoing.end();
  });
}

function classifyError(err) {
  if (err.code === 'ECONNREFUSED') return 'refused';
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return 'reset';
  if (err.code === 'PROBE_TIMEOUT' || err.code === 'ETIMEDOUT') return 'timeout';
  return 'other';
}

/**
 * A fake Soroban JSON-RPC endpoint whose failure mode is selectable.
 *
 * The Stellar SDK talks to the RPC over plain HTTP JSON-RPC, so a bare
 * `node:http` server is enough to inject each failure the exercise needs
 * without depending on the SDK or on a real network.
 *
 * Modes:
 *   'refuse'    — accept the socket then destroy it (models a dropped edge).
 *   'error'     — return HTTP 500 with a JSON-RPC error object.
 *   'slow'      — delay `delayMs` before answering normally.
 *   'blackhole' — accept the socket and never respond. This is the dangerous
 *                 one: anything without its own timeout hangs forever.
 *
 * Sockets are tracked so `close()` can destroy stragglers, otherwise a
 * blackholed keep-alive socket keeps the harness process alive after the run.
 */
export function startFakeRpc(mode, { delayMs = 1000 } = {}) {
  const sockets = new Set();
  let requestCount = 0;

  const server = createServer((req, res) => {
    requestCount += 1;
    req.resume();

    if (mode === 'refuse') {
      req.socket.destroy();
      return;
    }
    if (mode === 'blackhole') {
      // Deliberately no response, ever.
      return;
    }
    if (mode === 'error') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'injected RPC failure' } }));
      return;
    }
    if (mode === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'healthy' } }));
      }, delayMs);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'healthy' } }));
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    server,
    get requestCount() {
      return requestCount;
    },
    listen: () =>
      new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`));
      }),
    close: () =>
      new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => done());
      }),
  };
}

/** Reserve an ephemeral port and immediately release it, returning the number. */
export function reservePort() {
  const probe = createServer();
  return new Promise((done, fail) => {
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

/**
 * Spawn the real backend as a child process.
 *
 * Mirrors `backend/scripts/verify-readme-examples.js:170-210`, which is the
 * existing precedent for driving the real entrypoint.
 *
 * `NODE_ENV` must NOT be 'test': `backend/index.js:1797` gates the entire
 * startup block (including `app.listen`) on `NODE_ENV !== 'test'`. But it also
 * cannot be omitted, because `backend/env.js:64-66` only skips validation in
 * 'test' and `process.exit(1)`s on a missing `ADMIN_API_KEY` otherwise. So the
 * harness runs a real 'development' env and supplies the required vars.
 */
export function startBackend({ port, env = {}, dataFile }) {
  const childEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    // >= 16 chars is enforced by backend/env.js:8-14.
    ADMIN_API_KEY: 'chaos-exercise-admin-key',
    CORS_ORIGINS: 'http://localhost:5173',
    DATA_FILE: dataFile,
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    ...env,
  };
  // A chaos run must not inherit the developer's real infrastructure.
  delete childEnv.REDIS_URL;
  delete childEnv.SOROBAN_RPC_URL;
  delete childEnv.SOROBAN_ADMIN_SECRET;
  Object.assign(childEnv, env);

  const child = spawn(process.execPath, ['index.js'], {
    cwd: BACKEND_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  return {
    child,
    port,
    get output() {
      return output;
    },
    get exited() {
      return child.exitCode !== null || child.signalCode !== null;
    },
    /** Send a signal and wait for the process to actually be gone. */
    stop(signal = 'SIGTERM', graceMs = 8000) {
      if (this.exited) return Promise.resolve({ signal, code: child.exitCode, forced: false });
      const exited = new Promise((done) => child.once('exit', (code, sig) => done({ signal, code, forced: false })));
      child.kill(signal);
      return Promise.race([
        exited,
        delay(graceMs).then(() => {
          // SIGTERM was ignored — escalate so the harness cannot hang forever.
          if (!this.exited) child.kill('SIGKILL');
          return delay(500).then(() => ({ signal, code: child.exitCode, forced: true }));
        }),
      ]);
    },
  };
}

/**
 * Are the backend's dependencies usable?
 *
 * Deliberately checks for the specific modules the experiments actually import —
 * not just `express`. A partial or failed `npm install` leaves `node_modules`
 * present but incomplete, and importing through the gap fails slowly and
 * confusingly. Requiring every module up front turns that into a clean skip.
 */
export function backendDepsInstalled() {
  return ['express', 'pino', '@stellar/stellar-sdk', 'ioredis'].every((mod) =>
    existsSync(join(BACKEND_DIR, 'node_modules', ...mod.split('/'))),
  );
}

/** Is a usable docker CLI on PATH? */
export function dockerAvailable() {
  try {
    return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
      stdio: 'ignore',
    }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Start the repo's real nginx in Docker, proxying to `backendPort`.
 *
 * Follows `scripts/test-nginx-rate-limit.mjs`: `spawnSync` rather than compose,
 * `--network host` so the config's literal `127.0.0.1:<port>` reaches the
 * host-side backend, config mounted read-only, container name derived from pid.
 */
export function startNginx({ backendPort, frontendPort, gatewayPort }) {
  const containerName = `chaos-nginx-${process.pid}`;
  // nginx.conf hard-codes `listen 80` and the 3001/5173 upstreams, so generate a
  // run-scoped copy pointing at ephemeral ports. The repo's own file is never
  // mutated, and nothing binds a privileged port (which also avoids colliding
  // with a real service on the host).
  const confDir = mkdtempSync(join(tmpdir(), 'chaos-nginx-conf-'));
  const confPath = join(confDir, 'nginx.conf');

  const conf = readFileSync(join(REPO_ROOT, 'nginx', 'nginx.conf'), 'utf8')
    .replace('listen 80;', `listen ${gatewayPort};`)
    .replaceAll('http://127.0.0.1:3001', `http://127.0.0.1:${backendPort}`)
    .replaceAll('http://127.0.0.1:5173', `http://127.0.0.1:${frontendPort}`);

  writeFileSync(confPath, conf, 'utf8');

  const run = spawnSync(
    'docker',
    [
      'run', '--detach', '--network', 'host', '--name', containerName,
      '--volume', `${confPath}:/etc/nginx/nginx.conf:ro`,
      'nginx:1.27-alpine',
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    rmSync(confDir, { recursive: true, force: true });
    throw new Error(`docker run failed: ${run.stderr || run.stdout || `status ${run.status}`}`);
  }

  return {
    containerName,
    /** `docker stop` — models the gateway going away under a rolling restart. */
    stop: () => spawnSync('docker', ['stop', '--time', '1', containerName], { stdio: 'ignore' }),
    start: () => spawnSync('docker', ['start', containerName], { encoding: 'utf8' }),
    close: () => {
      spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
      rmSync(confDir, { recursive: true, force: true });
    },
  };
}
