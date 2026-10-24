# Incident Response Playbook

A single, coordinated playbook for running a **full-stack** incident across the
three tiers of this system:

- **Contract tier** — the Soroban smart contracts in `contracts/`.
- **Backend tier** — the Node.js API/WebSocket service in `backend/`.
- **Edge tier** — DNS, CDN and the frontend static site (Render + Cloudflare).

Individual runbooks already exist for pieces of this ([blue-green deployment
rollback](./blue-green-deployment.md), [CloudWatch resource
alarms](./cloudwatch-incident-runbook.md), [contract pause](#phase-2--contain-the-contract-tier)).
This document stitches them together into **one ordered sequence** an on-call
operator can follow during a live incident, with clear ownership and
communication steps, plus a copy-paste checklist.

> Print it, keep it pinned, and update it during every postmortem.

---

## Table of contents

- [Severity levels](#severity-levels)
- [Roles and ownership](#roles-and-ownership)
- [Communication](#communication)
- [The coordinated sequence](#the-coordinated-sequence)
  - [Phase 0 — Detect and declare](#phase-0--detect-and-declare)
  - [Phase 1 — Triage and classify](#phase-1--triage-and-classify)
  - [Phase 2 — Contain the contract tier](#phase-2--contain-the-contract-tier)
  - [Phase 3 — Contain the frontend / edge tier](#phase-3--contain-the-frontend--edge-tier)
  - [Phase 4 — Contain the backend tier](#phase-4--contain-the-backend-tier)
  - [Phase 5 — Communicate](#phase-5--communicate)
  - [Phase 6 — Recover](#phase-6--recover)
  - [Phase 7 — Post-incident](#phase-7--post-incident)
- [Scenario runbooks](#scenario-runbooks)
- [Live incident checklist](#live-incident-checklist)
- [Appendix: commands and references](#appendix-commands-and-references)

---

## Severity levels

Declare a severity as soon as the impact is understood. When in doubt, start
higher — it is cheap to downgrade.

| Severity | Definition | Examples | Response target | Who is paged |
| --- | --- | --- | --- | --- |
| **SEV1** | Funds at risk, active exploit, or the system is unusable for everyone | Contract vulnerability being exploited; admin key compromise; total outage | Immediate, all hands | On-call + Contracts lead + Maintainer on duty |
| **SEV2** | Major functionality broken or degraded for many users | Purchases failing for all networks; backend down; wrong contract address served | Within 15 min | On-call + Backend lead |
| **SEV3** | Partial degradation with a workaround | One upstream provider down; a single endpoint returning 5xx | Within 1 hour | On-call |
| **SEV4** | Minor / cosmetic, no material user impact | Slow dashboard, elevated latency | Next business day | On-call (tracking only) |

**Always treat any of the following as at least SEV1:** unauthorised contract
upgrade or admin action, a build pointing at an unexpected contract address, or
a suspected compromise of DNS/CDN controls.

---

## Roles and ownership

Name an owner for each role at declaration time. On a small team one person may
hold more than one role, but the **Incident Commander must not be the same
person doing hands-on remediation** for a SEV1.

| Role | Owns | Primary responsibilities |
| --- | --- | --- |
| **Incident Commander (IC)** | The whole incident | Declares severity, assigns roles, decides on containment, runs the timeline, calls the all-clear |
| **Contract lead** | `contracts/` | Pausing/unpausing, verifying on-chain state, deciding on upgrades |
| **Backend lead** | `backend/`, `render.yaml` | Rollback, scaling, disabling endpoints, log forensics |
| **Edge lead** | DNS / CDN / frontend build | Maintenance redirect, cache purge, serving a safe build |
| **Comms lead** | Users & stakeholders | Status updates, status page, user-facing notices |
| **Scribe** | The record | Timestamps every action and decision in the incident channel |

Every role hands off explicitly when they go off-shift ("<name> taking over
Contract lead as of 14:05 UTC").

---

## Communication

- **Primary channel:** the incident channel in chat. All decisions and
  timestamps live there.
- **Cadence:** SEV1 — update every **15 minutes**; SEV2 — every **30 minutes**;
  SEV3 — at each material change. The Comms lead owns the updates.
- **Audience split:** keep an internal thread (technical) and a public/status
  thread (impact + ETA only). Never speculate about cause or blame publicly.
- **Status page / public notice:** publish an initial "investigating" notice
  within 15 minutes of a SEV1, and update it at least hourly until resolved.
- **Escalation:** if the IC cannot be reached within 5 minutes, the next
  responder on the on-call rotation assumes IC.

---

## The coordinated sequence

The order matters: **stop the bleeding at the source (contracts) first**, then
prevent new users from hitting the broken path (edge), then stabilise the
backend, then communicate, then recover in reverse order.

### Phase 0 — Detect and declare

1. Detect via an alert ([CloudWatch alarms](./cloudwatch-incident-runbook.md)),
   the public status page, an error-tracking alert, or a user report.
2. **Declare** in the incident channel:
   `INCIDENT DECLARED — <one-line impact> — provisional SEV<n> — IC: <name>`.
3. Assign roles from the [ownership table](#roles-and-ownership).
4. Start the timeline. The scribe records, with UTC timestamps, every action
   from here on.
5. Open a maintenance/incident entry so the first update can go out fast.

### Phase 1 — Triage and classify

Establish **scope**, **blast radius** and **tier of origin** before changing
anything:

- [ ] Which tier is misbehaving — contract, backend, or edge? (Check the tier
      health signals first; don't assume.)
- [ ] Is value at risk (funds, keys, admin authority)? → escalate to SEV1.
- [ ] Is it still actively worsening, or contained already?
- [ ] What changed in the last 24 h — deploys, config, env vars, DNS, key
      rotations? Diff the running build against the last known-good one.
- [ ] Do we have a safe, known-good target to fail over to (previous blue/green
      colour, previous frontend build)?

Record the provisional cause and the **decision** on containment. If triage is
inconclusive after 15 minutes, default to the most conservative containment:
pause the contract and put the frontend into maintenance mode.

### Phase 2 — Contain the contract tier

**Do this first for anything touching on-chain state.** Pausing stops new
state-changing calls while leaving reads and balances intact.

- [ ] Pause the marketplace using the contract's `pause` entrypoint (the admin
      UI's `PauseControl` component also exposes this). See
      `contracts/src/lib.rs` for `pause` / `unpause` and, for a narrower
      surgical stop, the per-function `pause_function` / `unpause_function`.
- [ ] If the incident is isolated to one function, prefer `pause_function` so
      unaffected features keep working.
- [ ] Confirm the pause took effect on-chain (query `is_paused`; the frontend
      `PauseControl` badge should read **Paused**).
- [ ] If admin keys may be compromised, begin key rotation immediately — a
      paused contract whose admin key is stolen is still a SEV1.
- [ ] Record the transaction hash / ledger of the pause action in the timeline.

> The contract is the authoritative source of truth. Never rely on the
> frontend alone to "hide" a vulnerable contract while it is still callable.

### Phase 3 — Contain the frontend / edge tier

Stop new users from reaching the affected flow, and make sure the site cannot
trick users into signing against a bad contract.

- [ ] **Maintenance notice:** serve a static "we're investigating" page instead
      of the app. Do this at the edge (CDN redirect rule or DNS change) so it
      takes effect even if the app bundle is broken. See [cdn.md](./cdn.md) for
      the Cloudflare/CloudFront setup and invalidation.
- [ ] **Safe redirect / rollback:** if the last deploy is implicated, roll the
      frontend back to the last known-good build. Local rollback:
      `docker compose up --build` from the previous tag, or re-deploy the
      previous Render release.
- [ ] **Contract-address safety:** if the configured contract address is wrong
      or unverified, the app's official-contract check surfaces a warning
      banner. Treat that banner as an incident signal and block purchases until
      the address is confirmed against the signed manifest (see
      [contract address verification](./contract-address-verification.md)).
- [ ] **Purge caches:** purge the CDN cache for the affected paths
      (`/`, `/index.html`, hashed bundles) and any service-worker precache so
      users don't reload a poisoned or stale build.
- [ ] If a malicious fork/typosquat is impersonating the site, escalate to the
      Edge lead for domain takedown and publish a warning on official channels.

### Phase 4 — Contain the backend tier

Stabilise or roll back the API/WebSocket service.

- [ ] **Roll back** to the previous healthy colour with the blue-green script:
      ```bash
      ROLLBACK=true HEALTH_URL=https://<host>/health ./scripts/blue-green-deploy.sh
      ```
      See [blue-green-deployment.md](./blue-green-deployment.md) for the full
      promote/rollback flow and state file.
- [ ] If a specific endpoint is the problem, disable/feature-flag it rather than
      taking the whole service down.
- [ ] Forced scaling / restart when resource exhaustion is the trigger (see the
      [CloudWatch runbook](./cloudwatch-incident-runbook.md) for OOM/CPU
      triage).
- [ ] Confirm `/health` is green and that WebSocket subscribers are not
      reconnect-looping before declaring the backend contained.
- [ ] Preserve logs and process state **before** restarting anything you may
      need to investigate — snapshot logs first.

### Phase 5 — Communicate

The Comms lead owns this phase; it runs in parallel with containment.

- [ ] First public notice (SEV1 within 15 minutes): what is affected, what we're
      doing, what users should do (**do not interact with the app / do not sign
      transactions**), and when the next update will come.
- [ ] Update the status page / public notice at the promised cadence.
- [ ] Notify stakeholders (maintainers, partners, and — for on-chain events —
      anyone who may need to coordinate).
- [ ] Keep the message factual: impact and mitigations only. No speculation, no
      root-cause guesswork, no blame, no internal channel names.
- [ ] Post a final "resolved / monitoring" notice, then a short summary once
      the postmortem is scheduled.

### Phase 6 — Recover

Restore service **in reverse order** to containment, verifying each step.

- [ ] Confirm the fix is deployed and verified in a non-production environment
      where possible.
- [ ] Unpause the contract (`unpause`, or `unpause_function` for a surgical
      stop) and confirm `is_paused` is false.
- [ ] Re-enable / redeploy the frontend, purge caches again, and confirm users
      load the correct build.
- [ ] Return the backend to the active colour and confirm health.
- [ ] Watch error rates, on-chain events, and support channels for at least one
      full traffic cycle before standing down.
- [ ] Declare the all-clear and downgrade severity explicitly.

### Phase 7 — Post-incident

- [ ] Schedule a blameless postmortem within **2 business days** for SEV1/SEV2.
- [ ] Produce a timeline, contributing factors, and a customer-impact summary.
- [ ] File follow-up actions with owners and due dates (detection gaps, missing
      guards, documentation updates such as this playbook).
- [ ] Update this document, the relevant runbooks, and dashboards/alerts so the
      same incident is caught faster next time.

---

## Scenario runbooks

### A. "The smart contract has a critical bug"

1. Declare **SEV1**; assign roles.
2. [Phase 2](#phase-2--contain-the-contract-tier): `pause` immediately; confirm
   `is_paused`.
3. [Phase 3](#phase-3--contain-the-frontend--edge-tier): serve the maintenance
   notice at the edge; purge caches.
4. [Phase 4](#phase-4--contain-the-backend-tier): disable purchase endpoints so
   no queued/optimistic flow can still submit.
5. [Phase 5](#phase-5--communicate): publish "trading paused while we
   investigate".
6. Decide on a fix: patch + redeploy the contract, or coordinate migration; the
   Contract lead owns this decision.
7. [Phase 6](#phase-6--recover): unpause only after the fix is verified.

### B. "The backend is down or degraded"

1. Declare **SEV2** (or SEV1 if purchases are fully broken).
2. [Phase 4](#phase-4--contain-the-backend-tier): roll back blue/green or scale;
   capture logs first.
3. [Phase 3](#phase-3--contain-the-frontend--edge-tier): if the app is unusable,
   serve the maintenance notice so users get a clear message.
4. Contract tier stays up unless the backend is causing bad on-chain writes.
5. Communicate ETA; recover once `/health` and WebSocket connections are stable.

### C. "DNS / CDN takeover or a malicious frontend fork"

1. Declare **SEV1** — users may be handing credentials/keys to an attacker.
2. [Phase 3](#phase-3--contain-the-frontend--edge-tier): immediately regain
   control of DNS/CDN records, force a safe build, and purge caches. Rotate any
   exposed CDN/registrar credentials.
3. [Phase 5](#phase-5--communicate): loud, clear warning to users NOT to connect
   wallets or sign anything.
4. [Phase 2](#phase-2--contain-the-contract-tier): consider pausing the contract
   until you are sure only the legitimate frontend can reach it.
5. Post-incident: add registry lock / MFA for DNS and CDN; monitor certificate
   transparency for unexpected certs (see
   [ssl-tls-certificate-rotation.md](./ssl-tls-certificate-rotation.md)).

### D. "Suspected admin key compromise"

1. Declare **SEV1**.
2. [Phase 2](#phase-2--contain-the-contract-tier): `pause` **and** begin key
   rotation. Assume the attacker can do anything the key can.
3. Audit recent admin actions on-chain (`set_price`, `transfer_admin`,
   allowlist changes, pauses).
4. Communicate only what is verified; coordinate on-chain as needed.
5. Post-incident: move to a multichain-safe / two-step admin transfer flow and
   hardware-backed keys.

---

## Live incident checklist

Copy this block into the incident channel and tick items as you go.

```text
INCIDENT <id> — <one-line impact>
Severity: SEV<n>   Declared (UTC): <time>   IC: <name>

Roles
[ ] IC            <name>
[ ] Contract lead <name>
[ ] Backend lead  <name>
[ ] Edge lead     <name>
[ ] Comms lead    <name>
[ ] Scribe        <name>

Detect & declare
[ ] Incident declared in channel
[ ] Timeline started (UTC timestamps)
[ ] Roles assigned and acknowledged

Triage
[ ] Tier of origin identified
[ ] Value at risk?  yes / no
[ ] Last change in 24h identified
[ ] Known-good rollback target identified

Contain — contract
[ ] pause or pause_function executed   tx/ledger: <hash>
[ ] is_paused confirmed true
[ ] admin key rotation started (if key suspected)

Contain — frontend / edge
[ ] maintenance notice served at edge
[ ] caches purged (CDN + service worker)
[ ] contract address verified against signed manifest
[ ] previous frontend build restored (if applicable)

Contain — backend
[ ] logs snapshotted before restart
[ ] blue-green rollback / scale-out done
[ ] /health green, WebSockets stable

Communicate
[ ] first public update sent (UTC: <time>)
[ ] status page updated (UTC: <time>)
[ ] update cadence committed: every <n> min
[ ] stakeholders notified

Recover
[ ] fix verified
[ ] contract unpaused (is_paused false)
[ ] frontend restored + caches purged again
[ ] backend on active colour, health green
[ ] monitoring window completed (>= 1 traffic cycle)
[ ] all-clear declared

Post-incident
[ ] postmortem scheduled (<date>)
[ ] follow-up actions filed with owners
[ ] this playbook / runbooks updated
```

---

## Appendix: commands and references

### Quick commands

```bash
# Backend blue-green rollback (see docs/blue-green-deployment.md)
ROLLBACK=true HEALTH_URL=https://<host>/health ./scripts/blue-green-deploy.sh

# Backend health check
curl -fsS https://<host>/health

# TLS certificate issuance / renewal (see docs/ssl-tls-certificate-rotation.md)
chmod +x scripts/setup-ssl.sh && ./scripts/setup-ssl.sh <domain> [email]

# Frontend production build (for a safe redeploy)
npm --prefix frontend ci && npm --prefix frontend run build
```

Contract pause/unpause is performed through the admin UI's `PauseControl`
(with the admin wallet connected) or directly via the Soroban CLI against the
`pause`, `unpause`, `pause_function` and `unpause_function` entrypoints in
`contracts/src/lib.rs`.

### Related documents

- [Blue-Green Deployment](./blue-green-deployment.md) — promote/rollback the
  backend.
- [CloudWatch Incident Runbook](./cloudwatch-incident-runbook.md) — resource
  exhaustion / alarms.
- [CDN Configuration](./cdn.md) — Cloudflare/CloudFront, cache invalidation.
- [Security Policy](../SECURITY.md) and [security.md](./security.md) — reporting
  a vulnerability and the security incident process.
- [Troubleshooting](./troubleshooting.md) — common failures and diagnostics.
- [Contract Address Verification](./contract-address-verification.md) — the
  signed canonical manifest and how the frontend checks it.
- [SSL/TLS Certificate Rotation](./ssl-tls-certificate-rotation.md) — renewing
  and revoking certificates.
