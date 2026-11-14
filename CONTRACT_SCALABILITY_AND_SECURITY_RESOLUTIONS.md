# Contract Scalability & Security — Resolutions for Issues #864, #867, #868, #869

Documentation-only resolution of the four open contract issues assigned to this work.
Every finding below was verified against `main` at commit `6a4c76e` (current head at
the time of writing). No code files are touched by this change: each section records
the verified current behaviour with exact file/line references, the agreed fix, the
acceptance-criteria mapping, and the exact tests required to close the issue, so the
follow-up implementation PRs are mechanical.

| Issue | Area | Severity | Affected code |
| ----- | ---- | -------- | ------------- |
| [#869](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/869) | Dividend distribution scalability | High | `contracts/src/lib.rs` — `distribute_dividends` (`:1854`) |
| [#868](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/868) | Holder registry scalability | High | `contracts/src/lib.rs` — `register_holder` (`:2185`), `get_holders` (`:2470`) |
| [#867](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/867) | Auto-buyback budget vs. payout price | High | `contracts/src/lib.rs` — `process_auto_buyback` (`:4566`), `buyback_shares` (`:4458`) |
| [#864](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/864) | Bridge proof is unverified | Critical | `contracts/src/lib.rs` — `unlock_from_bridge` (`:8673`) |

Test infrastructure the plans below plug into:

- `contracts/tests/resource_benchmarks.rs` — CPU-budget fixtures (`fixture` `:21`,
  `benchmark_buy_shares_state_change` `:40`,
  `benchmark_dividend_distribution_scales_with_holders` `:81`).
- `contracts/tests/dividend_e2e_tests.rs` / `dividend_integration_tests.rs` — full
  dividend flows through the public client (`RwaMarketplaceClient`).
- `contracts/src/lib.rs` — `mod oracle_bridge_tests` (`:8730`) covers oracle price
  selection and the bridge lock/unlock surface (zero-proof rejection `:8931`).
- `docs/architecture.md` — storage layout documentation (`:44`).

Reference pattern already used in this codebase for bounded iteration:
`get_vesting_history(env, owner, start_idx, limit)` (`:2453-2457`) and
`get_transfer_history(index)`.

---

## #869 — Paginate `distribute_dividends` with a distribution round accumulator

### Verified state

`distribute_dividends` (`contracts/src/lib.rs:1854`):

- Reads the **entire** `DataKey::Holders` vector into memory (`:1878-1881`).
- Loops every holder in one transaction (`:1883-1930`), performing a cross-contract
  `client.transfer(&contract_addr, &holder, &raw_amount)` inline for non-accruing
  holders, accruing into `DividendPosition` for accruing holders.
- Rewrites the full holder registry at the end (`:1942`) and emits one
  `EventDistributeDividends` with the final `holder_count`.
- Has **no** `start_idx`/`limit`/batching parameters — unlike
  `get_vesting_history(env, owner, start_idx, limit)` (`:2453`) which already
  demonstrates the pagination pattern this codebase accepts.

The same unbounded loop is duplicated in `process_scheduled_dividend` (`:2517`,
holders read `:2555-2556`, registry rewrite `:2618`).

Existing benchmark `benchmark_dividend_distribution_scales_with_holders`
(`contracts/tests/resource_benchmarks.rs:81`) tops out at **32 holders** — far below
the "thousands" scale at which the transaction resource budget becomes the failure
mode described in the issue.

### The problem in resource terms

For a holder base of `n`, one call costs:

- `n` persistent storage reads (`DataKey::Balance`),
- up to `n` cross-contract token transfers,
- and a full-registry instance-storage rewrite.

Soroban enforces per-invocation CPU-instruction and read/write-entry budgets, so past
some `n` the call aborts permanently — dividend distribution silently stops working
exactly for the most widely-held, most successful assets.

### Proposed fix — `distribute_dividends_batch` with a round accumulator

New storage and constant:

```rust
/// Maximum holders processed per batch call.
const MAX_DIVIDEND_BATCH: u32 = 50;

#[contracttype]
#[derive(Clone)]
pub struct DividendRound {
    pub token: Address,
    pub total_amount: i128,        // total being distributed this round
    pub total_shares: u32,         // TotalShares snapshot taken when the round started
    pub holder_count_at_start: u64,// registry length snapshot (indices never shift mid-round)
    pub cursor: u64,               // next holder index to process
    pub paid: i128,                // running sum of amounts paid/accrued
    pub started_at: u64,
}
```

`DataKey` additions: `DividendRound` (`Option<DividendRound>`).

Implementation sketch:

```rust
/// Start or continue a paginated pro-rata dividend distribution.
/// First call creates the round (snapshotting TotalShares and the registry
/// length); later calls must present the same (token, total_amount) and
/// resume from the stored cursor. Completing call prunes zero-balance
/// holders once and emits the historical EventDistributeDividends.
pub fn distribute_dividends_batch(env: Env, token: Address, total_amount: i128, limit: u32) {
    // 1. admin.require_auth(); pause check (FN_DIVIDEND); total_amount > 0;
    //    1 <= limit <= MAX_DIVIDEND_BATCH.
    // 2. Load or create the round:
    //    - existing round: panic unless (token, total_amount) match, so a
    //      second distribution cannot interleave with an active round.
    //    - new round: snapshot TotalShares and holders.len().
    // 3. end = min(cursor + limit, holder_count_at_start)
    //    for i in cursor..end:
    //      - skip zero-balance holders (no registry rewrite mid-round)
    //      - keep the exact pro-rata + accrual/transfer logic of
    //        distribute_dividends (:1883-1930)
    //      - round.paid += raw_amount
    // 4. If cursor < holder_count_at_start:
    //      store the round, emit a per-batch progress event
    //      (EventDividendBatchProgress { cursor, holder_count }).
    //    Else (round complete):
    //      rebuild the registry once (same pruning semantics as :1942),
    //      emit EventDistributeDividends once with total_amount and the
    //      final holder_count, remove DataKey::DividendRound.
}

pub fn get_active_dividend_round(env: Env) -> Option<DividendRound> { /* read-only */ }
```

Design decisions worth pinning in the implementation PR:

- **Snapshot semantics.** A round spans multiple transactions, so holders registered
  after the round starts are *not* paid by it (documented behaviour; the previous
  single-transaction version had the same property because it observed one registry
  state). `holder_count_at_start` also guarantees indices never shift while batching.
- **Registry pruning happens once, at completion** — pruning mid-round would invalidate
  the cursor.
- **Rounding dust** (`Σ floor(total_amount × shares_i / total_shares)` ≤ `total_amount`)
  remains in the contract, unchanged from today; `paid` and `get_active_dividend_round`
  make the residual auditable.
- **`distribute_dividends` compatibility.** Keep the current entry point for small
  registries, but gate it (`holder_count <= MAX_DIVIDEND_BATCH`) or deprecate it in
  favour of the batch variant; `process_scheduled_dividend` should delegate to the same
  round machinery in a follow-up.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Add a paginated/batched variant … with an accumulator tracking distribution progress" | `distribute_dividends_batch` + `DividendRound` above |
| "Add a gas/resource benchmark test … at a realistic large holder count" | Benchmark plan below (extend `resource_benchmarks.rs`) |
| "Document the current holder-count limitation prominently until the batched version ships" | Verbatim note text below |

Documentation note to add to `README.md` and `docs/architecture.md` (until the batched
variant ships):

> **Holder-count limitation.** `distribute_dividends` processes the full holder
> registry in a single transaction. Beyond a few hundred holders it will exceed
> Soroban's per-transaction resource budget and revert. Use
> `distribute_dividends_batch` (bounded, resumable) for large registries.

### Test plan

Extend `contracts/tests/resource_benchmarks.rs`:

```rust
#[test]
fn benchmark_distribute_dividends_batch_bounded_per_call() {
    // Seed N holders once (N in [64, 256]; 1024 becomes practical after #868
    // lands, since seeding via buy_shares is currently O(n²) due to the linear
    // registry scan — see #868).
    // Then run a full round in batches of 25 and print, per call:
    //   BENCHMARK name=distribute_dividends_batch holders=N limit=25 cpu=…
    // Assert per-batch CPU stays under a fixed ceiling independent of N
    // (i.e. cost is O(limit), not O(holder_count)).
}
```

Add to `contracts/tests/dividend_e2e_tests.rs`:

- round continuity: batch 1 with `(token, amount)` then batch 2 with different
  `total_amount` → reverts "Active dividend round has different parameters".
- limit bounds: `limit = 0` and `limit > MAX_DIVIDEND_BATCH` revert.
- completion: after ⌈n/limit⌉ calls `get_active_dividend_round` is `None`, the
  `EventDistributeDividends` fires exactly once with the correct `holder_count`, and
  every non-accruing holder received `floor(total_amount × shares_i / total_shares)`.
- conservation: sum of payouts ≤ `total_amount`; accrual-policy holders get
  `DividendPosition` entries instead of transfers.
- zero-balance holders are skipped but do not break cursor arithmetic; registry prune
  happens only on the completing call.

---

## #868 — Replace the unbounded `Holders` vector with an O(1) holder registry

### Verified state

`register_holder` (`contracts/src/lib.rs:2185-2198`) on every successful purchase:

1. loads the entire `DataKey::Holders` vector from **instance** storage (`:2186-2189`),
2. linearly scans it (`for holder in holders.iter()`),
3. pushes the buyer and rewrites the whole vector (`:2197`).

Call sites (each one pays the O(n) read/scan/rewrite): `buy_shares` `:1510`,
`fill_sell_order` `:2327`, transfer paths `:3935`/`:4050`, batch purchase `:4192`,
batch path `:4309`, and `:4930`. Full-registry reads also occur in
`_assert_no_outstanding_unclaimed` (`:911`), `distribute_dividends` (`:1878`),
`get_holders` (`:2470`) and `process_scheduled_dividend` (`:2555`).

Because instance storage is loaded into the invocation footprint on every call that
touches it, a growing registry increases the cost of every future `buy_shares` —
eventually exceeding the transaction resource budget and bricking sales of the most
successful assets.

### Proposed fix — persistent O(1) registry with paginated enumeration

New `DataKey` variants:

```rust
/// O(1) membership flag, persistent storage.
IsHolder(Address),
/// Append-only holder list: HolderAt(i) = i-th registered address.
HolderAt(u64),
/// Number of entries in HolderAt (instance storage, single counter).
HolderCount,
/// One-time migration marker from the legacy Holders vector.
HoldersMigrated,
```

New `register_holder` (O(1), single persistent read + two writes):

```rust
fn register_holder(env: &Env, owner: Address) {
    let flag = DataKey::IsHolder(owner.clone());
    if env.storage().persistent().get(&flag).unwrap_or(false) {
        return; // already registered — no scan
    }
    env.storage().persistent().set(&flag, &true);

    let count: u32 = env.storage().instance().get(&DataKey::HolderCount).unwrap_or(0);
    env.storage().persistent().set(&DataKey::HolderAt(count as u64), &owner);
    env.storage().instance().set(&DataKey::HolderCount, &checked_add_u32(count, 1));

    EventHolderRegistered { holder: owner, index: count as u64 }.publish(env);
}
```

Design decisions:

- **Enumeration without the vector.** `get_holders` (`:2470`) is replaced by
  `get_holders_paginated(start_idx: u64, limit: u32) -> Vec<Address>` reading
  `HolderAt`. Off-chain indexers additionally get a `EventHolderRegistered` stream
  (the "paginated, off-chain-indexed approach" from the issue).
- **Zero-balance holders stay registered.** The current registry doubles as a
  prune-zero-balances list in dividend flows (`:1942`, `:2618`). Under the new model
  the registry is an append-only "ever registered" set; dividend logic already skips
  zero balances per holder and no longer needs to rewrite the registry.
- **One-time migration.** Admin-only `migrate_holder_registry()` walks the legacy
  `Holders` vector once, writes `IsHolder`/`HolderAt`/`HolderCount`, removes the legacy
  entry, and sets `HoldersMigrated = true` (idempotent; no-op if already set).
  Holder-dependent paths assert `HoldersMigrated` until then
  (`_require_holder_registry()`) so a half-migrated state cannot be observed.
- **Call-site impact:** all `register_holder` callers keep their current signature;
  `distribute_dividends`/`distribute_dividends_batch` iterate
  `HolderAt(0..holder_count_at_start)`; `_assert_no_outstanding_unclaimed` reads
  `HolderCount` and paginates instead of loading the full vector.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Replace the unbounded `Vec<Address>` … O(1) persistent flag … paginated, off-chain-indexed enumeration" | `IsHolder` + `HolderAt` + `HolderCount` design above |
| "Benchmark/gas test measuring `buy_shares` cost as holder count scales into the thousands" | Benchmark plan below |
| "Document the holder-count ceiling clearly in `docs/architecture.md`" | Storage-layout section update; ceiling removed by design |

### Test plan

Unit tests (extend the contract's `[cfg(test)]` modules):

- first purchase sets `IsHolder` and appends `HolderAt(0)`; repeat purchase does not
  duplicate (`HolderCount` unchanged).
- transfers to fresh addresses register recipients (covers `:3935`/`:4050` sites).
- `get_holders_paginated` boundaries: `start=0`, mid-page, `start >= count` → empty,
  `limit` clamped to a documented maximum.
- migration: correct flags/order after `migrate_holder_registry()`; second call is a
  no-op; holder-dependent ops revert before migration.
- `HolderCount` always equals the number of `IsHolder == true` entries after mixed
  buys/transfers/migration.

Benchmark (extend `contracts/tests/resource_benchmarks.rs`):

```rust
#[test]
fn benchmark_buy_shares_scales_with_holder_count() {
    for n in [32u32, 128, 512] {
        // Pre-seed n holders (after migration, seeding is O(1) per holder),
        // then measure a single buy_shares CPU cost:
        //   BENCHMARK name=buy_shares holder_count=n cpu=…
        // Assert the per-call cost is effectively flat as n grows
        // (O(1) registry) instead of linear (current behaviour).
    }
}
```

### Documentation update

`docs/architecture.md` storage layout (`:44`) gains the new keys and the migration
note; the proposed "Holder-count limitation" note from #869 is replaced by the
registry-side wording once this ships.

---

## #867 — Auto-buyback budget must use the same price source as the payout

### Verified state

`process_auto_buyback` (`contracts/src/lib.rs:4566`):

- computes its cost from the **static** stored price (`:4592-4595`):
  `env.storage().instance().get(&DataKey::PricePerShare)`,
- validates it against `DataKey::BuybackBudget` (`:4603-4607`) and debits the budget by
  that amount (`:4613`),
- then delegates to `Self::buyback_shares(env, seller, amount)` (`:4616-4619`).

`buyback_shares` (`:4458`) prices the payout independently via
`_get_current_price(&env)` (`:4494`), which returns the **oracle** price whenever
`DataKey::OracleAddress` is configured (`_get_current_price` at `:1188-1194`).

So with an oracle configured, the budget is debited using `PricePerShare` while the
seller is paid using the oracle price — when the oracle runs higher, the contract
silently overpays relative to the admin-configured budget; when lower, it underpays the
seller. Both are real accounting defects; the overpay direction drains funds beyond the
allocated buyback budget.

### Proposed fix — compute the price exactly once and pass the cost through

Refactor the payout core so the debited and paid amounts are the **same value by
construction**, not by convention:

```rust
/// Shared payout core. `total_cost` was validated/debited by the caller.
fn _buyback_shares_at_cost(env: Env, seller: Address, amount: u32, total_cost: i128) {
    // seller.require_auth(); pause checks; _require_unlocked;
    // balance check; mark reentrancy guard; transfer exactly `total_cost`;
    // decrement balance; return shares to the pool; emit EventBuybackShares.
}

pub fn buyback_shares(env: Env, seller: Address, amount: u32) {
    let price = _get_current_price(&env);
    let total_cost = checked_mul_i128(price, amount as i128);
    Self::_buyback_shares_at_cost(env, seller, amount, total_cost);
}

pub fn process_auto_buyback(env: Env, seller: Address, amount: u32) {
    // …interval / max_amount checks unchanged…
    let price: i128 = _get_current_price(&env); // same source as the payout
    let total_cost = checked_mul_i128(price, amount as i128);
    // budget check + debit of exactly total_cost (unchanged lines, one variable)
    Self::_buyback_shares_at_cost(env, seller, amount, total_cost);
}
```

Notes:

- Within a single invocation both reads occur in the same transaction/ledger, so the
  defect is *purely* the two different sources (`PricePerShare` vs. oracle). Taking the
  price once and threading `total_cost` through removes any future possibility of
  check/payout drift.
- Minimal acceptable alternative: change `:4592-4595` to `let price =
  _get_current_price(&env);`. The refactor is preferred because it also removes the
  duplicated pricing logic between the two entry points.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Use the same price source (ideally `_get_current_price`, consistently) for both the budget check/debit and the payout" | Single `_get_current_price` read threaded into `_buyback_shares_at_cost` |
| "Add a test configuring an oracle with a price different from `PricePerShare` and asserting the budget is debited by the same amount actually paid" | Tests below |

### Test plan

New tests in `oracle_bridge_tests` / a new `auto_buyback_oracle_tests` module:

- `test_auto_buyback_uses_oracle_price_for_budget`: init with `PricePerShare = 100`,
  configure oracle returning `250`, `auto_buyback_config(budget = 10_000)`, call
  `process_auto_buyback(seller, 10)` → seller token balance +2_500,
  `BuybackBudget == 7_500`, contract token balance −2_500.
- `test_auto_buyback_budget_debit_equals_payout`: assert
  `budget_before - budget_after == contract_balance_before - contract_balance_after ==
  seller_balance_after - seller_balance_before`.
- oracle-below-stored case (`oracle = 40`, stored `100`) → pays 400, debits 400 —
  underpayment direction also covered.
- regression: no oracle configured → both paths use `PricePerShare` (existing
  behaviour preserved); budget still enforced.

---

## #864 — `unlock_from_bridge` accepts an unverified proof

### Verified state

`unlock_from_bridge` (`contracts/src/lib.rs:8673`) checks only:

1. `amount > 0`,
2. the proof is not the all-zero sentinel (`:8680-8683`),
3. the caller has enough `BridgeLocked` balance (`:8686-8690`).

Authorization is solely `user.require_auth()` — the caller's own signature. There is
**no** verification of the proof against a relayer signature, oracle attestation,
merkle root, or any counterparty-chain source of truth: `grep -i relayer` finds exactly
one doc comment (`:8666`), and no consumed-proof storage key exists anywhere in the
contract. `lock_for_bridge` (`:8624`) likewise proves nothing beyond its own auth.

Consequences (all reachable today):

- `lock_for_bridge(amount)` followed by `unlock_from_bridge(amount, any_nonzero_bytes)`
  is a no-op round trip with no bridging ever happening.
- `EventUnlockFromBridge` can be fabricated by any user, which off-chain consumers
  trusting that event would treat as real completion on the counterparty chain.

### Proposed fix — relayer-attested unlock with replay protection

This keeps the current interface shape (bytes32 proof) while adding real verification.
The proof is defined as the **counterparty-chain lock identifier**, and unlock requires
a designated relayer's signature over a payload that binds the user, amount and proof.

1. **Proof semantics (acceptance #1):** `proof` = 32-byte identifier of the lock event
   on the other chain (e.g. the counterparty tx hash). The relayer attests, in one
   signature, that the lock happened and that the unlock is authorised:

   ```text
   payload = sha256("rwa-bridge-unlock:v1" || user || amount_le_u32 || proof)
   ```

   Binding `amount` prevents unlocking more than the attested lock; binding `user`
   prevents redirecting someone else's unlock; the domain tag prevents cross-protocol
   signature reuse.

2. **New storage:**

   ```rust
   /// Designated cross-chain relayer public key (admin-set).
   BridgeRelayer(Address),
   /// Consumed proof: replay protection.
   UsedProof(BytesN<32>),
   ```

   Admin-only `set_bridge_relayer(relayer)` / `get_bridge_relayer()`, emitting an
   event; unlock reverts when no relayer is configured.

3. **Entry point and verification:**

   ```rust
   pub fn unlock_from_bridge(
       env: Env,
       user: Address,
       amount: u32,
       proof: BytesN<32>,
       relayer_signature: BytesN<64>,
   ) {
       user.require_auth(); // destination consent

       // 1. amount > 0; proof != zero; relayer configured.
       // 2. payload = sha256(domain_tag || user || amount || proof) via env.crypto().
       // 3. relayer.require_auth() AND
       //    env.crypto().ed25519_verify(&relayer, &payload, &relayer_signature);
       //    (Both: the explicit relayer auth documents intent, the signature
       //     carries the attestation and binds the parameters.)
       // 4. Replay: panic "Proof already used" if UsedProof(proof) exists;
       //    set UsedProof(proof) = true BEFORE crediting (CEI).
       // 5. locked >= amount; decrement BridgeLocked; _settle_distribution;
       //    credit Balance; emit EventUnlockFromBridge.
   }
   ```

4. **Forward compatibility:** the entry point stays the same if the verification is
   later upgraded to a merkle/light-client proof of the counterparty log (swap the
   verifier, keep the signature); document this in the function doc comment, replacing
   the current "e.g., a merkle proof hash" text which no code honours today.

5. **Release note:** the new `relayer_signature` parameter is a breaking change for
   SDK/frontend callers; bump the contract version (`contractmeta! version`) and update
   consumers in the same release. The zero-proof sentinel check stays as a cheap
   malformed-input guard.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Define what `proof` is actually supposed to attest to … implement real verification" | Point 1 + ed25519 verification against the relayer (point 3) |
| "Track consumed proofs (`UsedProof(BytesN<32>)`) to prevent proof replay" | Point 2/3 — marked before crediting |
| "Require authorization from a designated bridge relayer/oracle address" | `BridgeRelayer` + `relayer.require_auth()`/signature (points 2–3) |
| "Tests asserting reverts for unrecognized/unsigned proof and for a replayed proof" | Tests below |

### Test plan

Extend `oracle_bridge_tests` (`:8730`); the existing zero-proof rejection test
(`:8931`) remains as a regression:

- `test_unlock_reverts_without_relayer_configured` — no `BridgeRelayer` set → revert.
- `test_unlock_reverts_with_unrecognized_signature` — signature by a random keypair →
  revert; also garbage signature / tampered proof bytes.
- `test_unlock_amount_tamper_reverts` — signature attesting `amount = 10` cannot unlock
  `20` (payload binding).
- `test_unlock_user_mismatch_reverts` — payload for `user A` rejected when called for
  `user B`.
- `test_replayed_proof_reverts` — first unlock succeeds, identical second call panics
  "Proof already used" and touches no balances.
- `test_unlock_success_consumes_proof` — locked reduced, liquid credited, `UsedProof`
  set, `EventUnlockFromBridge` emitted; `get_bridge_locked` consistent.
- `test_set_bridge_relayer_admin_only` — non-admin call reverts.

---

## Scope and sequencing

This change is documentation-only, per the agreed approach. Recommended implementation
order (each a separate PR with the tests above):

1. **#868 first** (registry) — it makes large-holder seeding for #869 benchmarks cheap
   (currently O(n²) via `buy_shares`).
2. **#869** — batched dividends on top of the paginated registry.
3. **#867** — small, self-contained accounting fix.
4. **#864** — breaking-interface security fix, shipped with consumer updates.

Sibling follow-ups verified while auditing (out of scope here):
`process_scheduled_dividend` (`:2517`) duplicates the #869 single-transaction loop and
should delegate to the batch machinery; `lock_for_bridge` (`:8624`) emits
`EventLockForBridge` that off-chain consumers may over-trust — the relayer design above
gives the unlock side a mirror attestation path if the lock event must be trusted too.
