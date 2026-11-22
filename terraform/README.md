# Infrastructure-as-Code (Terraform)

This directory is the AWS-side IaC for the RWA Marketplace (Issue #890). The
Kubernetes manifests are templated with Kustomize — see
[`../k8s/README.md`](../k8s/README.md).

## Coverage matrix

| Component | IaC coverage | Where | Notes |
|---|---|---|---|
| AWS WAF WebACL (API protection) | ✅ Terraform + CDK | `waf.tf`, `../gateway/aws/waf.tf`, `../gateway/aws/cdk-stack.ts` | All three definitions must carry the same rate limit — enforced by `npm run gateway:check-parity` (Issue #891) |
| AWS API Gateway | ✅ CDK | `../gateway/aws/cdk-stack.ts` | Deployed via `../gateway/scripts/deploy.sh` |
| Redis | ✅ Terraform (opt-in) | `redis.tf` | ElastiCache replication group with encryption + automatic failover. Create by setting `create_redis_cluster = true` (plus `redis_subnet_ids`). See rationale below. |
| ELK logging stack | ⚠️ Managed differently **on purpose** | `../elk/`, `docker-compose.yml` | Self-hosted ELK (docker-compose) — rationale below |
| Kubernetes workloads | ✅ Kustomize | `../k8s/` | Base manifests + per-environment overlays |
| Postgres | Hosting-provider managed | `render.yaml` | Provisioned by the deployment platform, not Terraform |

## Why Redis is opt-in in Terraform

Redis is used in every environment but provisioned differently: dev and local
environments use the Docker-Compose Redis (or the platform-provided one from
`render.yaml`), while production should use a managed, encrypted, multi-AZ
ElastiCache group. `create_redis_cluster` defaults to `false` so `terraform
plan`/`apply` stays side-effect-free for environments that don't manage their
Redis in AWS; enabling it requires `redis_subnet_ids` (and optionally
`redis_security_group_ids` / node sizing via the variables in
`variables.tf`).

## Why the ELK stack is intentionally managed differently

The ELK stack (`../elk/`) is a **self-hosted observability stack** (Elasticsearch
+ Logstash + Kibana + Filebeat via docker-compose), not part of the public
request path. It is deliberately kept out of Terraform because:

1. **Different lifecycle** — logging infrastructure is iterated on far more
   often than network/security infrastructure; tying it to Terraform plans adds
   friction without protecting anything user-facing.
2. **Different environments** — it runs wherever operators choose (laptop,
   sidecar VM, small utility host); it is not an AWS-managed dependency, and
   several deployments (e.g. the Render-based one in `render.yaml`) use the
   platform's own log aggregation instead.
3. **No drift risk to production traffic** — a mistake in the ELK stack can
   lose logs, but cannot affect API availability or data isolation, so the cost
   of managing it in IaC outweighs the benefit.

If/when centralized managed logging is adopted (e.g. Amazon OpenSearch
Service), the migration checklist is:

- [ ] Add an `aws_opensearch_domain` (or `aws_elasticsearch_domain`) resource
      with encryption at rest, node-to-node encryption, and fine-grained
      access control.
- [ ] Point Filebeat at the managed endpoint (update
      `../elk/filebeat/filebeat.yml`).
- [ ] Keep the docker-compose stack for local development only.
- [ ] Document the cutover and delete the self-hosted production deployment.

## Usage

```bash
terraform init
terraform plan
terraform apply   # review plan first; Redis stays untouched unless create_redis_cluster = true
```

Parity between the WAF definitions in this directory and the gateway configs
is verified by:

```bash
npm run gateway:check-parity
```
