# Kubernetes Deployment (Kustomize)

The raw manifests in this directory are the **single source of truth** and are
organized with a [Kustomize](https://kustomize.io/) base + per-environment
overlays (Issue #890), so the same reviewed configuration can be promoted
between environments without hand-editing YAML.

```
k8s/
├── kustomization.yaml          # base — lists the canonical manifests below
├── namespace.yaml
├── secrets.example.yaml        # TEMPLATE ONLY — not listed as a base resource, never applied
├── backend-configmap.yaml      # ┐
├── backend-deployment.yaml     # │ canonical manifests (source of truth),
├── backend-service.yaml        # │ referenced in place by the base
├── frontend-configmap.yaml     # │
├── frontend-deployment.yaml    # │
├── frontend-service.yaml       # ┘
├── ingress.yaml                # base ingress (default host)
├── backend-serviceaccount.yaml # per-workload identities, no API token mounted
├── frontend-serviceaccount.yaml
├── backend-pdb.yaml            # minAvailable: 1
├── frontend-pdb.yaml
├── backend-hpa.yaml            # CPU + RPS
├── frontend-hpa.yaml
├── networkpolicy-default-deny.yaml
├── networkpolicy-allow-dns.yaml
├── networkpolicy-allow-ingress-backend.yaml
├── networkpolicy-allow-ingress-frontend.yaml
├── networkpolicy-allow-backend-datastores.yaml
└── overlays/
    ├── dev/                    # host: rwa.dev.example.com,    1 replica, tag: dev
    ├── staging/                # host: rwa.staging.example.com, 1 replica, tag: staging
    └── prod/                   # host: rwa.example.com,         2 replicas, tag: stable
```

## Usage

Always apply an **overlay**, never the base directly:

```bash
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/staging
kubectl apply -k k8s/overlays/prod
```

Preview what an environment will receive (dry-run render):

```bash
kubectl kustomize k8s/overlays/prod
```

> The previous raw-file flow (`kubectl apply -f k8s/<file>.yaml`) still works
> for quick single-manifest edits and for bootstrapping the namespace, but
> overlays are the supported path for anything environment-specific.

## Per-environment values

| Value | dev | staging | prod |
|---|---|---|---|
| Ingress hostname | `rwa.dev.example.com` | `rwa.staging.example.com` | `rwa.example.com` |
| Backend / frontend replicas | 1 | 1 | 2 |
| Image tag | `dev` | `staging` | `stable` |

These are defined in each overlay's `kustomization.yaml` (image tags) and
`*-patch.yaml` files (hostname, replicas). **To change an environment's
hostname or replicas, edit the overlay — not the base manifest**, so other
environments are unaffected.

## Adding a new environment

1. `cp -r k8s/overlays/staging k8s/overlays/<new-env>`
2. Edit the hostname in `ingress-patch.yaml` and adjust replicas/tags in
   `kustomization.yaml` / patch files as needed.
3. `kubectl apply -k k8s/overlays/<new-env>`

## Resilience, scaling and network isolation

- **PodDisruptionBudgets** (`minAvailable: 1` in the base/prod) stop a node
  drain from evicting both replicas of a workload. Dev and staging run one
  replica, so their overlays patch `minAvailable: 0` to keep drains possible.
- **HorizontalPodAutoscalers** scale each Deployment between 2 and 10 replicas
  (1–3 in dev/staging) on CPU utilisation (70%) and an
  `http_requests_per_second` pod metric (10 RPS per pod). `metrics-server` and
  a Prometheus Adapter exposing that pod metric are prerequisites; the HPA
  reports `MissingMetrics` for the RPS signal until the adapter is installed.
  Once an HPA is applied it owns the replica count — the Deployment's
  `replicas` field only matters for the raw `kubectl apply -f` flow.
- **NetworkPolicies** default-deny ingress and egress in the namespace, then
  allow only: DNS to `kube-dns`; the nginx ingress controller (and the
  frontend pod) to the backend on 3001; the ingress controller to the
  frontend on 80; and backend egress to PostgreSQL (5432) and Redis (6379).
  The datastore policy uses `10.0.0.0/8` as the example private VPC CIDR —
  replace it in an overlay with the actual Postgres/Redis subnet CIDRs for
  your deployment (Render/AWS endpoints are outside the cluster). Add a
  separate egress allow for any other external API (e.g. HTTPS to a Stellar
  RPC host) that a deployment requires.

## Secret provisioning

`secrets.example.yaml` is a **template only** — it is intentionally left out of
`k8s/kustomization.yaml`'s `resources`, so no `kubectl apply -k` run (base or
any overlay) ever creates a Secret from it, and the placeholder values in it
(`REPLACE_WITH_STRONG_RANDOM_KEY`, `REPLACE_WITH_YOUR_CONTRACT_ID`) can never
end up live in a cluster by accident. The Deployments reference the Secrets
(`rwa-backend-secrets`, `rwa-frontend-secrets`) by name via `secretRef`, so the
Pods simply fail to start until one of the following has provisioned them:

- **External Secrets Operator** — sync `rwa-backend-secrets` /
  `rwa-frontend-secrets` from your existing secret store (Vault, AWS/GCP/Azure
  secrets manager, etc.) via an `ExternalSecret` resource per overlay.
- **Sealed Secrets** — encrypt the real values with `kubeseal` against the
  target cluster's public key and commit the resulting `SealedSecret` (safe to
  commit; only the in-cluster controller can decrypt it) as an overlay
  resource.
- **SOPS** — encrypt a copy of `secrets.example.yaml` with `sops` (age/KMS/PGP)
  and decrypt-and-apply as part of your deploy pipeline (e.g.
  `sops -d secrets.enc.yaml | kubectl apply -f -`).
- **Manual bootstrap** (dev/local only) — generate and apply once, out of
  band:
  ```bash
  kubectl create secret generic rwa-backend-secrets -n rwa-marketplace \
    --from-literal=ADMIN_API_KEY="$(openssl rand -hex 32)"
  kubectl create secret generic rwa-frontend-secrets -n rwa-marketplace \
    --from-literal=VITE_CONTRACT_ID="<your-contract-id>"
  ```

Before any of the above, verify a rendered manifest set carries no leftover
placeholder:

```bash
kubectl kustomize k8s/overlays/<env> | k8s/scripts/check-secret-placeholders.sh
```

## Image tags and rollback

Base `backend-deployment.yaml` / `frontend-deployment.yaml` intentionally
reference a non-pullable `:unset` tag — every overlay's `kustomization.yaml`
pins a real tag via its `images:` stanza (`dev`, `staging`, `stable`, or a
specific release/digest), so `:latest` never appears anywhere in `k8s/` and a
raw `kubectl apply -f k8s/<file>.yaml` cannot accidentally deploy an
unpinned image.

CI/CD should build and push an immutable, versioned tag (e.g. the release tag
or `git sha`) and update the target overlay's `images.newTag` to that value as
part of promotion — not retag `stable`/`dev` in place.

**To roll back:**

```bash
# Point the overlay at the previous known-good tag/digest, then re-apply.
kubectl set image deployment/rwa-backend rwa-backend=rwa-backend:<previous-tag> -n rwa-marketplace
kubectl rollout status deployment/rwa-backend -n rwa-marketplace

# Or, with kustomize: edit `images.newTag` in the overlay's kustomization.yaml
# back to the previous tag and re-apply, which keeps the overlay as the
# source of truth instead of drifting from an imperative `set image`.
kubectl apply -k k8s/overlays/<env>

# Kubernetes also tracks rollout history directly:
kubectl rollout undo deployment/rwa-backend -n rwa-marketplace
kubectl rollout undo deployment/rwa-frontend -n rwa-marketplace
```

## Related infrastructure

Terraform coverage (WAF, and Redis via `terraform/redis.tf`) and the
intentionally self-managed ELK logging stack are documented in
[`../terraform/README.md`](../terraform/README.md). Deployment architecture is
covered in [`../docs/kubernetes-deployment.md`](../docs/kubernetes-deployment.md).
