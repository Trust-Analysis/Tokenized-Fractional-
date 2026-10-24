# Kubernetes Deployment Guide

This document describes how to deploy the RWA Marketplace to a Kubernetes cluster using the manifests in the `k8s/` directory.

## Directory Structure

```
k8s/
├── namespace.yaml             # rwa-marketplace namespace
├── secrets.yaml               # Sensitive credentials (not committed with real values)
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
# Backend
docker build -t <your-registry>/rwa-backend:latest ./backend
docker push <your-registry>/rwa-backend:latest

# Frontend
docker build -t <your-registry>/rwa-frontend:latest ./frontend
docker push <your-registry>/rwa-frontend:latest
```

Update the `image:` fields in `backend-deployment.yaml` and `frontend-deployment.yaml` with your registry paths.

## Step 2 — Configure Secrets

Edit `k8s/secrets.yaml` and replace the placeholder `stringData` values:

| Secret key | Description |
|---|---|
| `ADMIN_API_KEY` | Strong random key for backend admin API authentication |
| `VITE_CONTRACT_ID` | Your deployed Soroban contract ID (starts with `C`) |

> **Never commit real secret values to Git.** Use a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault, Sealed Secrets) to inject them at deploy time.

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

# 2. Create ConfigMaps and Secrets
kubectl apply -f k8s/backend-configmap.yaml
kubectl apply -f k8s/frontend-configmap.yaml
kubectl apply -f k8s/secrets.yaml

# 3. Deploy backend
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml

# 4. Deploy frontend
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml

# 5. Apply Ingress
kubectl apply -f k8s/ingress.yaml
```

Or apply the whole directory at once (namespace must exist first):

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/
```

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
