# CDN Configuration

This project supports CDN delivery for both production frontend build assets and asset metadata URLs for uploaded images/documents.

## Provider

Use Cloudflare in front of the deployed frontend/static origin and uploaded asset origin. AWS CloudFront can also work if you map the same public CDN hostnames to the same origins, but the bundled invalidation script currently supports Cloudflare.

Recommended hostnames:

| Purpose | Example |
| --- | --- |
| Frontend build assets | `https://cdn.example.com` |
| Uploaded images/documents | `https://assets-cdn.example.com` |

## Frontend Build Assets

Set `VITE_CDN_URL` when building the frontend:

```env
VITE_CDN_URL=https://cdn.example.com
```

Vite uses this value as its production `base`, so generated JavaScript, CSS, and image references point at the CDN. Leave it unset for local development.

For Docker production builds:

```bash
VITE_CDN_URL=https://cdn.example.com docker compose --profile prod up --build
```

## Uploaded Images And Documents

Set the backend CDN base URL:

```env
CDN_URL=https://cdn.example.com
ASSET_CDN_URL=https://assets-cdn.example.com
```

`ASSET_CDN_URL` is optional and overrides `CDN_URL` for asset metadata. When the API stores relative paths like `/uploads/home.jpg` or `documents/deed.pdf`, responses rewrite those paths to the CDN URL. Absolute URLs such as `https://...`, `ipfs://...`, and `data:` are preserved.

## Cloudflare Cache Rules

Use separate cache behavior for immutable build assets and frequently changing API/static documents:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/uploads/*`, `/documents/*` | `public, max-age=86400, stale-while-revalidate=604800` |
| `/index.html` | `public, max-age=0, must-revalidate` |

When the CDN fronts the API host, do not cache `/api/*`.

## Cache Invalidation

The script supports Cloudflare full-zone purges and URL-specific purges.

```bash
CDN_PROVIDER=cloudflare \
CLOUDFLARE_ZONE_ID=<zone-id> \
CLOUDFLARE_API_TOKEN=<api-token> \
node scripts/invalidate-cdn-cache.mjs
```

To purge specific URLs:

```bash
CDN_PROVIDER=cloudflare \
CLOUDFLARE_ZONE_ID=<zone-id> \
CLOUDFLARE_API_TOKEN=<api-token> \
CDN_INVALIDATION_URLS=https://cdn.example.com/assets/index.js,https://assets-cdn.example.com/uploads/home.jpg \
node scripts/invalidate-cdn-cache.mjs
```

## Performance Checks

Before enabling the CDN, capture baseline values with browser dev tools or Lighthouse:

- Homepage first load
- Largest image load time
- Total transferred bytes
- Backend bandwidth from static assets

After enabling the CDN, repeat the same tests and verify responses include Cloudflare headers such as `cf-cache-status: HIT` after the first request.
