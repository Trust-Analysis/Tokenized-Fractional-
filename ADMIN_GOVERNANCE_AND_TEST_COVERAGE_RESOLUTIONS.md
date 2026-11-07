# Admin Governance and Test-Coverage Resolutions

Resolution notes for the four issues assigned to this contributor.

| Issue | Title | Status in `main` |
| --- | --- | --- |
| [#865](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/865) | `pause`, `unpause`, `delist_asset`, and `emergency_withdraw` bypass the 48-hour admin timelock entirely | **Open** — bypass re-verified against `main`; gating design, error code, tests and the SECURITY.md classification table specified below |
| [#866](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/866) | `delist_asset`'s doc comment claims a "multi-sig admin role" requirement that the implementation does not enforce | **Open** — no contract-level multi-sig exists anywhere; full audit of the `multi-sig` references plus corrected wording below |
| [#803](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/803) | No load test specifically targeting concurrent `buy_shares` calls contending for the last remaining shares | **Open** — contention scenario, assertions and the `docs/performance.md` results template specified below |
| [#808](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/808) | No test confirming graceful shutdown drains in-flight requests without dropping them | **Open** — no shutdown handler exists yet; handler sketch and SIGTERM test specified below |

Two findings worth calling out before the per-issue detail:

- The four functions in #865 are still directly callable, but the auth model
  changed while the issue sat open: [#768](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/768)
  moved `pause`/`unpause` to the **Pauser** role and `emergency_withdraw` to
  the **Treasury** role (`delist_asset` remains admin-only). The bypass is
  unchanged — the role change gates **who** may call, not **via which path**.
- `upgrade()` (`contracts/src/lib.rs:8571`) has the same bypass shape as the
  #865 four: it performs `update_current_contract_wasm` directly and ignores
  the `schedule_upgrade`/`execute_upgrade` timelock. It is included in the
  audit table in the #865 section.

---

## #865 — `pause`, `unpause`, `delist_asset` and `emergency_withdraw` bypass the timelock

### Verified against `main`

| Entry point | Line | Auth checked | Timelock checked |
| --- | --- | --- | --- |
| `pause` | `contracts/src/lib.rs:2680` | `_require_role(PauserRole)` | no |
| `unpause` | `contracts/src/lib.rs:2687` | `_require_role(PauserRole)` | no |
| `delist_asset` | `contracts/src/lib.rs:2827` | `admin.require_auth()` | no |
| `emergency_withdraw` | `contracts/src/lib.rs:2877` | `_require_role(TreasuryRole)` | no |
| `execute_operation` (dispatcher) | `contracts/src/lib.rs:7828` | `admin.require_auth()` | yes — `timestamp >= execute_after` |

`schedule_operation` (`:7801`) stores `execute_after = env.ledger().timestamp() + 172_800`
(48 hours) under `TimelockDataKey::TimelockOp(action)`; `execute_operation`
(`:7828`) verifies the delay and then forwards to the four native functions
with a plain Rust call. Nothing forces callers through `execute_operation`:
the four functions remain `pub fn` entries in `#[contractimpl]` blocks that a
transaction can invoke directly. The frontend already exercises the direct
path (`frontend/src/components/PauseControl/PauseControl.jsx`,
`frontend/src/components/AdminPage/AdminPage.jsx`), so this is not a
theoretical bypass.

### Gating design

**Option A — execution-context flag (recommended).** Keep the four entry
points in the ABI (no frontend breakage), and make them accept only calls
dispatched by `execute_operation`:

```rust
// contracts/src/lib.rs — TIMELOCK MODULE
#[soroban_sdk::contracttype]
pub enum TimelockDataKey {
    TimelockOp(AdminAction),
    /// Set only for the duration of an `execute_operation` dispatch.
    ExecutionContext,
}

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TimelockError {
    NotScheduled = 1,
    TimelockNotExpired = 2,
    AlreadyScheduled = 3,
    /// NEW: direct call to a timelock-guarded entry point.
    DirectCallNotAllowed = 4,
}

/// Revert unless the current call is a nested dispatch from `execute_operation`.
fn _require_timelock_context(env: &Env) {
    let in_ctx: bool = env
        .storage()
        .persistent()
        .get(&TimelockDataKey::ExecutionContext)
        .unwrap_or(false);
    if !in_ctx {
        soroban_sdk::panic_with_error!(env, TimelockError::DirectCallNotAllowed);
    }
}
```

Add `_require_timelock_context(&env);` as the first statement of `pause`,
`unpause`, `delist_asset` and `emergency_withdraw`, and set/clear the flag
around the dispatch in `execute_operation`:

```rust
// in execute_operation, after the delay check and after removing the
// scheduled op from storage:
env.storage()
    .persistent()
    .set(&TimelockDataKey::ExecutionContext, &true);

match action.clone() {
    AdminAction::Pause => RwaMarketplace::pause(env.clone()),
    AdminAction::Unpause => RwaMarketplace::unpause(env.clone()),
    AdminAction::EmergencyWithdraw(to, amount) => {
        RwaMarketplace::emergency_withdraw(env.clone(), to, amount)
    }
    AdminAction::DelistAsset(reason) => {
        RwaMarketplace::delist_asset(env.clone(), reason)
    }
}

// Clear before returning so the context can never leak into a later call
// in the same transaction. A panic anywhere above reverts the flag write
// together with the rest of the transaction, so no stale state persists.
env.storage().persistent().remove(&TimelockDataKey::ExecutionContext);
```

Soroban semantics that make this sound:

- A panic reverts **all** state written by the transaction, including the
  flag set in `execute_operation`, so a failed dispatch can never leave the
  contract in "timelock executing" mode.
- `execute_operation` removes the scheduled operation **before** dispatch, so
  a re-entrant dispatch of the same action cannot occur while the flag is set.
- `emergency_withdraw` keeps its existing re-entrancy guard; the flag does not
  weaken it.

**Option B — remove the entry points from the contract ABI** (make them
private helpers reachable only through internal calls). This is the cleanest
security boundary, but it is a breaking interface change: the frontend
`PauseControl`/`AdminPage` components and existing tests call `pause` and
`unpause` directly, and the issue explicitly allows the flag variant. Not
recommended for the immediate fix; can be revisited once the frontend calls
the `schedule_operation`/`execute_operation` flow.

### Authority model for `schedule_operation` / `execute_operation`

Both currently accept an `admin: Address` argument and require its auth. Under
the default deployment (roles seeded to admin) the nested role checks pass.
Under role separation (`Pauser`/`Treasury` set to distinct addresses) a nested
`pause()` call performed by the admin would require the **Pauser's** auth in
the same transaction, so the dispatch would fail unless the role holder also
signs. To make the semantics explicit and deliberate, resolve the authority
per action in both functions:

| `AdminAction` | Required authority |
| --- | --- |
| `Pause`, `Unpause` | `PauserRole` holder |
| `EmergencyWithdraw` | `TreasuryRole` holder |
| `DelistAsset` | `Admin` |

The inner functions keep their own checks (defense in depth): the same address
that authorised the top level also satisfies the nested check. Document the
resulting rule in SECURITY.md: *sensitive operations are authorised by the
duty-holder of the affected surface and can only take effect 48 hours after
they are scheduled.*

### Tests to add

Extend `mod timelock_tests` in `contracts/src/lib.rs` (the four existing
tests assert the happy path; none of them assert that a **direct** call now
reverts):

1. `direct_pause_reverts` — `client.pause()` without scheduling panics with
   `TimelockError::DirectCallNotAllowed`.
2. `direct_unpause_reverts`
3. `direct_emergency_withdraw_reverts` — the explicit acceptance criterion.
4. `direct_delist_asset_reverts` — also asserts the asset is **not** delisted
   after the failed call (`is_delisted() == false`, trading still open).
5. `scheduled_pause_still_executes_after_delay` — extending `test_timelock_delay`.
6. `scheduled_emergency_withdraw_executes` — funds move only through the
   timelock path; assert recipient balance delta.
7. `scheduled_delist_asset_executes_and_cancels_orders` — covers the
   irreversible path, including escrowed-order refunds.
8. `role_separated_execution_requires_role_authority` — with a distinct
   Pauser/Treasury address, `execute_operation` with only admin auth reverts;
   with the role holder's auth it succeeds.
9. `execution_context_is_cleared` — after a successful `execute_operation`, a
   second direct call still reverts (proves no flag leak) and a fresh
   schedule → execute cycle succeeds.

### SECURITY.md — timelocked or not (acceptance criterion 3)

Add the following classification to `SECURITY.md`. "Timelocked" means the
entry point is mechanically gated by `execute_operation` after this fix;
"direct" means it stays callable with auth alone, by design.

**Timelocked (must be, per this issue):**

| Entry point | Authority | Action wrapper |
| --- | --- | --- |
| `pause` / `unpause` | Pauser role | `AdminAction::Pause` / `Unpause` |
| `emergency_withdraw` | Treasury role | `AdminAction::EmergencyWithdraw` |
| `delist_asset` | Admin | `AdminAction::DelistAsset` |

**Recommended to become timelocked (flagged findings, same bypass shape):**

| Entry point | Line | Why |
| --- | --- | --- |
| `upgrade` | `:8571` | Direct `update_current_contract_wasm`, bypassing the `schedule_upgrade`/`execute_upgrade` timelock (default ~100 ledgers, `set_upgrade_timelock`). Either delete it in favour of the scheduled path or gate it with the same context flag. |
| `update_price` / `set_price` | `:3435` / `:3348` | Changes the price paid by buyers in `buy_shares`. |
| `increase_total_shares` / `set_total_shares` | `:3489` / `:3373` | Dilutes supply / changes distribution. |
| `transfer_admin` | `:8537` | Ownership transfer (mitigated by the two-step `accept_admin` pattern of #638). |
| `wind_down` | `:2767` | Irreversible market closure (#766). |
| `burn_shares` | `:2784` | Destroys holder shares; compliance action, irreversible. |

**Intentionally direct** (operational configuration; reversible; no immediate
fund movement): role assignment (`set_pauser`, `set_treasury`,
`set_metadata_manager`), whitelist/allowlist management, accepted payment
tokens (`add_payment_token`, `remove_payment_token`, `update_payment_token`),
purchase limits, transfer restrictions/fees, metadata (`set_metadata_uri`,
`set_nft_contract`), dividend configuration (`set_dividend_policy`,
`set_dividend_schedule`, `distribute_dividends`, `deposit_distribution`),
oracle configuration (`set_oracle`, `clear_oracle`), circuit-breaker controls
(`configure_circuit_breaker`, `trigger_circuit_breaker`,
`reset_circuit_breaker`), per-function pause (`pause_function`,
`unpause_function`), snapshot/recovery controls, and `set_upgrade_timelock`.

The SECURITY.md table should state the rule as well as the lists: *if an entry
point can irreversibly move funds, change ownership, or permanently halt
trading, it must be reachable only through the 48-hour timelock; everything
else is direct and reversible, and monitoring should lean on the emitted
events.*

---

## #866 — `multi-sig` claims in the contract are not backed by code

### Audit result

`grep -in "multi-sig\|multisig" contracts/src/lib.rs` returns exactly four doc
comments; none of them is backed by any multi-signature, threshold or
multiple-approver logic in the file (or elsewhere under `contracts/`):

| Line | Location | Claim |
| --- | --- | --- |
| `:529` | `EventAssetDelisted` doc comment | "delisted by the **multi-sig admin role**" |
| `:2820` | `delist_asset` doc comment | "Requires the **multi-sig admin role**" |
| `:2826` | `delist_asset` doc comment | "(`AdminAction::DelistAsset`) which enforces **multi-sig approval**" |
| `:7781` | `AdminAction::DelistAsset` doc comment | "restricted to the **multi-sig** / timelock-guarded admin flow" |

`delist_asset` reads a single `DataKey::Admin` address and calls
`admin.require_auth()` (`:2830`). A single keypair — or, at the network layer,
a single signature from that account — is sufficient to halt all trading.

### Recommended resolution: correct the wording (acceptance option 2)

Implementing genuine in-contract threshold multi-sig is a real design change
(storage for proposals and approval sets, a threshold config, replay
protection and a new public surface). The wording is the actual defect here:
the behaviour is single-key, and the contract has a **single-admin-key**
reality that the comments should state plainly. On Stellar there is also a
legitimate network-level route to multiple approvals: the admin **address**
can be a Stellar account configured with multisig thresholds
(`setOptions`-style signer weights). The network then enforces the threshold
on every `require_auth()` the contract performs, with no contract change at
all. The corrected comments should say exactly that.

Proposed replacement text (to be applied verbatim):

`EventAssetDelisted` (`:529`):

```rust
/// Emitted when an asset is permanently delisted by the admin (Issue #570).
/// Carries the number of open sell orders that were cancelled so off-chain
/// indexers can reconcile the order book.
```

`delist_asset` (`:2820-2826`):

```rust
/// Permanently delist the asset and halt all trading immediately.
///
/// Requires authorisation from the single admin address stored under
/// `DataKey::Admin`. This is destructive and irreversible: it sets the global
/// pause flag so no buys/sells/transfers can execute, then cancels every open
/// sell order in the order book, returning the escrowed shares to each seller
/// so they can withdraw their frozen funds.
///
/// The contract itself does not implement an on-chain multi-signature scheme.
/// To require multiple approvals, configure the admin address as a Stellar
/// account-level multisignature account; the network then enforces the
/// threshold on every `require_auth()` this contract performs.
///
/// Reachable directly and through the timelocked `AdminAction::DelistAsset`
/// operation; see SECURITY.md for the timelock status of this and every other
/// admin entry point.
```

`AdminAction::DelistAsset` (`:7781-7784`):

```rust
/// Permanent emergency asset delisting (Issue #570), executable through the
/// 48-hour timelock (`schedule_operation` / `execute_operation`).
```

If the wording is corrected together with #865, adjust the last paragraph of
`delist_asset` to "Reachable **only** through the timelocked
`AdminAction::DelistAsset` operation".

### If maintainers prefer the code route (acceptance option 1)

Outline only: add `DataKey::DelistApprovers(Vec<Address>)` and
`DataKey::DelistThreshold(u32)` (admin-configured), a `propose_delist` entry
point storing the pending proposal, an `approve_delist` entry point that
requires each approver's auth and records it once, and execute the existing
delist body when `approvals.len() >= threshold`. This composes with the
timelock: approvals accumulate first, then `schedule_operation` →
`execute_operation` applies the 48-hour delay. Costs: new storage keys, new
entry points, threshold-change governance questions, and its own test matrix —
which is why correcting the wording is the recommended resolution here.

---

## #803 — last-share contention load test for `buy_shares`

### Current state

- The Artillery suite (`load-test/`) covers the **backend** HTTP/WebSocket
  surfaces only; it cannot exercise `buy_shares`, which lives on-chain.
- The on-chain driver `load-test/scripts/soroban-order-matching.js` loads
  `place_sell_order` + `buy_from_order` (the order book), with no contention
  scenario and no per-buyer outcome classification.
- `docs/performance.md` has gas-cost tables but no concurrency/contention
  results.

### Tooling choice

The issue says "e.g. via k6"; the repository's established load tooling is
Artillery for HTTP and `@stellar/stellar-sdk` scripts for on-chain traffic.
The contention scenario must drive `buy_shares` through Stellar RPC, so it
belongs in a script next to `soroban-order-matching.js` (k6 would add a second
load-generator stack for no benefit here). Recommendation: add
`load-test/scripts/last-share-contention.js`, sharing the argument/env
conventions of the existing driver (`SOROBAN_CONTRACT_ID`, `SOROBAN_RPC_URL`,
`SOROBAN_TRADER_SECRET`, `--dry-run`).

### Scenario

1. **Setup (on testnet against a deployed contract):**
   - Fund `BUYERS = 50` distinct keypairs; establish payment-token trustlines
     and balances; whitelist them if the allowlist is enabled (or run with it
     disabled).
   - Configure `AvailableShares = 1` (mint `total - 1` to a setup account
     first, or `init` with a supply of 1).
   - Assert preconditions via read calls: `get_available_shares() == 1`,
     marketplace not paused/closed, price set.
2. **Burst:** each buyer builds, simulates, signs and sends a
   `buy_shares(buyer, 1, payment_token, max_price)` invocation. Submissions
   are fired together (`Promise.allSettled`), accepting that Soroban RPC
   assigns ledger inclusion; record `sendLedgerLowerBound` per tx.
3. **Outcome classification** (the core deliverable):
   - `SUCCESS` — tx applied; contract state changed.
   - `CONTRACT_REJECTION` — tx applied and failed with
     `"Not enough shares available for purchase"` (`contracts/src/lib.rs:1449`).
   - `INFRASTRUCTURE` — submission-level noise (`txBAD_SEQ`, fee, timeout).
     Any `INFRASTRUCTURE` outcome fails the run: contention must be decided by
     contract state, not client races.
4. **Assertions:**
   - `SUCCESS count == 1` (exactly the remaining pool).
   - `CONTRACT_REJECTION count == 49`.
   - Post-state: `get_available_shares() == 0`; exactly one buyer holds 1
     share; total held balance equals the original supply; no buyer holds
     more than 1.
   - **Backend eventual consistency:** poll the off-chain projection (the
     metadata/reconciliation surface that runs the data.json-vs-on-chain
     digest, see `backend/consistency.js` and the drift test in
     `.github/workflows/backend-docs-and-data-integrity.yml`) with a bounded
     timeout and assert it converges to the on-chain post-state — the
     "eventual metadata sync" clause of the issue.
5. **Metrics:** per-attempt submit→confirm latency (p50/p95/p99), ledger of
   each outcome, wall-clock time from first submission to final rejection.

### `docs/performance.md` results section

Add, under the contract benchmarks, a subsection with the filled table
(example shape; values to be produced by the first live run):

```markdown
### Concurrent buy_shares — last-share contention (Issue #803)

Setup: 1 share available, 50 concurrent buyers (1 share each), Soroban testnet.
Run: <date>, commit <sha>, `load-test/scripts/last-share-contention.js`.

| Metric | Result |
|---|---|
| Successful purchases | 1 (expected: 1) |
| Contract rejections (`Not enough shares available for purchase`) | 49 (expected: 49) |
| Unexpected submission failures | 0 |
| Available shares after burst | 0 |
| Backend metadata converged | yes, within <n> s |
| Submit→confirm latency p50 / p95 / p99 | <ms> / <ms> / <ms> |
```

The document should also record the interpretation the issue asked for:
*exactly* one purchase succeeds because Soroban applies transactions
sequentially against the evolving contract state, so every buyer after the
first sees `AvailableShares = 0` and reverts deterministically — the behaviour
is predictable under genuine concurrency, not just in the two-transaction
unit test.

---

## #808 — graceful-shutdown drain test

### Current state

Verified: there is **no** shutdown handling in the backend.

- `backend/index.js:2060` — `const httpServer = app.listen(PORT, ...)` inside
  the `NODE_ENV !== 'test'` guard.
- `backend/index.js:2094` — a second, legacy `app.listen` under
  `require.main === module`.
- No `process.on('SIGTERM'|'SIGINT')` handler and no `server.close()` call
  anywhere under `backend/`.

The issue is precise that the test is blocked on the handler ("wire this test
into CI once graceful shutdown handling is implemented"), so the resolution
is two-part.

### Handler sketch (prerequisite)

```js
// backend/index.js — after both listen paths are consolidated
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');

  // Stop accepting new connections; the callback fires when the last
  // in-flight request has finished. Existing keep-alive sockets are closed
  // first so they cannot stall the drain.
  const drained = new Promise((resolve) => httpServer.close(resolve));
  httpServer.closeIdleConnections?.();

  await Promise.race([
    drained,
    new Promise((r) => setTimeout(r, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000))),
  ]);

  try { wsManager.close?.(); } catch { /* already closed */ }
  try { await closeRedisAdapter?.(); } catch { /* not configured */ }
  try { await closeDatabase?.(); } catch { /* not configured */ }

  logger.info({ signal }, 'graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
```

Notes: the hard timeout is a fallback only (exit non-zero if it fires);
`closeAllConnections()` must not be used before the drain because it would
terminate the in-flight requests the issue wants preserved.

### Test specification — `backend/__tests__/gracefulShutdown.test.js`

1. Spawn a real server child process (`node index.js`), `NODE_ENV` **not**
   `test` (that value skips `listen`), on an ephemeral port.
2. Wait for readiness (`GET /health` returns 200).
3. Start a **slow in-flight request**. To make a real request slow
   deterministically, add a test-only middleware in `index.js`, gated by an
   env var (e.g. `X-Test-Delay-Ms` honoured only when
   `ENABLE_TEST_DELAY=1`); the production build is unaffected.
4. While that request is in flight, `child.kill('SIGTERM')`.
5. Assert:
   - the in-flight response still resolves with its full body (**not**
     truncated, not `ECONNRESET`);
   - requests started *after* SIGTERM are refused (connection error), proving
     the listener stopped accepting;
   - the child exits within `SHUTDOWN_TIMEOUT_MS` with code 0.
6. Wire into CI once the handler lands: add a job/step running
   `npx jest --forceExit __tests__/gracefulShutdown.test.js` (backend working
   directory) in `.github/workflows/backend-docs-and-data-integrity.yml` or
   `.github/workflows/pr.yml`, matching the pattern used by the other
   backend test gates.

The test must fail against the current code (default SIGTERM termination
kills the child immediately, and the in-flight request is dropped), which is
exactly the regression guard the issue asks for.

---

## Note on scope

This PR is documentation only, per the agreed approach. Of the four:

- **#866 is substantively resolvable as documentation** — the audit above
  identifies every inaccurate comment and supplies the corrected wording.
- **#865's fix** is specified to the level of code snippets, error codes,
  the authority model and the nine tests, plus the SECURITY.md classification
  table required by its third acceptance criterion.
- **#803 and #808 still require test code** (#808 also requires the shutdown
  handler itself). Both specs are written so the follow-up implementation
  PRs are mechanical: script/test skeletons, assertions and CI wiring are
  pinned down above.
