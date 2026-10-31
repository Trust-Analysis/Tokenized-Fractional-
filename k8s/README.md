# Kubernetes Deployment (Kustomize)

The raw manifests in this directory are the **single source of truth** and are
organized with a [Kustomize](https://kustomize.io/) base + per-environment
overlays (Issue #890), so the same reviewed configuration can be promoted
between environments without hand-editing YAML.

```
k8s/
├── kustomization.yaml          # base — lists the canonical manifests below
├── namespace.yaml
├── secrets.yaml                # placeholders; fill per environment (never commit real values)
├── backend-configmap.yaml      # ┐
├── backend-deployment.yaml     # │ canonical manifests (source of truth),
├── backend-service.yaml        # │ referenced in place by the base
├── frontend-configmap.yaml     # │
├── frontend-deployment.yaml    # │
├── frontend-service.yaml       # ┘
├── ingress.yaml                # base ingress (default host)
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

## Related infrastructure

Terraform coverage (WAF, and Redis via `terraform/redis.tf`) and the
intentionally self-managed ELK logging stack are documented in
[`../terraform/README.md`](../terraform/README.md). Deployment architecture is
covered in [`../docs/kubernetes-deployment.md`](../docs/kubernetes-deployment.md).
