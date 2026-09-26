# scripts/

Index of the operational scripts in this directory: what each one does, required arguments/env vars, and an example invocation. Closes #738.

| Script | Purpose | Required env vars / args | Example |
| --- | --- | --- | --- |
| `setup.sh` | Automates local dev environment setup on macOS/Linux (installs deps, copies `.env.example` files, etc.). | None required; run from repo root. | `./scripts/setup.sh` |
| `setup.ps1` | Windows PowerShell equivalent of `setup.sh`, for contributors on Windows. | None required. | `.\scripts\setup.ps1` |
| `benchmark-contracts.sh` | Runs the Soroban contract benchmarks and writes a report. | `BENCHMARK_REPORT_FILE` (optional, defaults to `contract-benchmark-report.txt`), `MAX_CPU_INSTRUCTIONS` (optional regression threshold, `0` disables). | `./scripts/benchmark-contracts.sh` |
| `blue-green-deploy.sh` | Drives a blue/green deployment switch, tracking active/target color in `.blue-green-state.json`. | `ACTIVE_COLOR` (default `blue`), `TARGET_COLOR` (default `green`), `HEALTH_URL` (required for the health check step). | `HEALTH_URL=https://staging.example.com/health ./scripts/blue-green-deploy.sh` |
| `generate-certs.sh` | Generates self-signed TLS certificates for **local development only** — do not use in production. | None required. | `./scripts/generate-certs.sh` |
| `setup-ssl.sh` | Automates obtaining/renewing SSL/TLS certificates from Let's Encrypt via Certbot, including the auto-renewal cron job. | A domain argument; see the script's own header for the full flag list. | `./scripts/setup-ssl.sh -d example.com` |
| `test-ssl-renewal.sh` | Verifies the SSL auto-renewal cron job is configured correctly and that a renewal actually succeeds. | Same domain configuration as `setup-ssl.sh`. | `./scripts/test-ssl-renewal.sh` |
| `update-price-history.sh` | Regenerates `PRICE_HISTORY_GIT_SUMMARY.md` incrementally, diffing against the last-parsed commit (tracked in `.price-history-last-commit`) instead of re-walking full history. | None required. | `./scripts/update-price-history.sh` |
| `invalidate-cdn-cache.mjs` | Invalidates CDN cache entries after a deploy (Cloudflare by default). | `CDN_PROVIDER` (optional, defaults to `cloudflare`), `CDN_INVALIDATION_URLS` (required — URLs/paths to invalidate), plus the provider's own API credentials. | `node scripts/invalidate-cdn-cache.mjs` |

## Windows vs. macOS/Linux

`setup.ps1` is the Windows-oriented script (PowerShell); every other script here is Bash and targets macOS/Linux. Windows contributors should run `setup.ps1` for initial setup; the remaining operational scripts (deploy, SSL, benchmarking, CDN) are ops/CI tooling normally run from a Linux CI runner or a Linux/macOS workstation, not from a contributor's Windows machine directly. See also #739 for the broader platform-support documentation this indexes into.

## Adding a new script

Add a row to the table above describing its purpose, required env vars/args, and an example invocation, and give it a one-line purpose comment at the top of the file (most scripts here already do this).
