# Blue-Green Deployment

This repository supports blue-green deployments for zero-downtime updates. The workflow keeps two production environments online at the same time and switches traffic only after the new environment passes readiness checks.

## What is configured

- Two backend services: blue and green
- Two frontend sites: blue and green
- Health checks on each environment before a switch
- A deployment script that updates the active color state and supports rollback

## Render setup

1. Create or update the Render services from [render.yaml](../render.yaml).
2. Set the following environment variables in each service as needed:
   - `CORS_ORIGINS`
   - `ADMIN_API_KEY`
   - `VITE_CONTRACT_ID`
3. Deploy the blue service first, then the green service.
4. Use the health endpoint at `/health` to confirm the service is ready.

## Deployment flow

1. Deploy the new build to the inactive color.
2. Verify the inactive service responds successfully at `/health`.
3. Switch the active color using the deployment script.
4. Confirm the live endpoint responds normally.

## Script usage

```bash
chmod +x scripts/blue-green-deploy.sh

# Promote green after verifying health
ACTIVE_COLOR=blue TARGET_COLOR=green HEALTH_URL=https://example.com/health ./scripts/blue-green-deploy.sh

# Roll back to the previously active color
ROLLBACK=true HEALTH_URL=https://example.com/health ./scripts/blue-green-deploy.sh
```

## Rollback

If the promoted environment fails health checks or introduces regressions, rerun the script with `ROLLBACK=true` to restore the previous active color.

## Operational checklist

- Confirm both services are healthy before switching traffic.
- Keep the same environment variables and contract configuration in both environments.
- Preserve the deployment state file `.blue-green-state.json` between runs.
