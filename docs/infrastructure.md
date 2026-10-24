# Infrastructure Inventory and the IaC Boundary

Issue: [#796](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/796)

## Why this exists

`render.yaml` describes the Render web and static services, and `terraform/`
describes the AWS WAF rate-limiting front. Everything else the project depends
on was provisioned by hand, which means it is described nowhere: a plan change,
a region mismatch or a deleted volume leaves no trace in git and no reviewer.

This is the inventory of what exists, which parts are code-managed, and — just
as importantly — which parts are **not**, so the gap is explicit rather than
mistaken for coverage.

## Inventory

| Component | Runs on | Codified by | Status |
| --- | --- | --- | --- |
| Backend API (blue/green) | Render | [`render.yaml`](../render.yaml) | **IaC** |
| Frontend static sites (blue/green) | Render | [`render.yaml`](../render.yaml) | **IaC** |
| PostgreSQL database | Render | [`terraform/postgres/`](../terraform/postgres/README.md) | **IaC** (issue #796) |
| WAF / API-Gateway rate limiting | AWS | [`terraform/`](../terraform/main.tf) | **IaC** |
| ELK logging stack (Elasticsearch, Logstash, Kibana, Filebeat) | Docker Compose (`elk/`) | — | **Manual** |
| Prometheus + Grafana | Docker Compose (`grafana/`, `prometheus/`) | — | **Manual** |
| Redis cache | Render (commented out in `render.yaml`) | — | **Manual** |
| Nginx reverse proxy / TLS | Self-hosted (`nginx/`, `scripts/setup-ssl.sh`) | scripts, not IaC | **Manual** |
| Kubernetes manifests | `k8s/` | applied by hand | **Manual** |
| Branch protection and repo settings | GitHub | [`scripts/branch-protection.sh`](../scripts/branch-protection.sh) | **Scripted** |

"Manual" means: no `terraform plan` shows what a change would do, no PR can
review it, and two environments can silently differ.

## The boundary, until coverage is complete

The rule for anyone changing infrastructure today:

1. **If it changes how the app serves traffic, ends up in `render.yaml`.** Web
   services, static sites, their env vars and build commands.
2. **If losing it loses data, it goes in `terraform/`.** The database is the
   only such component so far; the WAF lives there for the same reason a
   misconfiguration costs money.
3. **If it is an operational sidecar, it stays manual *for now* — but is listed
   above.** The ELK and Prometheus/Grafana stacks are local/diagnostic
   (`docker compose --profile monitoring`) and are not on the request path, so
   they are the lowest-risk remaining gap.
4. **Anything new starts in code.** A new managed database, queue, bucket or
   service must be added to `terraform/` in the pull request that introduces it.
   "I created it in the dashboard" is not a mergeable description.

## Managing the database

See [`terraform/postgres/README.md`](../terraform/postgres/README.md). In short:

```bash
export RENDER_API_KEY=... RENDER_OWNER_ID=...
cd terraform/postgres
terraform init
terraform plan     # always review before applying
terraform apply
```

Adopt an existing database with `terraform import render_postgres.primary <id>`
rather than applying over it.

### State

**There is no remote backend configured yet.** `terraform init` writes state to
the local filesystem, so:

- do not commit `terraform.tfstate` (it contains secrets);
- only one operator should apply at a time;
- before this is applied by CI or a second maintainer, add a remote backend
  (Render Terraform state can live in any object store; an S3 backend with
  locking is the usual choice) and re-`init` with `-migrate-state`.

Until then, treat a local `apply` as a privileged operation and announce it.

## Remaining gaps, in priority order

1. **Redis** — currently commented out in `render.yaml`; the backend tolerates
   its absence, but where it *is* enabled it is enabled by hand. Codify it as a
   `render_redis` resource, or delete the dead comment.
2. **ELK stack** — the highest-effort gap. Either codify it (an EC2 + EBS module
   or a Compose-on-a-host module) or decide it is explicitly out of scope and
   remove it from `docker-compose.yml`.
3. **Nginx / self-hosted path** — `nginx/` and `scripts/setup-ssl.sh` describe a
   non-Render deployment that has no IaC at all. Either adopt it or document it
   as unsupported.

## Detecting drift

- `terraform plan` is the check for anything under `terraform/`; a non-empty
  plan on a clean checkout means someone changed infrastructure by hand.
- `./scripts/branch-protection.sh check` does the same for GitHub settings.
- The two are complementary: neither notices the other's gaps, which is exactly
  why the table above exists.
