# Kubernetes Deployment Guide

This document describes how to deploy the RWA Marketplace to a Kubernetes cluster using the manifests in the `k8s/` directory.

> **Prefer Kustomize overlays.** The steps below show the raw `kubectl apply -f`
> flow for reference, but [`k8s/README.md`](../k8s/README.md) documents the
> supported path — `kubectl apply -k k8s/overlays/<env>` — which also covers
> secret provisioning and immutable image tags per environment. Use that doc
> as the source of truth if the two disagree.

## Directory Structure

```
k8s/
├── namespace.yaml             # rwa-marketplace namespace
├── secrets.example.yaml       # TEMPLATE only — not applied by kustomize; see Step 2
├── backend-configmap.yaml     # Backend environment variables
├── frontend-configmap.yaml    # Frontend environment variables
├── backend-deployment.yaml    # Backend Deployment (2 replicas)
├── backend-service.yaml       # Backend ClusterIP Service (port 3001)
├── frontend-deployment.yaml   # Frontend Deployment (2 replicas)
├── frontend-service.yaml      # Frontend ClusterIP Service (port 80)
└── ingress.yaml               # Nginx Ingress — routes /api/* → backend, /* → frontend
```

## Prerequisites

- A running Kubernetes cluster (v1.24+)
- `kubectl` configured to point at your cluster
- [nginx ingress controller](https://kubernetes.github.io/ingress-nginx/deploy/) installed
- Docker images built and pushed to a registry your cluster can pull from

## Step 1 — Build and Push Docker Images

```bash
# Pick an immutable, versioned tag — never :latest — e.g. a release tag or git sha.
TAG=$(git rev-parse --short HEAD)

# Backend
docker build -t <your-registry>/rwa-backend:$TAG ./backend
docker push <your-registry>/rwa-backend:$TAG

# Frontend
docker build -t <your-registry>/rwa-frontend:$TAG ./frontend
docker push <your-registry>/rwa-frontend:$TAG
```

Update the `image:` fields in `backend-deployment.yaml` and `frontend-deployment.yaml`
with your registry path and `$TAG` (or, if using Kustomize overlays, set
`images[].newTag` in the overlay's `kustomization.yaml` instead — see
`k8s/README.md`). The base manifests intentionally ship a non-pullable
`:unset` tag so a deploy can never silently fall back to an unpinned image.

## Step 2 — Configure Secrets

`k8s/secrets.example.yaml` is a **template**, not a manifest kustomize applies.
Copy it, fill in real values, and apply the copy out of band — never commit
the real values:

```bash
cp k8s/secrets.example.yaml /tmp/secrets.real.yaml
# edit /tmp/secrets.real.yaml with real values, then:
kubectl apply -f /tmp/secrets.real.yaml
rm /tmp/secrets.real.yaml
```

| Secret key | Description |
|---|---|
| `ADMIN_API_KEY` | Strong random key for backend admin API authentication |
| `JWT_SECRET` | 32+ byte random JWT signing secret (`openssl rand -hex 32`); the backend will not start without it |
| `VITE_CONTRACT_ID` | Your deployed Soroban contract ID (starts with `C`) |

> **Never commit real secret values to Git, and never `kubectl apply -f
> k8s/secrets.example.yaml` as-is** — its placeholder values
> (`REPLACE_WITH_STRONG_RANDOM_KEY`, `REPLACE_WITH_32_BYTE_RANDOM_JWT_SECRET`,
> `REPLACE_WITH_YOUR_CONTRACT_ID`) are not
> usable secrets. Prefer a secrets manager (External Secrets Operator, Sealed
> Secrets, SOPS, AWS Secrets Manager, HashiCorp Vault) to provision these at
> deploy time — see `k8s/README.md#secret-provisioning` — and validate with:
> ```bash
> kubectl kustomize k8s/overlays/<env> | k8s/scripts/check-secret-placeholders.sh
> ```

## Step 3 — Configure Environment

Edit the ConfigMaps to match your environment:

**`backend-configmap.yaml`** — update `CORS_ORIGINS` to your frontend URL.

**`frontend-configmap.yaml`** — update `VITE_RPC_URL` and `VITE_API_URL` for your target network.

**`ingress.yaml`** — replace `rwa.example.com` with your domain and update the `tls.hosts` and `rules[].host` fields accordingly.

## Step 4 — Deploy

Apply all manifests in order:

```bash
# 1. Create the namespace first
kubectl apply -f k8s/namespace.yaml

# 2. Create ConfigMaps and the Secrets you provisioned in Step 2 (NOT
#    k8s/secrets.example.yaml — that file is a template only)
kubectl apply -f k8s/backend-configmap.yaml
kubectl apply -f k8s/frontend-configmap.yaml
kubectl apply -f /tmp/secrets.real.yaml

# 3. Deploy backend
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml

# 4. Deploy frontend
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml

# 5. Apply Ingress
kubectl apply -f k8s/ingress.yaml
```

Or, preferably, apply the Kustomize overlay for your environment (namespace
must exist first; this applies everything except the Secrets, which you
provisioned in Step 2):

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -k k8s/overlays/<env>   # dev | staging | prod
```

Do not run `kubectl apply -f k8s/` — that would also pick up
`secrets.example.yaml`'s placeholder values.

## Step 5 — Verify

```bash
# Check namespace
kubectl get namespace rwa-marketplace

# Check pods are Running
kubectl get pods -n rwa-marketplace

# Check services
kubectl get svc -n rwa-marketplace

# Check ingress
kubectl get ingress -n rwa-marketplace

# Tail backend logs
kubectl logs -n rwa-marketplace -l app=rwa-backend -f

# Tail frontend logs
kubectl logs -n rwa-marketplace -l app=rwa-frontend -f
```

## Scaling

```bash
# Scale backend to 4 replicas
kubectl scale deployment rwa-backend -n rwa-marketplace --replicas=4

# Scale frontend to 3 replicas
kubectl scale deployment rwa-frontend -n rwa-marketplace --replicas=3
```

## Updating a Deployment

```bash
# After pushing a new image tag
kubectl set image deployment/rwa-backend rwa-backend=<your-registry>/rwa-backend:<new-tag> -n rwa-marketplace
kubectl set image deployment/rwa-frontend rwa-frontend=<your-registry>/rwa-frontend:<new-tag> -n rwa-marketplace

# Monitor rollout
kubectl rollout status deployment/rwa-backend -n rwa-marketplace
```

## Rollback

```bash
kubectl rollout undo deployment/rwa-backend -n rwa-marketplace
kubectl rollout undo deployment/rwa-frontend -n rwa-marketplace
```

## TLS / HTTPS

The Ingress manifest references a `rwa-tls-secret` TLS secret. You can provision it via:

- **cert-manager** (recommended for automatic Let's Encrypt renewal):
  ```bash
  # Install cert-manager
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
  ```
  Then annotate the Ingress with `cert-manager.io/cluster-issuer: letsencrypt-prod`.

- **Manual TLS**: create the secret from your certificate files:
  ```bash
  kubectl create secret tls rwa-tls-secret \
    --cert=path/to/tls.crt \
    --key=path/to/tls.key \
    -n rwa-marketplace
  ```

## Health Checks

Both Deployments configure liveness and readiness probes:

| Service | Endpoint | Notes |
|---|---|---|
| Backend | `GET /health` | Returns 200 when the Express server is ready |
| Frontend | `GET /` | Checks the nginx static file server |

## Resource Limits

Default resource requests/limits (adjust for your cluster):

| Service | CPU Request | CPU Limit | Memory Request | Memory Limit |
|---|---|---|---|---|
| Backend | 100m | 500m | 128Mi | 512Mi |
| Frontend | 50m | 200m | 64Mi | 256Mi |

## Teardown

```bash
# Remove all resources in the namespace
kubectl delete namespace rwa-marketplace
```
