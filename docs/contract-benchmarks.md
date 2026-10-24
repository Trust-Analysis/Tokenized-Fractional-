# Contract Resource Benchmarks

Run the state-change benchmarks before deploying fractional token contracts to Testnet:

```bash
chmod +x scripts/benchmark-contracts.sh
scripts/benchmark-contracts.sh
```

The suite measures Soroban CPU instructions for:

- `buy_shares` with payment transfer, purchase-limit validation, holder registration, and balance updates
- `batch_transfer` with 4, 16, and 32 recipients
- `distribute_dividends` with 4, 16, and 32 registered holders

Results are printed as `BENCHMARK` records and saved to `contract-benchmark-report.txt`. The benchmark setup is excluded from each measurement; only the target state-changing call is measured.

## Enforcing a resource ceiling

Set `MAX_CPU_INSTRUCTIONS` in CI or locally to fail when any measured operation exceeds the selected limit:

```bash
MAX_CPU_INSTRUCTIONS=5000000 scripts/benchmark-contracts.sh
```

Use a limit based on the target network's current Soroban resource budget and review the report whenever contract logic, storage layout, or external token calls change. These are deterministic local budget measurements, not a substitute for a funded Testnet dry run.

The underlying Rust test can also be run directly:

```bash
cd contracts
cargo test --test resource_benchmarks -- --nocapture
```
