// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * experiments.mjs — the failure-injection experiments for GitHub issue #802.
 *
 * Each experiment:
 *   1. asserts a pre-fault baseline (the system works),
 *   2. injects exactly one fault,
 *   3. observes what the system actually does,
 *   4. returns a verdict plus the raw observations for the run report.
 *
 * An experiment NEVER throws for an ungraceful outcome. Ungraceful degradation is
 * the thing we are here to *document*, so it is a recorded verdict, not a crash.
 * Throwing is reserved for harness bugs (an unavailable dependency), which
 * surfaces as a SKIPPED verdict with a reason.
 *
 * The three fault classes named in the issue are covered by:
 *   - `rpc-outage`        — the Stellar RPC is unreachable/erroring
 *   - `rpc-blackhole`     — the Stellar RPC accepts but never answers
 *   - `backend-crash`     — the backend process is SIGTERMed mid-traffic
 *   - `nginx-down`        — the gateway is stopped
 *   - `redis-outage`      — a configured dependency silently dies
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  BACKEND_DIR,
  VERDICT,
  backendDepsInstalled,
  delay,
  dockerAvailable,
  probeHttp,
  reservePort,
  startBackend,
  startFakeRpc,
  startNginx,
  waitForHttp,
  withDeadline,
} from './harness.mjs';

/** How long to allow an operation that has no internal timeout of its own. */
const RPC_DEADLINE_MS = Number(process.env.CHAOS_RPC_DEADLINE_MS || 8000);
/** Budget for a request that is expected to fail fast (connection refused etc). */
const FAST_FAIL_BUDGET_MS = 3000;

const skip = (reason) => ({ verdict: VERDICT.SKIPPED, reason, observations: {} });

/**
 * Call the real on-chain metadata path with a broken RPC.
 *
 * This is the sharpest test in the suite. `storeMetadataCidOnContract`
 * (backend/src/services/sorobanMetadataService.js) is the backend's only Soroban
 * call site, and its catch block converts *any* failure into
 * `{ success: true, onChain: false, warning }` — an HTTP success. So the question
 * this experiment answers is not "does it 500" but "does the caller learn the
 * truth, and does it learn it in bounded time".
 */
async function probeSorobanMetadata({ rpcUrl, adminSecret }) {
  const previous = {
    SOROBAN_RPC_URL: process.env.SOROBAN_RPC_URL,
    VITE_RPC_URL: process.env.VITE_RPC_URL,
    SOROBAN_ADMIN_SECRET: process.env.SOROBAN_ADMIN_SECRET,
    ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY,
  };
  process.env.SOROBAN_RPC_URL = rpcUrl;
  process.env.SOROBAN_ADMIN_SECRET = adminSecret;
  delete process.env.VITE_RPC_URL;
  delete process.env.ADMIN_SECRET_KEY;

  try {
    // Re-import with a cache-busting query so each experiment re-reads env.
    // Path is built from BACKEND_DIR rather than a relative URL so it does not
    // depend on this file's own location.
    const moduleUrl = new URL(
      `file:///${join(BACKEND_DIR, 'src', 'services', 'sorobanMetadataService.js').replace(/\\/g, '/')}?chaos=${Math.random()}`,
    ).href;
    const { storeMetadataCidOnContract } = await import(moduleUrl);

    const started = Date.now();
    const attempt = storeMetadataCidOnContract({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      cid: 'bafybeigdyrztchaexamplecidforthechaosexercise',
    });

    const raced = await withDeadline(attempt, RPC_DEADLINE_MS);
    if (raced.timedOut) {
      // Leave the dangling promise harmless: attach a no-op catch so an eventual
      // rejection does not become an unhandledRejection that kills the run.
      attempt.then(
        () => {},
        () => {},
      );
      return { settled: false, durationMs: Date.now() - started };
    }

    return { settled: true, durationMs: Date.now() - started, result: raced.value };
  } finally {
    restoreEnv('SOROBAN_RPC_URL', previous.SOROBAN_RPC_URL);
    restoreEnv('VITE_RPC_URL', previous.VITE_RPC_URL);
    restoreEnv('SOROBAN_ADMIN_SECRET', previous.SOROBAN_ADMIN_SECRET);
    restoreEnv('ADMIN_SECRET_KEY', previous.ADMIN_SECRET_KEY);
  }
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * The Stellar SDK requires a valid base32 secret. This is a well-known
 * all-zeroes throwaway account used only to satisfy `Keypair.fromSecret`; it is
 * never funded and never signs anything real.
 */
const THROWAWAY_ADMIN_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWA';

/** Experiment 1 — the RPC is completely unreachable. */
export async function rpcOutage() {
  if (!backendDepsInstalled()) {
    return skip('backend/node_modules is not installed; run `npm --prefix backend install` first');
  }

  // A port nothing is listening on: models a DNS/route failure or a downed node.
  const deadPort = await reservePort();
  const rpcUrl = `http://127.0.0.1:${deadPort}`;

  const probe = await probeSorobanMetadata({ rpcUrl, adminSecret: THROWAWAY_ADMIN_SECRET });
  const warning = probe.result?.warning ?? null;

  // Distinguish *why* the call failed. Getting this right matters: a run that
  // reports "RPC outage" when the real cause was a missing npm package would send
  // an operator chasing the wrong thing.
  const mechanism = classifyFailureMechanism(warning);

  const observations = {
    rpcUrl,
    settled: probe.settled,
    durationMs: probe.durationMs,
    reportedSuccess: probe.result?.success ?? null,
    reportedOnChain: probe.result?.onChain ?? null,
    warning,
    mechanism,
  };

  if (!probe.settled) {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary: 'The on-chain metadata call never settled within the deadline.',
      observations,
    };
  }

  // A hard refusal is arguably fine as long as the caller is told the truth and
  // told quickly. The current contract reports `success: true` with a `warning`,
  // so the verdict turns on whether the truth actually reaches the user.
  if (mechanism === 'missing-dependency') {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary:
        'The Soroban SDK is not a backend dependency, so every on-chain metadata write silently no-ops while reporting success.',
      observations,
    };
  }

  if (probe.result?.success === true && warning) {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary:
        'An RPC outage is reported to the caller as success: true. The failure is only visible as a warning string.',
      observations,
    };
  }

  return {
    verdict: VERDICT.GRACEFUL,
    summary: `RPC outage surfaced to the caller in ${probe.durationMs}ms.`,
    observations,
  };
}

/** Experiment 2 — the RPC accepts the connection and then goes silent. */
export async function rpcBlackhole() {
  if (!backendDepsInstalled()) {
    return skip('backend/node_modules is not installed; run `npm --prefix backend install` first');
  }

  const rpc = startFakeRpc('blackhole');
  const rpcUrl = await rpc.listen();
  let probe;
  try {
    probe = await probeSorobanMetadata({ rpcUrl, adminSecret: THROWAWAY_ADMIN_SECRET });
  } finally {
    await rpc.close();
  }

  const observations = {
    rpcUrl,
    rpcMode: 'blackhole',
    settled: probe.settled,
    durationMs: probe.durationMs,
    deadlineMs: RPC_DEADLINE_MS,
    reportedOnChain: probe.result?.onChain ?? null,
  };

  if (!probe.settled) {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary:
        'A blackholed RPC hangs the on-chain metadata call indefinitely — there is no client-side timeout, so the failure has no bound.',
      observations,
    };
  }

  return {
    verdict: VERDICT.GRACEFUL,
    summary: `A blackholed RPC was bounded and reported in ${probe.durationMs}ms.`,
    observations,
  };
}

/**
 * Experiment 3 — SIGTERM the backend while traffic is in flight.
 *
 * Docker sends SIGTERM and escalates to SIGKILL after its grace period, so this
 * is exactly what a rolling deploy, a pod eviction, or an OOM-adjacent restart
 * does. A graceful backend drains in-flight requests and answers them, or refuses
 * new ones with a clean 503; an ungraceful one severs sockets mid-response.
 */
export async function backendCrash() {
  if (!backendDepsInstalled()) {
    return skip('backend/node_modules is not installed; run `npm --prefix backend install` first');
  }

  const port = await reservePort();
  const dataFile = join(BACKEND_DIR, `chaos-data-${process.pid}.json`);
  const backend = startBackend({ port, dataFile });

  const teardown = async () => {
    await backend.stop('SIGKILL');
    rmSync(dataFile, { force: true });
  };

  try {
    const ready = await waitForHttp(`http://127.0.0.1:${port}/health`, { attempts: 60 });
    if (!ready) {
      return skip(`backend did not become ready on :${port}; output:\n${backend.output.slice(-2000)}`);
    }

    // Baseline: the system is healthy before we break it.
    const before = await probeHttp(`http://127.0.0.1:${port}/api/rwa`, { timeoutMs: 5000 });
    if (before.outcome !== 'response') {
      return skip(`backend is not serving /api/rwa before the fault; got ${before.outcome}`);
    }

    // Fire a burst, then terminate mid-flight.
    const inFlight = Promise.all(
      Array.from({ length: 12 }, () =>
        probeHttp(`http://127.0.0.1:${port}/api/rwa`, { timeoutMs: 10_000 }),
      ),
    );
    await delay(5);
    const stop = await backend.stop('SIGTERM');

    const results = await inFlight;
    const histogram = tally(results.map((r) => (r.outcome === 'response' ? `http_${r.status}` : r.outcome)));

    // Does the process recover on its own, or does it need an external restart?
    const recovered = await waitForHttp(`http://127.0.0.1:${port}/health`, { attempts: 4, intervalMs: 250 });

    const observations = {
      port,
      preFaultStatus: before.status,
      shutdown: stop,
      inFlightHistogram: histogram,
      selfRecovered: Boolean(recovered),
      // A SIGTERM that had to be escalated means nothing handled the signal.
      requiredSigkill: Boolean(stop.forced),
    };

    // The key property: a client must get a definite answer, not a severed
    // connection, and the process must actually react to SIGTERM.
    if (stop.forced) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary:
          'The backend ignores SIGTERM; it only exits on SIGKILL, so in-flight requests are severed mid-response.',
        observations,
      };
    }
    if (!recovered) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary: 'The backend did not come back after a clean SIGTERM restart.',
        observations,
      };
    }
    if (histogram.reset) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary: `${histogram.reset} in-flight request(s) were severed with a connection reset rather than a clean response.`,
        observations,
      };
    }
    return {
      verdict: VERDICT.GRACEFUL,
      summary: 'SIGTERM drained cleanly and the backend came back automatically.',
      observations,
    };
  } finally {
    await teardown();
  }
}

/**
 * Experiment 4 — stop the gateway.
 *
 * With the backend healthy, taking nginx down should produce a prompt, obvious
 * client-side failure (connection refused), not a hang and not a cached-looking
 * success. Then it must recover.
 */
export async function nginxDown() {
  if (!dockerAvailable()) return skip('docker is not available on this runner');
  if (!backendDepsInstalled()) return skip('backend/node_modules is not installed');

  const backendPort = await reservePort();
  const frontendPort = await reservePort();
  const gatewayPort = await reservePort();
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
  const dataFile = join(BACKEND_DIR, `chaos-data-${process.pid}.json`);
  const backend = startBackend({ port: backendPort, dataFile });

  let nginx = null;
  const teardown = async () => {
    if (nginx) nginx.close();
    await backend.stop('SIGKILL');
    rmSync(dataFile, { force: true });
  };

  try {
    const ready = await waitForHttp(`http://127.0.0.1:${backendPort}/health`, { attempts: 60 });
    if (!ready) return skip(`backend did not become ready; output:\n${backend.output.slice(-2000)}`);

    try {
      nginx = startNginx({ backendPort, frontendPort, gatewayPort });
    } catch (err) {
      return skip(`could not start nginx: ${err.message}`);
    }

    const proxied = await waitForHttp(`${gatewayBase}/api/rwa`, { attempts: 40 });
    if (!proxied) return skip('nginx did not proxy /api/ to the backend');

    // Baseline through the gateway.
    const before = await probeHttp(`${gatewayBase}/api/rwa`, { timeoutMs: 5000 });

    nginx.stop();
    // Give the socket a moment to actually go away.
    await delay(500);

    const during = await probeHttp(`${gatewayBase}/api/rwa`, { timeoutMs: FAST_FAIL_BUDGET_MS });

    nginx.start();
    const recovered = await waitForHttp(`${gatewayBase}/api/rwa`, { attempts: 40 });

    // A useful extra observation: is /health reachable through the gateway at
    // all? nginx.conf only proxies /api/, so /health falls through to the
    // frontend location. Operators reaching for it via the gateway are misled.
    const healthViaGateway = await probeHttp(`${gatewayBase}/health`, { timeoutMs: FAST_FAIL_BUDGET_MS });

    const observations = {
      preFaultStatus: before.status,
      duringOutcome: during.outcome,
      duringStatus: during.status ?? null,
      duringDurationMs: during.durationMs,
      recovered: Boolean(recovered),
      healthViaGateway: {
        outcome: healthViaGateway.outcome,
        status: healthViaGateway.status ?? null,
      },
    };

    if (during.outcome === 'timeout') {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary: 'With the gateway down, clients hang until their own timeout instead of failing fast.',
        observations,
      };
    }
    if (!recovered) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary: 'The gateway did not resume serving after being restarted.',
        observations,
      };
    }
    return {
      verdict: VERDICT.GRACEFUL,
      summary: `Gateway failure surfaced as ${during.outcome} in ${during.durationMs}ms and recovered cleanly.`,
      observations,
    };
  } finally {
    await teardown();
  }
}

/**
 * Experiment 5 — kill a configured dependency.
 *
 * `/health` is the endpoint the Dockerfile HEALTHCHECK and docker-compose
 * `depends_on: service_healthy` both gate on, so its behaviour under a
 * dependency outage decides whether the whole stack comes up. Note that
 * nginx.conf only proxies `/api/`, so this must be probed directly.
 */
export async function redisOutage() {
  if (!backendDepsInstalled()) return skip('backend/node_modules is not installed');

  const port = await reservePort();
  const deadRedis = await reservePort();
  const dataFile = join(BACKEND_DIR, `chaos-data-${process.pid}.json`);

  // REDIS_URL is what triggers the Redis branch in /health (index.js:601).
  const backend = startBackend({
    port,
    dataFile,
    env: { REDIS_URL: `redis://127.0.0.1:${deadRedis}` },
  });

  try {
    const ready = await waitForHttp(`http://127.0.0.1:${port}/health`, { attempts: 60, acceptStatuses: [200, 503] });
    if (!ready) return skip(`backend did not become ready; output:\n${backend.output.slice(-2000)}`);

    const health = await probeHttp(`http://127.0.0.1:${port}/health`, { timeoutMs: 10_000 });
    const output = backend.output;

    const observations = {
      status: health.status ?? null,
      body: health.body,
      durationMs: health.durationMs,
      // A correct degraded response blames Redis. A ReferenceError being swallowed
      // by the bare catch means the diagnostic lies about the cause.
      mentionedReferenceError: /buildTlsOptions is not defined/.test(output),
      storageProbed: health.body?.dependencies?.storage?.status ?? null,
    };

    if (health.status === 200) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary: '/health reports healthy while a configured Redis is unreachable.',
        observations,
      };
    }
    if (observations.mentionedReferenceError) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary:
          '/health returns 503 even against a healthy Redis: an unimported helper throws inside the probe and the bare catch reports it as "Redis unreachable".',
        observations,
      };
    }
    return {
      verdict: VERDICT.GRACEFUL,
      summary: '/health reported a bounded, correctly-attributed degraded state.',
      observations,
    };
  } finally {
    await backend.stop('SIGKILL');
    rmSync(dataFile, { force: true });
  }
}

/**
 * Experiment 6 — does /health actually observe the Soroban RPC?
 *
 * The RPC is the backend's hardest dependency and is entirely absent from the
 * health report, so a total on-chain outage is invisible to orchestration.
 * Probed by running the backend with a blackholed RPC configured and asking
 * /health whether anything is wrong.
 */
export async function healthIgnoresRpc() {
  if (!backendDepsInstalled()) return skip('backend/node_modules is not installed');

  const rpc = startFakeRpc('blackhole');
  const rpcUrl = await rpc.listen();
  const port = await reservePort();
  const dataFile = join(BACKEND_DIR, `chaos-data-${process.pid}.json`);
  const backend = startBackend({
    port,
    dataFile,
    env: { SOROBAN_RPC_URL: rpcUrl, SOROBAN_ADMIN_SECRET: THROWAWAY_ADMIN_SECRET },
  });

  try {
    const ready = await waitForHttp(`http://127.0.0.1:${port}/health`, { attempts: 60, acceptStatuses: [200, 503] });
    if (!ready) return skip(`backend did not become ready; output:\n${backend.output.slice(-2000)}`);

    const health = await probeHttp(`http://127.0.0.1:${port}/health`, { timeoutMs: 10_000 });
    const observations = {
      status: health.status ?? null,
      reportedStatus: health.body?.status ?? null,
      dependencies: Object.keys(health.body?.dependencies ?? {}),
      rpcObserved: Boolean(health.body?.dependencies?.soroban || health.body?.dependencies?.rpc),
    };

    if (health.status === 200 && !observations.rpcObserved) {
      return {
        verdict: VERDICT.UNGRACEFUL,
        summary:
          'A completely unreachable Soroban RPC is invisible to /health, so orchestration keeps routing traffic to an instance that cannot write on-chain.',
        observations,
      };
    }
    return {
      verdict: VERDICT.GRACEFUL,
      summary: '/health accounts for Soroban RPC reachability.',
      observations,
    };
  } finally {
    await backend.stop('SIGKILL');
    await rpc.close();
    rmSync(dataFile, { force: true });
  }
}

/**
 * Experiment 7 — the real thing, when a staging RPC is available.
 *
 * The other Soroban experiments point at a local fake, which makes them fast and
 * hermetic but means they can only ever prove the *client's* behaviour. A
 * provider can change its own behaviour — new error shapes, new latency, a
 * changed health endpoint — and only a real endpoint would show that.
 *
 * So when CHAOS_RPC_URL is set (the quarterly job sets it from a secret), this
 * exercises the production call path against the real network. It is
 * observation-only: it never submits a transaction, because the throwaway keypair
 * is unfunded and a real submission would be rejected anyway. The signal it
 * collects is whether the call path stays bounded and truthful against a real
 * provider.
 *
 * With no CHAOS_RPC_URL it skips, which is the normal pull-request path.
 */
export async function rpcLive() {
  const rpcUrl = process.env.CHAOS_RPC_URL;
  if (!rpcUrl) return skip('CHAOS_RPC_URL is not set (expected on pull requests; set it for staging runs)');
  if (!backendDepsInstalled()) return skip('backend/node_modules is not installed');

  const probe = await probeSorobanMetadata({ rpcUrl, adminSecret: THROWAWAY_ADMIN_SECRET });
  const result = probe.result ?? {};

  const observations = {
    rpcUrl: redactUrl(rpcUrl),
    settled: probe.settled,
    durationMs: probe.durationMs,
    reportedSuccess: result.success ?? null,
    reportedOnChain: result.onChain ?? null,
    warning: result.warning ?? null,
    mechanism: classifyFailureMechanism(result.warning ?? null),
  };

  if (!probe.settled) {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary: `The real staging RPC did not produce a bounded response within ${RPC_DEADLINE_MS}ms.`,
      observations,
    };
  }

  // Reaching the provider at all is the bar here. Whether the *result* is a
  // successful write is not, because the throwaway account is unfunded — but the
  // mechanism matters, since a missing-dependency failure here would mean the
  // client never left the process at all.
  if (observations.mechanism === 'missing-dependency') {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary:
        'Against a real staging RPC the call still never reached the network: the Soroban SDK is not a backend dependency.',
      observations,
    };
  }
  if (observations.mechanism === 'transport' || observations.mechanism === 'rpc-error') {
    return {
      verdict: VERDICT.UNGRACEFUL,
      summary: `The real staging RPC was unreachable or erroring (${observations.mechanism}); reported as success=${observations.reportedSuccess}.`,
      observations,
    };
  }

  return {
    verdict: VERDICT.GRACEFUL,
    summary: `The real staging RPC was reachable and the call completed in ${probe.durationMs}ms.`,
    observations,
  };
}

/** Strip credentials from a URL before it is written into the report. */
function redactUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = 'REDACTED';
      url.password = '';
    }
    return url.toString();
  } catch {
    return '<unparseable url>';
  }
}

/** Work out which layer actually produced the Soroban failure. */
function classifyFailureMechanism(warning) {
  if (!warning) return 'none';
  if (/Cannot find (package|module)|ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(warning)) {
    return 'missing-dependency';
  }
  if (/ECONNREFUSED|fetch failed|connect/i.test(warning)) return 'transport';
  if (/HTTP|5\d\d|status/i.test(warning)) return 'rpc-error';
  return 'other';
}

function tally(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

/** The ordered experiment list run by the exercise. */
export const EXPERIMENTS = [
  {
    id: 'rpc-outage',
    fault: 'Stellar/Soroban RPC unreachable (connection refused)',
    run: rpcOutage,
  },
  {
    id: 'rpc-blackhole',
    fault: 'Stellar/Soroban RPC accepts the connection but never responds',
    run: rpcBlackhole,
  },
  {
    id: 'backend-crash',
    fault: 'Backend SIGTERMed while requests are in flight, then restarted',
    run: backendCrash,
  },
  {
    id: 'nginx-down',
    fault: 'Nginx stopped, then restarted, with the backend healthy',
    run: nginxDown,
  },
  {
    id: 'redis-outage',
    fault: 'A configured Redis is unreachable, observed via /health',
    run: redisOutage,
  },
  {
    id: 'health-ignores-rpc',
    fault: 'Soroban RPC blackholed, observed via /health',
    run: healthIgnoresRpc,
  },
  {
    id: 'rpc-live',
    fault: 'Real staging Soroban RPC, when CHAOS_RPC_URL is configured',
    run: rpcLive,
  },
];
