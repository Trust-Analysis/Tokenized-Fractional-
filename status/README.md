# Public Status Page

Issue: [#797](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/797)

A static, dependency-free page that reports whether the **backend API**, the
**web application** and the **Stellar RPC dependency** are reachable. It exists
so a user can tell a known, already-being-addressed problem apart from something
specific to their own connection or wallet setup — which is impossible if the
only thing they can reach is the app that is down.

## Files

| File | Contents |
|---|---|
| `index.html` | Markup and the `noscript` fallback. |
| `status.js` | Evaluation logic, DOM-free so it can be unit-tested. |
| `app.js` | Renders what `status.js` returns, and re-checks every 60s. |
| `status.css` | Self-contained styles; no fonts or assets are fetched. |
| `status.test.mjs` | `node --test` suite for `status.js`. |

## Deploying it

The page is deliberately independent of the app it monitors, so it must not be
served by the same deployment whose health it reports. Any static host works —
a separate Render static site, GitHub Pages, Cloudflare Pages, S3. Nothing is
built: publish this directory as-is.

```bash
# Any static file server, for a local look
npx --yes serve status
```

Because it is independent, the endpoints it probes are configuration, not
hard-coded assumptions. Override them in either of two ways:

```html
<!-- Before app.js loads, in index.html -->
<script>
  window.STATUS_ENDPOINTS = {
    api: 'https://rwa-marketplace-backend-blue.onrender.com',
    web: 'https://rwa-marketplace-frontend-blue.onrender.com',
    rpc: 'https://soroban-testnet.stellar.org:443',
  };
</script>
```

```
https://status.example.com/?api=https://api.example.com&web=https://app.example.com&rpc=https://rpc.example.com
```

Query parameters win over `window.STATUS_ENDPOINTS`, which wins over the
defaults in `status.js`.

## What each tier means

| Tier | Probe | Verdict |
|---|---|---|
| Backend API | `GET {api}/health` | `200` + `status: ok` is operational; `status: degraded` or a non-`ok` dependency is degraded; `503` is degraded; no response is an outage. |
| Web application | `GET {web}/index.html` | Any `2xx` is operational. |
| Stellar RPC | JSON-RPC `getHealth` (`POST`) | `result.status === 'healthy'` is operational; a JSON-RPC error is an outage. |

Two deliberate choices:

- **Disk pressure is `degraded`, not `outage`.** The backend reports disk usage
  in `/health` but does not fail the endpoint on it (issue #801) because the API
  is still serving at that point. The status page mirrors that.
- **The page never collapses "unknown" into "operational".** An empty or
  unreadable result set renders as Unknown, because "we measured nothing" is the
  one wrong answer a status page can give that actively misleads a reader.

## Tests

```bash
node --test status/status.test.mjs
```

`tests/test_issue_797_status_page.py` also asserts the page's structure, that
the footer and `docs/troubleshooting.md` link to it, and runs the suite above.

## Keeping it honest

A status page that only ever shows green is worse than no status page. If the
tiers drift out of step with reality — a new dependency becomes critical, or an
endpoint moves — update `DEFAULT_ENDPOINTS` and this table in the same change.
