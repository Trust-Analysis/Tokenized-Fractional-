# API Gateway Configurations

This directory contains the API gateway configuration for the RWA Marketplace.
There are **two actively maintained gateway implementations plus one enterprise
reference**, and — until Issue #891 — nothing documented which one was
production or kept them consistent.

## Which gateway is production?

| Path | Platform | Status |
|---|---|---|
| `gateway/aws/` (`cdk-stack.ts`, `waf.tf`, `lambda/authorizer/`) | **AWS API Gateway (CDK) + WAF** | **✅ Production configuration.** This is what `scripts/deploy.sh` deploys by default (`GATEWAY_TYPE` defaults to `aws`) and what the AWS-hosted environment runs in front of the backend. |
| `gateway/kong/` (`docker-compose.yml`, `kong.yml`) | Kong (declarative config) | **Alternative for self-hosters.** Mirrors the production routing/auth/rate-limit contract so the marketplace can be self-hosted without AWS. Not deployed by CI/CD; kept functionally equivalent to the AWS path (see parity policy below). |
| `gateway/apigee/` (`apiproxy/rwa-marketplace.xml`) | Apigee | **Reference-only / not deployed.** Kept as an example for enterprises evaluating Apigee. No parity requirement. |

Shared, gateway-agnostic middleware also lives here (`middleware/`,
`monitoring/`) and is used by the backend directly regardless of which
gateway fronts it.

## Configuration parity policy (Issue #891)

The AWS and Kong implementations **must stay functionally equivalent** for the
routes they both serve. The canonical contract is
[`gateway/config-parity.json`](./config-parity.json):

- the routing table (`METHOD /path`),
- which routes require auth (and the auth mechanism),
- Kong's per-route rate limits,
- the WAF rate-based limit (per IP, per 5 minutes) shared by the CDK stack and
  both Terraform files.

### Automated check

Run the parity checker before merging any gateway change:

```bash
npm run gateway:check-parity
# or directly:
node gateway/scripts/check-parity.js
```

It parses `aws/cdk-stack.ts`, `kong/kong.yml`, `aws/waf.tf`,
`../terraform/waf.tf` and `../terraform/variables.tf` and **fails the build**
if either gateway diverges from `config-parity.json` (missing/extra routes,
auth mismatches, rate-limit drift, WAF limit drift).

### When you change one gateway

1. Apply the equivalent change to the **other** implementation.
2. Update `config-parity.json` if the contract itself changed.
3. Run `npm run gateway:check-parity` and make sure it passes.
4. Note the reason for any *intentional* divergence in your PR description.

### Manual review checklist (things the automated check cannot see)

- [ ] New routes are added to BOTH `aws/cdk-stack.ts` and `kong/kong.yml`
      (the check verifies this — but also review the request/response
      transformation logic for behavioral parity).
- [ ] Auth changes (JWT claim names, authorizer caching TTLs, key names) are
      mirrored: the AWS Lambda authorizer and Kong's `jwt` plugin must agree on
      algorithm and claims.
- [ ] CORS configuration stays compatible with the frontend origin in both
      gateways.
- [ ] Timeouts, retries and payload-size limits are consistent.
- [ ] WAF rule changes are applied in **all three** places the WAF is defined:
      `aws/cdk-stack.ts`, `aws/waf.tf`, `../terraform/waf.tf`.

## Deployment

```bash
./scripts/deploy.sh aws      production us-east-1     # default / production
./scripts/deploy.sh kong     production               # self-hosted
./scripts/deploy.sh apigee   production               # reference only
```

See [`GATEWAY_GUIDE.md`](./GATEWAY_GUIDE.md) for the full architecture and
per-platform configuration guide.
