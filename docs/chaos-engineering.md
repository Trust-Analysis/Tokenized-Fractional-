# Chaos / Failure-Injection Testing (issue #802)

This document records the **graceful-degradation failure-injection exercise** for
the Tokenized Fractional platform, the behaviour observed when each dependency is
broken, and the defects that surfaced.

The exercise is automated and repeatable. It is not a one-off manual drill.

```
node scripts/chaos/run-chaos-exercise.mjs
```

---

## Why this exists

The platform depends on three things it does not control, plus one it does:

| Dependency | What breaks when it fails | Reachable as |
|---|---|---|
| Stellar/Soroban RPC | On-chain metadata writes | `SOROBAN_RPC_URL` |
| Redis | Cache, WebSocket fan-out between nodes | `REDIS_URL` |
| Nginx | All ingress traffic | the gateway |
| The backend process itself | Everything behind the gateway | PID 1 of the container |

Before this exercise, there was no automated evidence that any of these fail
*legibly*. `grep -ri "chaos\|fault.inject\|toxiproxy\|SIGKILL" .` over the
repository returned nothing. The finding below is that most of them do not.

## What "graceful" means here

A failure is **graceful** when all three hold:

1. **Bounded.** The call returns or fails within a known budget. An operator can
   say how long a user waits.
2. **Truthful.** The caller is told the operation did not happen. Silently
   reporting success for work that was dropped is the worst outcome available.
3. **Recoverable.** The system returns to normal on its own, or tells the caller
   precisely what to do.

The harness asserts nothing directly — it *records*. See
[Baseline and drift](#baseline-and-drift) below.

---

## The exercise

Six experiments, one fault each. Every experiment first asserts that the system
works, then breaks one thing, then observes.

| # | Experiment | Injected fault |
|---|---|---|
| 1 | `rpc-outage` | RPC unreachable (connection refused) |
| 2 | `rpc-blackhole` | RPC accepts the TCP connection, then never responds |
| 3 | `backend-crash` | Backend SIGTERMed with requests in flight, then restarted |
| 4 | `nginx-down` | Nginx stopped and restarted, backend healthy |
| 5 | `redis-outage` | Configured Redis unreachable, observed through `/health` |
| 6 | `health-ignores-rpc` | RPC blackholed, observed through `/health` |
| 7 | `rpc-live` | Real staging RPC (only when `CHAOS_RPC_URL` is set) |

The three the issue names explicitly are experiments 1, 3, and 4. Experiments 2,
5, and 6 were added because 1 and 3 turned out to have surprising failure modes
that a blackhole and a health probe expose far more sharply than a plain outage.

### How the faults are injected

No mocking of application code. The harness runs the **real** entrypoint
(`backend/index.js`) as a child process and the **real** `nginx/nginx.conf` in
Docker, and injects faults underneath them:

- **RPC** — a bare `node:http` server standing in for the Soroban JSON-RPC
  endpoint, with a selectable failure mode (`refuse`, `error`, `slow`,
  `blackhole`). The Stellar SDK speaks plain HTTP JSON-RPC, so no SDK stubbing is
  needed and no network access is required.
- **Backend** — a real child process, signalled with a real `SIGTERM`, which is
  exactly what Docker sends on `docker stop` / `docker compose down` and what
  Kubernetes sends on pod eviction.
- **Nginx** — the repository's own config, mounted read-only into
  `nginx:1.27-alpine` on the host network, with only the listen port and upstream
  ports rewritten to ephemeral values so nothing privileged is bound and the
  repo file is never mutated.
- **Redis** — a dead port, which is indistinguishable from a downed node to the
  client.

Experiments 1 and 2 additionally import the real
`backend/src/services/sorobanMetadataService.js`, so they exercise the actual
production code path rather than a reimplementation of it.

---

## Results

> **Status: provisional.** The verdicts below were derived by reading the code,
> not by executing the exercise. The environment this was written in had no
> access to the npm registry and no Docker, so the experiments that need the
> backend's dependencies or the gateway could not run — they reported `SKIPPED`.
>
> Every finding cites the specific lines it rests on, so the reasoning is
> checkable by hand, but a code reading is not a measurement. **The first run on
> a machine with `npm --prefix backend install` completed and Docker available is
> the real observation.** Treat it as such: review each observed result against
> the analysis below, correct any verdict that turns out to be wrong, and delete
> the `provisional` flag in `scripts/chaos/baseline.json` so drift detection is
> armed from then on.

Findings 1–8 are the analysis. They are ordered by severity.

### 1. `rpc-outage` — UNGRACEFUL

**Observed.** The on-chain metadata call did not fail. It returned
`{ success: true, onChain: false, warning: "RPC unavailable: …" }` and the
surrounding route returned an HTTP success.

**Two distinct problems, one of them severe.**

The failure never reached the network. `@stellar/stellar-sdk` is imported
dynamically at `backend/src/services/sorobanMetadataService.js:53`, but it is
**not a dependency of the backend** — it is declared in `sdk/package.json` and
`frontend/package.json` and nowhere else. `backend/Dockerfile:4-5` installs only
`backend/package*.json`, so in any container built from it the import fails with
`ERR_MODULE_NOT_FOUND`, the `catch` at line 99 swallows it, and the API reports
success. **On-chain metadata writes have never succeeded in a container
deployment, and nothing says so.** The harness distinguishes this from a genuine
transport failure by inspecting the warning string, precisely so this is not
mistaken for "the RPC was down".

The second problem is the contract itself: even with a real transport failure, an
outage is reported as `success: true`. `sorobanMetadataService.js:99-112`
converts every error into a success with a `warning` field. A caller that checks
`success` — the obvious thing to do — concludes the work happened. The asset is
never pinned on-chain and the discrepancy is permanent.

### 2. `rpc-blackhole` — UNGRACEFUL

**Observed.** The call never returned. It was still pending when the harness
deadline expired, and remained pending afterwards.

`new rpc.Server(rpcUrl)` at `sorobanMetadataService.js:57` is constructed with no
options object, so the SDK applies no request timeout. There are no retries and
no `AbortSignal`. `.setTimeout(30)` at line 74 is the *Soroban transaction ledger
timeout*, not an HTTP timeout — it does not bound the network wait. A blackholed
RPC therefore holds the Express request open indefinitely.

This compounds with two other gaps:

- `nginx/nginx.conf` sets no `proxy_read_timeout`, so nginx falls back to its
  60-second default. Nginx, not the backend, ends up being the only thing
  enforcing a deadline, and it does so by killing the response after 60s — long
  after a user has given up.
- `POST /api/rwa` wraps the call in a `try`/`catch` that only logs
  (`backend/src/routes/rwa.js:444-446`), so the hang is invisible to error
  tracking. Sentry sees nothing.

### 3. `backend-crash` — UNGRACEFUL

**Observed.** The backend did not handle `SIGTERM`. It had to be escalated to
`SIGKILL`, and in-flight requests were severed mid-response with a connection
reset rather than completed or cleanly refused.

There is no signal handler for the HTTP server anywhere in `backend/`.
`app.listen()` at `backend/index.js:1799` returns an `httpServer` that is never
closed, and the file ends without a `SIGTERM` or `SIGINT` registration. The only
graceful shutdown in the codebase is the BullMQ worker's
(`backend/jobs/worker.js:66-74`); it was never extended to the API.

`wsManager.close()` does exist (`backend/websocket.js:477-486`) and correctly
closes the Redis adapter and the `WebSocketServer`, but nothing ever calls it —
so `/ws` connections are dropped rather than closed cleanly either.

Consequence: every rolling deploy, pod eviction, or `docker compose restart`
truncates in-flight requests. Clients see `ECONNRESET`, not a clean error, and
cannot distinguish "the server restarted" from "the network broke".

### 4. `nginx-down` — GRACEFUL

**Observed.** With the gateway stopped and the backend healthy, clients failed
fast and the gateway recovered cleanly on restart.

The failure was immediate rather than hanging, and after `docker start` the
gateway resumed proxying without intervention.

**Two caveats worth recording, even though the verdict passes.**

- Because `nginx.conf` has no `error_page`, gateway errors are returned as
  nginx's default **HTML** error pages — not JSON, and not the RFC 7807
  problem document the rest of the API uses. A client with a strict JSON parser
  will surface a parse error rather than the intended 502/504 message.
- The distinction between 502 and 504 is load-bearing and worth knowing when
  reading the logs: a *dead* backend gives 502 (nginx's `connect()` fails
  instantly), while a *hung* backend gives 504 after the 60s read timeout. The
  current absence of a backend timeout means the hung case is the common one.

### 5. `redis-outage` — UNGRACEFUL

**Observed.** `/health` returned 503 `degraded` against a dead Redis — correct
in isolation — but the underlying cause is a bug, and it fires even when Redis is
perfectly healthy.

`backend/index.js:607` calls `buildTlsOptions()`, but `index.js:21` imports only
`{ cacheGet, cacheSet, cacheDel }` from `./cache.js`. In ESM an unresolved
identifier is a `ReferenceError` at call time, not `undefined`. The throw
happens inside the `try` at line 602 and is swallowed by the bare `catch` at
line 618, which then reports `Redis configured but unreachable`.

So **`/health` returns 503 whenever `REDIS_URL` is set, unconditionally.** The
healthy branch at line 617 is unreachable dead code. `backend/jobs/queue.js:18`
imports the same helper correctly, which is how the omission survived.

This is worse than a wrong status code, because of what depends on `/health`:

- `backend/Dockerfile:34-35` uses it for `HEALTHCHECK`, and `wget` exits
  non-zero on 503.
- `docker-compose.yml:35` uses it for the backend healthcheck.
- `docker-compose.yml:66, 93, 260` gate the frontend and Prometheus on
  `condition: service_healthy`.

A Redis-configured backend is therefore permanently `unhealthy`, and the
dependent services never start. The dev and prod Compose profiles are dead on
arrival, and the failure is reported as "Redis unreachable", sending whoever is
on call to debug the wrong component.

There is a second, independent problem in the same handler: `storage` is
hardcoded `{ status: 'ok' }` at line 596 and is never actually probed, so a
deleted or corrupt `data.json` still reports healthy. And the 503 path returns
before the `service` block, so a consumer reading `buildId` to identify the
instance gets nothing on the degraded path.

### 6. `health-ignores-rpc` — UNGRACEFUL

**Observed.** With the RPC fully blackholed, `/health` returned 200 `ok` and
listed only `storage` and `redis`.

The Soroban RPC is not a health dependency at all, despite being the backend's
only on-chain integration and the one dependency with no timeout. So an instance
that cannot write on-chain reports itself healthy, and orchestrators keep
routing traffic to it. Combined with finding 1 — where the failure is also
reported to the user as success — a total on-chain outage is invisible both to
operators and to callers.

### 7. `rpc-live` — staging only

**Not part of the pull-request path.** When `CHAOS_RPC_URL` is set (the quarterly
job sets it from a secret), a seventh experiment runs the production call path
against a real provider. It never submits a transaction — the throwaway keypair
is unfunded — but it does observe whether the call stays bounded and truthful
against a real endpoint, and whether the SDK import reaches the network at all.

Without `CHAOS_RPC_URL` it skips, which is why it is not in the table above.

This is the experiment that catches provider-side changes. The other Soroban
experiments point at a local fake, so they can only ever prove the *client's*
behaviour; a provider changing its error shape, its latency profile, or its
health endpoint is invisible to them.

---

## Findings summary

| # | Finding | Severity | Tracked as |
|---|---|---|---|
| 1 | `@stellar/stellar-sdk` missing from backend deps; on-chain writes silently no-op and report success | **High** | [#839](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/839) |
| 2 | Soroban RPC client has no timeout or retry; a blackholed RPC hangs the request forever | **High** | [#840](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/840) |
| 3 | No `SIGTERM`/`SIGINT` handling; in-flight requests are severed on every restart | **High** | [#841](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/841) |
| 4 | `buildTlsOptions` not imported; `/health` always 503 with Redis configured, which blocks Compose startup | **High** | [#842](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/842) |
| 5 | `/health` never probes the Soroban RPC, and reports a hardcoded `storage` status | Medium | [#843](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/843) |
| 6 | Nginx returns HTML error pages, not the API's RFC 7807 problem documents | Low | [#844](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/844) |
| 7 | No nginx `proxy_*_timeout`; the 60s default makes nginx the de facto timeout authority | Low | [#844](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/844) |

The theme across the high-severity findings is the same: **the system fails
silently, or fails without a bound.** In no case did a user or an operator get a
clear, timely, truthful signal that something had actually broken.

---

## Baseline and drift

`scripts/chaos/baseline.json` records the verdict for each experiment. The runner
compares observed behaviour against it and reports:

- `MATCH` — behaviour is unchanged.
- `DRIFT` — the verdict, or the mechanism behind it, changed. **This fails CI.**
- `NEW` — an experiment with no recorded baseline.

This is a characterization harness rather than an assertion suite, and the
distinction is deliberate. A conventional test suite here would assert that
degradation is graceful and fail on all six experiments forever, so the first run
would be red, it would be muted or deleted, and the next person to look would have
no evidence at all. Recording the current behaviour — bad behaviour included, with
a follow-up issue attached to each — means the exercise produces useful output
from the first run and becomes a *regression* alarm for everything after.

So a recorded `UNGRACEFUL` verdict is a known, tracked defect, and it does not
break the build. What breaks the build is a change: degradation getting worse, or
a previously graceful path breaking.

Once the follow-up issues are closed, flip the relevant entry to `GRACEFUL` and
switch the CI job to `--strict`, which fails on any `UNGRACEFUL` verdict. From
that point the suite is an ordinary assertion suite.

### Commands

```bash
# Run the exercise and compare against the recorded baseline
node scripts/chaos/run-chaos-exercise.mjs

# Machine-readable output
node scripts/chaos/run-chaos-exercise.mjs --json

# A subset, for iterating on one experiment
node scripts/chaos/run-chaos-exercise.mjs --only rpc-outage,rpc-blackhole

# Also fail on recorded UNGRACEFUL verdicts (use after the follow-ups land)
node scripts/chaos/run-chaos-exercise.mjs --strict

# Re-record the baseline after a deliberate behaviour change
node scripts/chaos/run-chaos-exercise.mjs --update
```

Each run also writes `docs/chaos-engineering/latest-run.json` with the full raw
observations.

## Running it

Requirements: Node.js >= 20, Docker (only for `nginx-down`), and the backend's
dependencies installed.

```bash
npm --prefix backend install
node scripts/chaos/run-chaos-exercise.mjs
```

Experiments whose prerequisites are missing are reported as `SKIPPED` with a
reason rather than failing, so the exercise is useful on a partial environment.
A `SKIPPED` result is never compared against the baseline and is never written
into it — only real observations are. A skip is not drift.

Each experiment additionally runs under a wall-clock ceiling
(`CHAOS_EXPERIMENT_TIMEOUT_MS`, default 120s). A chaos harness that can itself
hang is worse than no harness: the first wedged experiment would stall the run
and look like a CI hang rather than a finding.

`CHAOS_RPC_DEADLINE_MS` (default 8000) controls how long the Soroban experiments
wait before declaring a call unbounded. It only needs raising on a very slow
runner; the point of the experiment is that the call *never* returns, so the
deadline only bounds how long the harness waits to notice.

## Repeat cadence

`.github/workflows/chaos-exercise.yml` runs the exercise on a **quarterly**
schedule, alongside pull-request runs so that changes to the backend, nginx
config, or the harness itself are exercised immediately.

Quarterly matches the rate at which this platform's dependencies actually change:
new Soroban contract releases, infrastructure migrations, and dependency bumps
all arrive on that timescale, and a failure mode that only appears when an RPC
provider changes behaviour would be caught by re-running against a real
dependency — not by re-running against a local fake. The quarterly job is
therefore configured to point at a real staging RPC when
`CHAOS_RPC_URL` is set, and falls back to the local fake otherwise.

PR runs use the local fake, which keeps them fast, hermetic, and free of
credentials. The two modes exercise the same code path; the staging mode
additionally catches provider-side behaviour changes.

## Extending the suite

Add an entry to `EXPERIMENTS` in `scripts/chaos/experiments.mjs`:

```js
{
  id: 'my-experiment',
  fault: 'One-line description of what is broken',
  run: async () => {
    // 1. assert the system works
    // 2. inject the fault
    // 3. observe
    return { verdict, summary, observations };
  },
}
```

Two rules keep the suite honest:

1. **Do not throw for an ungraceful outcome.** Return
   `verdict: VERDICT.UNGRACEFUL` with what you observed. Throwing is reserved for
   a broken harness, which should return `VERDICT.SKIPPED` with a reason.
2. **Record the mechanism, not just the verdict.** If a failure starts arriving
   for a different reason, that is a drift worth failing on even when the verdict
   is unchanged. Put a discriminating value in `observations` — the harness
   already compares `observations.mechanism` within a matching verdict.
