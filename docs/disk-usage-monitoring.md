# Disk Usage Monitoring and Alerting

Issue: [#801](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/801)

## Why this exists

The backend persists asset metadata to a file on the instance's local disk —
`DATA_FILE`, which defaults to `data.json` and is resolved next to
`backend/index.js`. Until this was added, nothing observed the filesystem that
file lives on. A slow fill-up (unbounded local log files, a retained dump, an
oversized upload left behind) would surface only as a write failure with no
advance warning.

## What is measured

Every signal below measures the **filesystem containing `DATA_FILE`**, not the
directory itself, and all of them call the same probe
(`backend/src/utils/diskUsage.js`) so they cannot disagree about the numbers.

| Signal | Where | Notes |
|---|---|---|
| `dependencies.disk` | `GET /health` | Informational only. Never changes the HTTP status. |
| `disk_usage_ratio` | `GET /metrics` | `used / total`, 0..1. |
| `disk_available_bytes` | `GET /metrics` | Bytes writable by this (unprivileged) process. |
| Exit code | `node backend/scripts/check-disk-usage.js` | The alerting contract. |

`GET /health` deliberately does **not** fail on disk pressure. Render restarts
an instance whose health check fails, and restarting mid-fill-up is more likely
to lose the pending write than to reclaim any space. Disk pressure is a
capacity problem, so it is alerted on rather than used to recycle the process.

A note on the two Prometheus gauges: both report `0` when the filesystem cannot
be measured. That keeps a measurement failure from failing the entire
`/metrics` scrape and taking every other metric down with it, but it means a
Grafana rule should treat an unexpected `disk_usage_ratio == 0` as a
measurement failure — `GET /health` reports the explicit `unknown` status and
the reason for that case.

## Thresholds

| Variable | Default | Meaning |
|---|---|---|
| `DISK_USAGE_WARN_PERCENT` | `80` | Start investigating. |
| `DISK_USAGE_CRITICAL_PERCENT` | `90` | Writes are at risk. Act now. |
| `DISK_USAGE_PATH` | directory of `DATA_FILE` | Override what the CLI measures. |

A value that is not a number, or is outside `(0, 100]`, is ignored in favour of
the default. This is deliberate: `NaN` comparisons are silently false, so a typo
such as `DISK_USAGE_WARN_PERCENT=eighty` would otherwise have disabled alerting
while looking configured. A `DISK_USAGE_CRITICAL_PERCENT` that is not strictly
above `DISK_USAGE_WARN_PERCENT` is discarded for the same reason — it would make
the warn band empty.

## The check

```bash
# Uses DATA_FILE's directory by default
node backend/scripts/check-disk-usage.js

# Machine-readable, for a scheduler that collects JSON
node backend/scripts/check-disk-usage.js --json

# Measure something else, or override the thresholds for one run
node backend/scripts/check-disk-usage.js --path /var/data --warn 75 --critical 85
```

Exit codes — this is the interface schedulers depend on:

| Code | Status | Meaning |
|---|---|---|
| `0` | `ok` | Below the warn threshold. |
| `1` | `warn` | At or above `DISK_USAGE_WARN_PERCENT`. |
| `2` | `critical` | At or above `DISK_USAGE_CRITICAL_PERCENT`. |
| `3` | `unknown` | Could not measure — do **not** assume healthy. |

Warn and critical output is written to **stderr** and healthy output to
**stdout**, so a scheduler that captures only stderr still surfaces alerts.

## Wiring the alert

The repository ships the check; which of these you enable is a hosting decision,
because each one has a cost or a third-party dependency.

**Option A — Render cron job (recommended).** Render notifies on a failed cron
run, and the exit codes above turn that into graduated alerting for free. Add
the service to `render.yaml` (or create it in the dashboard) with:

```yaml
- type: cron
  name: rwa-disk-usage-check
  runtime: node
  rootDir: backend
  schedule: "0 */6 * * *"          # every 6 hours
  buildCommand: npm install --production
  startCommand: node scripts/check-disk-usage.js
  envVars:
    - key: DISK_USAGE_WARN_PERCENT
      value: 80
    - key: DISK_USAGE_CRITICAL_PERCENT
      value: 90
  plan: starter
```

**Option B — uptime monitor.** Point any external monitor that understands HTTP
status codes at a small wrapper, or use its "check must exit 0" mode against the
CLI. `/health` is not suitable as the alert source because it intentionally
stays `200` under disk pressure.

**Option C — Prometheus/Grafana.** The existing `elk/` + `grafana/` stack already
scrapes `/metrics`. Add a rule on `disk_usage_ratio`:

```yaml
- alert: BackendDiskPressure
  expr: disk_usage_ratio > 0.9
  for: 15m
  labels: { severity: critical }
  annotations:
    summary: "Backend disk >90% full on the volume holding DATA_FILE"
- alert: BackendDiskWarning
  expr: disk_usage_ratio > 0.8
  for: 1h
  labels: { severity: warning }
```

## Response procedure

Treat a warn alert as a scheduled task and a critical alert as an incident.
Every command below is safe to run against production; none of them restart the
service or delete data.

**On `warn` (≥80%)**

1. Confirm the measurement is real, not a measurement failure:
   `curl -s $BACKEND_URL/health | jq '.dependencies.disk'`.
   `status: unknown` means the mount could not be read — investigate that
   instead, it is a different problem.
2. Find the consumer. In the Render shell:
   `du -xhd1 /opt/render/project/src 2>/dev/null | sort -h | tail -20`
3. Apply the matching remedy:
   - **Log files** — logs should go to stdout and be shipped by the `elk/`
     stack, never written to local disk. If a file is growing locally, that is
     the bug; fix it and truncate the file.
   - **Backups/dumps** — `restore.js` writes a PostgreSQL dump to disk and
     deliberately does not restore it automatically. Delete dumps you have
     already restored, and prefer a backup target off the instance.
   - **Uploads** — documents go from memory to Pinata (`multer.memoryStorage`),
     so a large file on disk means something bypassed that path.
4. Re-run `node backend/scripts/check-disk-usage.js` and confirm it returns `0`.
5. Record what filled the volume in the issue tracker so the fix is durable, and
   open a follow-up if a code change is needed.

**On `critical` (≥90%)**

1. Page the on-call operator. Writes to `data.json` can start failing at any
   moment, which means asset metadata updates are at risk.
2. Free space immediately with the lowest-risk action available:
   - truncate local log files (`: > /path/to/file.log`) — the `elk/` stack keeps
     the history;
   - delete already-restored database dumps;
   - delete stale artefacts under any `/tmp` working directory.
3. Verify the write path recovered:
   `curl -s $BACKEND_URL/health | jq '.dependencies.disk.status'` and confirm a
   normal metadata write succeeds end to end.
4. Only if space cannot be reclaimed: scale the Render instance's disk or move
   `DATA_FILE` to an attached disk. Moving the file is a deployment change —
   treat it as such and announce it.
5. Write the incident up. If the same consumer filled the volume twice, it needs
   a retention policy or a rotation, not another cleanup.

**Escalation.** A critical alert that cannot be resolved within 30 minutes
becomes a full incident: page the on-call operator, follow the incident-response
playbook (being written under issue
[#795](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/795)), and
use the public status page (issue
[#797](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/797)) to
communicate with users.

## Tests

`backend/__tests__/diskUsage.test.js` covers the threshold parsing, the
classification boundaries, the coherence of the reported snapshot, the
`unknown` behaviour for an unreadable path, and the exit codes the alerting
contract depends on.
