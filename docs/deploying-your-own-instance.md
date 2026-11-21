# Deploying Your Own Instance

This guide is for teams that have **forked** this repository to run an independent,
rebranded marketplace for their own assets. It is a checklist of everything that
has to change between "the upstream code runs on my laptop" and "we operate this in
production under our own name".

## Local development vs. operating a production instance

These are separate concerns, and this guide covers only the second.

| | Local development setup | Operating your own production instance |
|---|---|---|
| **Goal** | Run the stack on your machine to build and test changes | Serve real users, under your brand, on your infrastructure |
| **Covered by** | [README → Getting Started](../README.md#getting-started), [development-setup.md](development-setup.md), [CONTRIBUTING.md](../CONTRIBUTING.md) | **This document** |
| **Network** | Stellar testnet, throwaway keys | Testnet for staging, **mainnet** for production, keys held securely |
| **Config** | Copy `.env.example` → `.env`, defaults are fine | Every secret generated, every placeholder domain/email/name replaced |
| **Branding** | Upstream "RWA Marketplace" name and assets | Your name, logo, icons, social copy, contact addresses |
| **Legal** | None needed | Your own terms, privacy policy, risk disclosures, and regulatory review |
| **Ops** | `docker compose --profile dev up` | Your own Render (or K8s) account, domains, TLS, logging, monitoring, backups, alerting |

If you have not yet got the stack running locally, do that first — every step
below assumes you can already build the contract and run the backend and frontend.

---

## Checklist

Work through the sections in order. Each item names the files to change.

### 1. Decide your identity

- [ ] Product name, short name (≤ 12 characters, used by the PWA), and one-line description
- [ ] Production domain(s), e.g. `app.yourdomain.com` for the frontend and `api.yourdomain.com` for the backend
- [ ] Contact addresses: support, security reports, code-of-conduct reports, transactional email sender
- [ ] Your GitHub organization / repository URL (the upstream one is linked from the UI)

### 2. Rebrand the frontend

| What | Where |
|---|---|
| Browser tab title | `frontend/index.html` → `<title>` |
| PWA name, short name, description, theme and background colors, icons | `frontend/vite.config.js` → `VitePWA({ manifest: { ... } })` |
| Page heading and translated strings | `frontend/src/locales/*.json` (`title` and any other copy mentioning "RWA Marketplace"), plus the hard-coded `<h1>` in `frontend/src/App.jsx` |
| Header GitHub link and avatar (points at `Trust-Analysis`) | `frontend/src/App.jsx` |
| News/announcement links | `frontend/src/components/NewsSection/NewsSection.jsx` |
| Per-asset page title suffix | `frontend/src/components/AssetDetailPage/AssetDetailPage.jsx` |
| Share-certificate branding | `frontend/src/components/CertificateTemplate/CertificateTemplate.jsx` |
| Social-share copy and `source` parameter | `frontend/src/utils/socialShare.js` |
| Push-notification default title and icon | `frontend/src/service-worker.js` |
| WalletConnect app name, URL, and icon (currently `rwa-marketplace.com`) | `frontend/src/services/walletConnectService.js` |
| Favicon / app icons | Add your own `favicon.ico` (and larger PNG icons if you want installable-app quality) under `frontend/public/` and reference them from the manifest |
| Fonts | `frontend/index.html` loads Inter and Outfit from Google Fonts; swap or self-host them |

Tests assert on the upstream name (`frontend/src/test/App.test.jsx`,
`frontend/e2e/asset-lifecycle.spec.js`). Update them alongside the copy so your CI
stays green.

### 3. Rebrand the repository and docs

- [ ] `README.md`: replace the title, description, and demo media (`assets/play_banner.png`, `assets/marketplace_demo.webp`) with your own, or remove the walkthrough section.
- [ ] `LICENSE`: the upstream MIT license and copyright notice **must be kept**. You may add your own copyright line for your changes.
- [ ] `CODE_OF_CONDUCT.md`: replace the reporting contact with your own team.
- [ ] `SECURITY.md`: point the private reporting link and email at your repository and team.
- [ ] `CONTRIBUTORS.md`, `CHANGELOG.md`: reset or keep them as upstream history — your choice, but do not present upstream contributors as your maintainers.
- [ ] Backend OpenAPI metadata: the server URL in `backend/src/config/openapi.js` (`api.tokenized-fractional.example.com`) and the seeded news items (`NEWS_STORAGE` in `backend/index.js`), which announce an upstream testnet launch and link to the upstream GitHub repository.

### 4. Legal, terms, and compliance

The repository ships **no** terms of service, privacy policy, or risk-disclosure
pages. A production marketplace selling fractional interests in real assets will
almost certainly need all three, and possibly much more.

- [ ] Write (with counsel) and publish your **Terms of Service**, **Privacy Policy**, and **investment risk disclosures**; link them from the app footer and the purchase-confirmation flow (`frontend/src/components/ConfirmPurchase/`).
- [ ] Read [README → Compliance and Regulatory Limitations](../README.md#compliance-and-regulatory-limitations). The on-chain allowlist is an access gate, not KYC/AML. You must run identity, accreditation, and jurisdiction checks off-chain before allowlisting a buyer.
- [ ] Decide which jurisdictions you serve and configure `GEO_BLOCKED_COUNTRIES` / `GEO_RESTRICTED_COUNTRIES` in the backend environment accordingly.
- [ ] Replace demo asset documents and metadata with your real, verified documents before launch.
- [ ] If you enable analytics, error tracking (Sentry), or email, list those processors in your privacy policy.

### 5. Deploy your own contract

Upstream contract IDs, admin keys, and the testnet payment token in the README are
examples. Never reuse them.

- [ ] Generate a dedicated admin identity for each environment (`soroban keys generate ...`). For mainnet, keep the admin secret in a hardware wallet or secrets manager, not on a developer laptop.
- [ ] Build and deploy the contract to testnet for staging and to mainnet for production (see [README → Configure Testnet & Deploy](../README.md#3-configure-testnet--deploy); for mainnet use `https://soroban.stellar.org:443` and the passphrase `Public Global Stellar Network ; September 2015`).
- [ ] Call `init` with **your** admin, the payment token you actually accept (e.g. a USDC SAC on mainnet), price, and total shares.
- [ ] Configure the allowlist (enabled by default) and, if used, the NFT certificate contract (`set_nft_contract`; see [NFT_CERTIFICATES.md](NFT_CERTIFICATES.md)).
- [ ] Record every deployed contract ID per environment; the frontend and backend both need it.

### 6. Set up your own Render account and domains

The [`render.yaml`](../render.yaml) Blueprint creates blue and green backend and
frontend services. Service names become default `*.onrender.com` hostnames, so
rename them before your first apply.

- [ ] Create a Render account/workspace owned by your organization (not a personal account).
- [ ] In `render.yaml`, rename the `rwa-marketplace-*` services to your own prefix and update the frontend `VITE_API_URL` values, which hard-code `https://rwa-marketplace-backend-blue.onrender.com` / `-green.onrender.com`.
- [ ] For mainnet production, change the frontend `VITE_RPC_URL` and `VITE_NETWORK_PASSPHRASE` values (they default to testnet).
- [ ] Apply the Blueprint from **your** fork (Dashboard → New → Blueprint).
- [ ] Set the `sync: false` variables in the dashboard: `CORS_ORIGINS`, `VITE_CONTRACT_ID`, `CDN_URL` / `ASSET_CDN_URL` / `VITE_CDN_URL` (if used), `SENTRY_DSN`.
- [ ] Copy the generated `ADMIN_API_KEY` into your secrets manager. Blue and green each generate their own key.
- [ ] Add your custom domains to the services in Render, create the DNS records Render gives you, and wait for Render-managed TLS to issue.
- [ ] Once domains are live, set `CORS_ORIGINS` to your real frontend origin(s) and `VITE_API_URL` to your real API domain, and redeploy.
- [ ] Follow [blue-green-deployment.md](blue-green-deployment.md) to decide which color serves traffic.

**Content-Security-Policy.** `frontend/index.html` ships a CSP whose `connect-src`
only allows the Stellar RPC hosts, `http://localhost:3001`, Sentry, and the Vite dev
socket. Add your production API origin (and any other RPC provider you use) there,
or the browser will block every API call from your deployed frontend. The backend
has its own CSP settings (`CSP_*` variables in `backend/.env.example`).

Not using Render? The same configuration applies to
[Kubernetes](kubernetes-deployment.md) (replace `rwa.example.com` in
`k8s/ingress.yaml` and the values in `k8s/secrets.yaml`) or to a self-hosted
Nginx server ([README → Self-Hosted HTTPS](../README.md#8-self-hosted-https-with-nginx),
replace `example.com` in `nginx/nginx.tls.conf`). Terraform for AWS lives in
`terraform/`; review `variables.tf` before applying.

### 7. Backend configuration for production

Start from `backend/.env.example` and set, at minimum:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_API_KEY` | A long random secret (≥ 16 characters; use ≥ 32). Rotate it if it is ever shared. |
| `CORS_ORIGINS` | Your frontend origin(s) only — never `*` |
| `PUBLIC_SITE_URL` | Your public frontend URL (used for sitemap links) |
| `DATA_FILE` / `DATABASE_URL` | Durable storage. Render's filesystem is ephemeral, so `data.json` on local disk is lost on redeploy; attach a persistent disk or use PostgreSQL. |
| `REDIS_URL` | Your own Redis (use `rediss://` for TLS) if you run more than one instance |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REPLY_TO`, `ADMIN_EMAIL` | Your mail provider and addresses. The code falls back to `@rwa-marketplace.com` addresses when these are unset — always set them. See [EMAIL_NOTIFICATIONS.md](EMAIL_NOTIFICATIONS.md). |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Your own Sentry project |
| `STRIPE_*` | Your own Stripe account, if you bill for API tiers |
| `PINATA_JWT`, `PINATA_GATEWAY` | Your own Pinata account for IPFS document storage |
| `CONSISTENCY_CHECK_ENABLED` | `true`, so data.json is reconciled against chain state ([data-consistency-checks.md](data-consistency-checks.md)) |

### 8. Reconfigure logging and monitoring (ELK, Prometheus, Grafana)

The `elk/` stack and the `monitoring` Compose profile are set up for **local**
use. Do not expose them to the internet as shipped.

- [ ] **Elasticsearch security.** `docker-compose.yml` sets `xpack.security.enabled=false` and disables TLS. For any shared environment, enable security, set an `elastic` password, and enable TLS, then add credentials to `elk/kibana/kibana.yml` (`elasticsearch.username` / `password`) and to the Logstash `elasticsearch` output in `elk/logstash/pipeline/logstash.conf`.
- [ ] **Hosts.** Kibana, Logstash, and Filebeat reach each other by Compose service name (`elasticsearch:9200`, `logstash:5044`). If you run a managed Elasticsearch/Elastic Cloud deployment instead, change `hosts` in `elk/kibana/kibana.yml`, `elk/logstash/pipeline/logstash.conf`, and `elk/filebeat/filebeat.yml`.
- [ ] **Naming.** Rename the cluster (`cluster.name=rwa-elk` in `docker-compose.yml`) and, if you like, the index pattern `rwa-logs-*` (Logstash `index =>`, `elk/elasticsearch/init.sh`, and your Kibana data view) to your own prefix.
- [ ] **Retention.** Review the lifecycle policy in `elk/elasticsearch/init.sh` against your own retention and privacy obligations.
- [ ] **Render.** Render does not run the ELK stack. It captures stdout; forward it with a Render log stream to your log provider, or ship it to your own Logstash endpoint. See [OBSERVABILITY.md](OBSERVABILITY.md).
- [ ] **Grafana.** Change `GF_SECURITY_ADMIN_USER` / `GF_SECURITY_ADMIN_PASSWORD` (default `admin` / `admin` in `docker-compose.yml`) and review the datasources in `grafana/datasources/datasources.yml` and the dashboard in `grafana/dashboards/`.
- [ ] **Alerting.** Point Sentry alerts and any consistency-check alerts at your own on-call channel.

### 9. CI/CD, secrets, and backups in your fork

- [ ] GitHub Actions in a fork are disabled until you enable them (**Actions** tab). Review each workflow in `.github/workflows/` before enabling it.
- [ ] Add repository secrets for the workflows you keep. The backup workflows need `DATABASE_URL`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `BACKUP_S3_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` — all pointing at **your** AWS account. See [backups.md](backups.md).
- [ ] If you use Jenkins instead, see [jenkins.md](jenkins.md) and update the `Jenkinsfile`.
- [ ] Enable secret scanning and GitHub private vulnerability reporting on your fork.
- [ ] Protect your default branch and require the CI checks to pass.

### 10. Pre-launch verification

- [ ] `GET https://api.yourdomain.com/health` returns `"status": "ok"`.
- [ ] The deployed frontend loads with no CSP errors in the browser console and shows your branding.
- [ ] A test buyer on the allowlist can connect a wallet and buy shares against your contract; a buyer not on the allowlist is rejected.
- [ ] Admin API calls work only with your `ADMIN_API_KEY` (see the [README example requests](../README.md#example-requests)).
- [ ] Logs from the production backend appear in your log pipeline, and a test error reaches your Sentry project.
- [ ] A backup runs and a restore has been rehearsed ([backups.md](backups.md)).
- [ ] Your terms, privacy policy, and risk disclosures are linked and reachable.
- [ ] A consistency check (`GET /api/admin/consistency`) reports no issues.

---

## Staying in sync with upstream

Keep branding and environment-specific changes small and isolated so upstream
fixes merge cleanly:

```bash
git remote add upstream https://github.com/Trust-Analysis/Tokenized-Fractional-.git
git fetch upstream
git merge upstream/main   # or rebase your branding branch onto it
```

Put values in environment variables wherever the code supports it, and keep
unavoidable source edits (names, icons, CSP) in as few files as possible. Watch
upstream security advisories and contract changes closely: a contract fix
upstream does **not** change your deployed contract, so you will need to deploy
and migrate to a new version yourself.
