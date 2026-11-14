# OAuth Client Secret Rotation Procedure (Issue #899)

The backend (`backend/src/services/oauthService.js`) authenticates against three
OAuth providers, each with a client secret loaded from the environment:

| Provider | Primary secret env var | Rotation grace-period env var |
|----------|------------------------|-------------------------------|
| Google   | `GOOGLE_CLIENT_SECRET`   | `GOOGLE_CLIENT_SECRET_PREVIOUS`   |
| GitHub   | `GITHUB_CLIENT_SECRET`   | `GITHUB_CLIENT_SECRET_PREVIOUS`   |
| Discord  | `DISCORD_CLIENT_SECRET`  | `DISCORD_CLIENT_SECRET_PREVIOUS`  |

## Rotation grace period

Both secrets are accepted concurrently. `OAuthService.getActiveClientSecrets()`
returns the active set (newest first) and `OAuthService.matchClientSecret()`
performs a **timing-safe** comparison against every active secret, reporting
which one matched (`'current'` or `'previous'`). This means:

- An authorization flow started **before** the rotation (state/PKCE cookie
  issued, user redirected to the provider) still completes after the new
  secret is deployed, because the previous secret remains valid.
- Tokens/callbacks verified with either secret during the window are accepted.

The service never logs secret values — only env var names and match sources.

## Rotation procedure (per provider)

Rotate one provider at a time. The window between step 2 and step 4 is the
grace period; keep it ≥ 10 minutes (the OAuth state/PKCE cookie TTL is 5
minutes, so one TTL covers all in-flight flows).

1. **Generate** the new client secret in the provider console (Google Cloud
   Console → APIs & Services → Credentials; GitHub → Settings → Developer
   settings → OAuth Apps; Discord → Developer Portal → OAuth2). Do **not**
   delete or revoke the old secret yet.
2. **Deploy the new secret as primary and keep the old one active**: set
   `*_CLIENT_SECRET` to the new value and set `*_CLIENT_SECRET_PREVIOUS` to
   the outgoing value in the environment, then restart/redeploy. No code
   changes are required — `OAuthService` picks up both automatically.
3. **Verify** the rotation:
   ```bash
   # Both secrets should now be active (names only, values never logged)
   curl -s -X GET "<host>/api/auth/google" -o /dev/null -w '%{http_code}\n'  # 302 to Google
   ```
   Then run the regression suite:
   ```bash
   cd backend && npm test -- __tests__/oauthSecretRotation.test.js
   ```
   And complete one sign-in per environment (staging first) to confirm the
   token exchange succeeds with the new secret.
4. **Wait out the grace period** (≥ 10 minutes, or one full auth-flow TTL) so
   any authorization started pre-rotation finishes.
5. **Retire the old secret**: revoke/delete it in the provider console and
   unset `*_CLIENT_SECRET_PREVIOUS`, then restart/redeploy. The provider-side
   revoke is the authoritative kill switch — even if the env var lingered, a
   revoked secret can no longer exchange tokens.

## Compromised-secret emergency rotation

If a secret is suspected compromised, skip the grace period and cut over
immediately: revoke the old secret in the provider console first, then set the
new value in `*_CLIENT_SECRET` and unset `*_CLIENT_SECRET_PREVIOUS`. In-flight
flows started with the compromised secret will fail (users simply restart the
sign-in), which is the intended fail-closed behavior.

## Notes

- Secrets are managed via the platform's environment/secret store; they are
  never committed to the repository and never appear in logs.
- `OAuthService` reads the env vars at construction time — restart the process
  after changing them.
- Supported providers are `google`, `github`, and `discord`;
  `getActiveClientSecrets()` throws for unknown providers.
- Regression tests: `backend/__tests__/oauthSecretRotation.test.js`.
