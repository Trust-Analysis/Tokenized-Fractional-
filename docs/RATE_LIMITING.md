# Rate Limiting — Single Source of Truth

> **Why this document exists (Issue #887).** Rate limiting is configured in
> several independent places: the Kubernetes Ingress, the edge nginx used by
> the Docker Compose production profile, an optional Kong gateway, a
> reference gateway middleware, and the backend service itself. This document
> is the authoritative map of which layers are actually live, in what order,
> and how their limits relate to each other. **Any change to a rate limit
> must update this document in the same PR.**

---

## TL;DR

- The **backend service is the authoritative rate-limiting layer**. Product
  limits (per API key, per tier, per endpoint, per GraphQL identity) are
  defined there and nowhere else.
- The **edge layers (nginx Ingress / nginx in Compose) are a coarse outer
  bound** keyed by client IP only, meant to absorb abuse before it reaches
  the app. They are intentionally blunt: at 10 r/s per IP they are currently
  *stricter* than the highest backend tiers, so a single IP is bounded by the
  edge regardless of its API-key tier (see relationship #1 below).
- **Kong is not deployed.** `gateway/kong/` is an *alternative* dedicated
  gateway topology. It is never stacked with the nginx edge, and no
  deployment manifest in this repository wires it into the request path.
- A client experiences the **most restrictive layer it actually traverses**;
  raising a backend limit has no user-visible effect while a stricter edge
  layer is still in front of it.

---

## The actual production request path

The production backend of record is `backend/index.js` (started by
`npm start` — see `render.yaml` `startCommand` and `backend/Dockerfile`
`CMD ["node", "index.js"]`). Blue/green Render services (`backend-blue`,
`backend-green`) both run this entrypoint.

### Topology A — Render (production of record)

```
Client
  │
  ▼
Render edge (no rate limits defined in this repo)
  │
  ▼
backend (backend/index.js)
  ├── 1. Tiered API limiter          /api/*            (RateLimiterService)
  ├── 2. Admin write re-check        admin write routes (writeLimiter)
  ├── 3. GraphQL tiered limiter      /api/graphql, /graphql
  ├── 4. Persisted-query enforcement /api/graphql, /graphql
  ▼
route handlers / GraphQL resolvers
```

### Topology B — Docker Compose, `prod` profile

```
Client
  │
  ▼
frontend-prod nginx (nginx/nginx.conf or nginx.tls.conf)
  │   10 r/s per IP, burst 20 (nodelay), 50 conns/IP, returns 429
  ▼
backend:3001  (same backend layers 1–4 as Topology A)
```

### Topology C — Kubernetes

```
Client
  │
  ▼
nginx Ingress (k8s/ingress.yaml, ingressClassName: nginx)
  │   limit-rps: 10, limit-connections: 20 (per IP)
  ▼
rwa-backend-svc:3001  (same backend layers 1–4 as Topology A)
```

### Topology D — Kong (optional alternative, **not deployed**)

```
Client
  │
  ▼
Kong (gateway/kong/kong.yml, started manually via gateway/kong/docker-compose.yml)
  │   per-route rate-limiting plugins (see table below)
  ▼
rwa-backend:3001  (backend layers 1–4 still apply)
```

Kong replaces the nginx edge (B/C); it is never placed in front of it. If an
operator deploys Kong, the nginx rate-limit annotations/config stay in place
only for the paths Kong does not cover.

---

## Layer inventory

| # | Layer | Config file | Live when | Limits | Key | Role |
|---|-------|-------------|-----------|--------|-----|------|
| B | Edge nginx (Compose prod) | `nginx/nginx.conf`, `nginx.tls.conf` | `docker compose --profile prod` | 10 r/s per IP, burst 20 nodelay, 50 conns/IP, `limit_req_status 429` | client IP | Coarse outer bound / abuse shield |
| C | nginx Ingress (k8s) | `k8s/ingress.yaml` | Kubernetes deployment | `limit-rps: 10`, `limit-connections: 20` per IP | client IP | Coarse outer bound / abuse shield |
| D | Kong gateway *(optional, not deployed)* | `gateway/kong/kong.yml` | Manual `gateway/kong/docker-compose.yml` | `GET /api/rwa` 60/min & 1 000/h; `GET /api/rwa/:id` 100/min & 2 000/h; `POST /api/rwa` 10/min & 100/h; `DELETE /api/rwa/:id` 5/min & 50/h (`policy: local`) | consumer/IP | Alternative dedicated gateway |
| — | Gateway reference middleware *(reference only)* | `gateway/middleware/rateLimiting.js` | **Never** — not mounted by any entrypoint | Tiers: free 100/h, basic 1 000/h, professional 10 000/h, enterprise 100 000/h + per-endpoint caps | API key / JWT / IP | Reference implementation shipped with the standalone gateway module |
| **1** | **Backend tiered API limiter — authoritative** | `backend/src/services/rateLimiterService.js`, `backend/src/middleware/rateLimiter.js` (mounted on `/api/*` in `backend/index.js`) | **Always** | free 100 req/min (1 000/h, 10 000/day), premium 1 000/min (10 000/h, 100 000/day), enterprise 10 000/min; anomaly detection, geo limiting and billing hooks | `x-api-key`, else `anon:<ip>` | Authoritative product limits for REST |
| **2** | **Backend admin write re-check** | `writeLimiter` in `backend/index.js` (admin write routes) | **Always** | Second per-key `checkRateLimit` pass on admin POST/PATCH/DELETE | API key | Defence in depth for writes |
| **3** | **Backend GraphQL tiered limiter — authoritative** | `backend/src/middleware/tieredRateLimiter.js` (`createGraphQLRateLimiter`, mounted on `/api/graphql` and `/graphql`) | **Always** | anonymous 100 req/min, authenticated 1 000 req/min, admin 10 000 req/min (Redis-backed, in-memory fallback) | tier per IP/API key | Authoritative product limits for GraphQL |
| — | Endpoint limiter *(modular app variant only)* | `backend/src/middleware/endpointRateLimiter.js` (mounted in `backend/src/app.js`) | Only when running the modular entrypoint `backend/src/server.js`, which no deployment manifest starts | Per-endpoint per-method caps (e.g. `/api/v1/rwa` GET 30/min, `/graphql` 40/min) | path + method + key | Reserved for the modular app variant |
| — | Tiered read/write limiter *(modular app variant only)* | `createTieredRateLimiter` in `backend/src/middleware/tieredRateLimiter.js` (mounted in `backend/src/app.js`) | Only in the modular entrypoint | See `docs/TIERED_RATE_LIMITING.md` | tier | Reserved for the modular app variant |

“Authoritative” means: if two layers disagree, this is the limit the product
documented and the limit the other layers must not contradict.

---

## Intended relationship between the layers

1. **Edge (B/C) ⊇ Backend (1/3).** The edge limit is a per-IP coarse bound
   (10 r/s ≈ 600 req/min) that sits above the backend's finest single-key
   limit (enterprise 10 000/min for REST, admin 10 000/min for GraphQL).
   Because of that, **a single API key behind one IP is effectively capped by
   the edge at ~600 req/min** regardless of its backend tier; legitimate
   high-volume consumers must be fronted differently (dedicated egress or the
   Kong topology) before raising backend tiers has any effect. This
   interaction is intentional as an abuse shield and must be preserved when
   changing either side.
2. **Backend layers stack.** A REST request traverses the tiered API limiter
   (1) and, for admin writes, the write re-check (2). A GraphQL request
   traverses the GraphQL tiered limiter (3). The most restrictive pass wins;
   all rejections return `429` with `Retry-After` and `X-RateLimit-*` headers.
3. **Kong (D) is an either/or edge.** If deployed, its per-route limits are
   the outer bound for the routes it covers; the backend layers still run and
   remain authoritative for per-key product limits.
4. **Everything else in the repo is inert by default.** The gateway
   reference middleware and the modular-app-only limiters do not run in
   production; do not tune them expecting production effect.

## Change-control checklist

When changing **any** rate limit, complete this in the same PR:

- [ ] Update the authoritative config file for the layer (table above).
- [ ] Update the numbers in this document (table + any prose that mentions them).
- [ ] If the edge limit changed, confirm the intended relationship in #1
      still holds (edge ≥ backend limit, or the stricter per-IP cap is
      consciously documented here).
- [ ] If the GraphQL tiers changed, also check
      `backend/__tests__/graphqlRateLimit.test.js` expectations.
- [ ] If `nginx/nginx.conf` changed, the `Nginx Rate Limit` workflow
      (`.github/workflows/nginx-rate-limit.yml`) exercises it in CI — keep it
      passing.

## Related documentation

- `docs/TIERED_RATE_LIMITING.md` — deep dive on the tiered limiter middleware
  (components, Redis behaviour, test-environment values).
- `docs/TIERED_RATE_LIMITING_QUICKSTART.md` — quick reference for tier values.
- `TIERED_RATE_LIMITING_IMPLEMENTATION.md` — implementation history.
- `docs/SECURITY.md`, `SECURITY.md` — broader abuse-prevention controls.
