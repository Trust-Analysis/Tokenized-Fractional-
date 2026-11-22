# Browser storage privacy and assigned issue implementation plan

## Browser storage privacy

This app uses browser local storage to remember the following data on this site:

| Storage key | Data and purpose |
| --- | --- |
| `userProfile_<publicKey>` | Wallet address in the key, and profile fields such as display name, email, bio, website, location and avatar in the value. This restores the profile in the same browser. |
| Profile preference keys | Settings for notifications, appearance, language and other profile controls. These settings are shared across wallets in the same browser. |
| `rwa_price_alerts` | Asset identifiers, target prices, alert direction and status. This restores price alerts. The key is shared across wallets in the same browser. |
| `rwa-watchlist_<address>` and `rwa-watchlist_guest` | Favorites, categories and notifications. These restore a wallet's watchlist or the guest watchlist. |
| `analytics_anon_id` | A browser identifier used to associate analytics events. The current implementation stores it without an expiration time. |

Scripts running on this site's origin can read or modify these values. A wallet-specific key groups entries by wallet address and provides no access control. Stored profile and alert data should be treated as untrusted when read. On a shared device, use the browser's site-data settings to remove these entries. Clearing site data also resets other local preferences for the site.

## Implementation and verification still required

### Tokenized Fractional

| Issue | Implementation and acceptance check |
| --- | --- |
| [#1101](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/1101) | Add a clear-local-data control and have wallet disconnect clear the outgoing wallet's data. Account for shared legacy alert keys and reset in-memory state so it cannot restore deleted values. Gate analytics ID creation and reuse on affirmative consent. Verify wallet switching, legacy storage cleanup, disconnect, and consent withdrawal. |
| [#1100](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/1100) | Require the asset validator when constructing GraphQL mutation handlers. Generate SDK types and GraphQL inputs from the schema used for REST validation. Compare equivalent normalized validation errors for identical invalid payloads, and verify missing validation fails closed. |
| [#1099](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/1099) | Use decimal strings at serialization boundaries and fixed-point integer arithmetic in the engine. Derive and document API bounds from the contract's scaling, intermediate arithmetic and rounding rules. Property-test boundary and random fills against contract results. |
| [#1098](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/1098) | Emit a deployment registry from successful deployments with network, contract ID, wasm hash, transaction and commit. Use it to generate or validate frontend, backend and documentation references. Verify CI rejects unknown IDs and IDs assigned to the wrong network. |

### Quoin

| Issue | Implementation and acceptance check |
| --- | --- |
| [#44](https://github.com/SkyyNineCrew/Quoin/issues/44) | Publish market updates from the ingestion path to client subscriptions. Verify a connected client receives a new update without polling and can recover missed state after reconnecting. |
| [#45](https://github.com/SkyyNineCrew/Quoin/issues/45) | Reproduce variability on fixed inputs and record the model, configuration and input context. Fix confirmed sources of unintended variation and verify repeated runs against the expected output contract. |
| [#46](https://github.com/SkyyNineCrew/Quoin/issues/46) | Apply a shared CORS policy ahead of API routing and error handling. Verify allowed and disallowed origins, preflight, and error responses with the service's credential settings. |
| [#47](https://github.com/SkyyNineCrew/Quoin/issues/47) | Schedule the existing database backup mechanism with configured storage and retention, and surface failed runs. Verify a scheduled run produces an artifact and restore it into an isolated database. |

### PropChain BackEnd

Keep middleware and mocked-request tests under `api-extensions/`.

| Issue | Implementation and acceptance check |
| --- | --- |
| [#1605](https://github.com/MettaChain/PropChain-BackEnd/issues/1605) | Add injectable middleware to resolve `X-API-Key` and `Authorization: ApiKey` by configured precedence, attach `request.apiKey`, and record only a hashed identifier. Test both formats, precedence, malformed values, and missing credentials. |
| [#1607](https://github.com/MettaChain/PropChain-BackEnd/issues/1607) | Add injectable middleware to attach client IP, device, platform and bot classification with configurable headers. Honor forwarding headers only through trusted proxies. Test direct requests, trusted proxy requests, spoofed headers, bots, and missing user agents. |
| [#1608](https://github.com/MettaChain/PropChain-BackEnd/issues/1608) | Attach a tenant-qualified rate limit key using verified user identity, then verified API key identity, then client IP. Ensure the identity is available when resolving the key. Test precedence, anonymous fallback and tenant isolation. |
| [#1609](https://github.com/MettaChain/PropChain-BackEnd/issues/1609) | Add injectable audit middleware for POST, PUT and PATCH with per-route controls, recursive redaction, body size limits and structured request ID correlation. Test nested sensitive fields, oversized bodies, configured logging levels and disabled routes. |
