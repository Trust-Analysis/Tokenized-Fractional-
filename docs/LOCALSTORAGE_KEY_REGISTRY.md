# localStorage key registry

Audit for issue [#1047](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/1047).

`localStorage` is readable by any script that runs on the origin (including a
compromised dependency or an XSS payload), so this document is the source of
truth for **what the frontend may persist there and for how long**.

All access goes through `frontend/src/lib/storage.js`, which refuses keys that
are not listed below (or covered by a registered prefix) and refuses
credential-shaped keys and values. `frontend/src/test/storage.test.js` fails the
build if a source file outside the allowlist calls `localStorage` directly.

## What must never be persisted

| Data | Why | Where it lives now |
| --- | --- | --- |
| Access / refresh tokens, JWTs | Bearer credentials; XSS exfiltration grants account takeover | In memory only (`frontend/src/lib/authToken.js`); the durable session is the backend HttpOnly cookie |
| Wallet secret keys, seeds, mnemonics | Irreversible key theft | Never handled by the frontend; signing stays inside the wallet extension |
| Signed transaction envelopes / XDR | Replayable authorisation for a specific transaction | Never persisted; built, signed and submitted in `useSorobanWrite` |
| Wallet public keys | Not a credential, but leaks the user's on-chain identity and browsing history | Removed from the persisted wallet store (schema v2); recovered from the wallet through `checkConnection()` |

`purgeLegacyCredentialStorage()` deletes `auth_token`, `jwt`, `access_token` and
`refresh_token` from both `localStorage` and `sessionStorage` on boot and on
wallet disconnect. Those keys were written by older releases; nothing writes
them any more.

## Fixed keys

| Key | Content | Lifetime | Sensitivity | Format |
| --- | --- | --- | --- | --- |
| `theme` | `"dark"` or `"light"` | Until the user changes it or clears site data | none | string |
| `wallet_previously_connected` | `"true"` when a wallet connected before | Until disconnect or site-data clear | none | string |
| `hasCompletedTour` | `"true"` once the onboarding tour finished or was skipped | Permanent (until site data is cleared) | none | string |
| `rwa_price_alerts` | Array of locally created price alerts (`contractId`, `targetPrice`, `type`, `createdAt`, `triggered`) | Until the user deletes the alert or site data | none | versioned JSON |
| `rwa.preferences` | Display/notification preferences (zustand persist envelope) | Until reset or site-data clear | none | zustand JSON |
| `rwa-wallet-store` | Last active wallet provider only. **No `publicKey`, no share balance** since schema v2 | Until site-data clear | none | zustand JSON |
| `i18nextLng` | Language detector cache, e.g. `"en"` | Until the user changes language or site data | none | string |
| `analytics_anon_id` | Random `anon_…` identifier; no PII | Permanent (until site data is cleared) | none | string |
| `emailNotifications` | `"true"` / `"false"` profile switch | Until changed or site-data clear | none | string |
| `priceAlerts` | `"true"` / `"false"` profile switch | Until changed or site-data clear | none | string |
| `transactionNotifications` | `"true"` / `"false"` profile switch | Until changed or site-data clear | none | string |
| `marketingEmails` | `"true"` / `"false"` marketing opt-in | Until changed or site-data clear | none | string |
| `language` | Profile language selection | Until changed or site-data clear | none | string |
| `twoFactorEnabled` | `"true"` / `"false"` preference flag (not an auth secret) | Until changed or site-data clear | none | string |
| `autoLogout` | `"true"` / `"false"` preference flag | Until changed or site-data clear | none | string |
| `mock_wallet_pubkey` | Mock wallet address | Development mode only (`VITE_MOCK_WALLET=true`) | none | string |
| `mock_shares_balance` | Mock share balance | Development mode only | none | string |
| `mock_tx_failure` | `"true"` forces the mock transaction to fail | Development mode only | none | string |

## Dynamic key families

| Pattern | Content | Lifetime | Sensitivity | Format |
| --- | --- | --- | --- | --- |
| `userProfile_<wallet>` | Display name, email, bio, website, location, avatar data URL | Until the profile is deleted or site data is cleared | personal | versioned JSON |
| `rwa-watchlist_<wallet-or-guest>` | Favorites, custom categories and alert baselines for one wallet (`guest` before connect) | Until site data is cleared | personal | versioned JSON |

Wallet/profile keys include the wallet address so two wallets on the same
browser do not share data. Addresses are public identifiers, not secrets.

## Versioning and migration

`readJson` / `writeJson` wrap JSON values in an envelope:

```json
{ "__rwa_storage_version": 1, "data": { "...": "..." } }
```

Values written by earlier versions are plain JSON with no envelope. `readJson`
returns them unchanged, so upgrading users keep their price alerts, favorites
and profiles; the next write stores them in the envelope. Plain string keys
(flags, theme, language) are not enveloped because they are single scalars and
must stay compatible with `i18next` and `theme-init.js`. The wallet store keeps
zustand's own `{ state, version }` envelope and uses its `migrate` hook to drop
the previously persisted `publicKey` and `shares` (schema v2).

Storage access is wrapped in `try/catch`. When storage is blocked or full,
writes fall back to an in-memory map for the rest of the session; reads consult
that map, so the UI never throws on a storage failure.

## Exception: `theme-init.js`

`frontend/src/theme-init.js` is loaded as a classic script in `<head>` before the
module graph, to set `data-theme` before first paint and avoid a flash. It
cannot import the helper, so it reads the registered `theme` key directly and is
allowlisted by the boundary test. Any new key must go through the helper.

## Out of scope: `sessionStorage`

`sessionStorage` is cleared when the tab closes and is not part of this
registry, but the audit covered it. `pending_buy_shares_transaction` (see
`usePendingTransaction`) stores a transaction hash, share amount, contract id and
public key for up to 30 minutes so a purchase can be recovered after a refresh.
It contains no token and no signed envelope. `purgeLegacyCredentialStorage()`
also removes credential keys from `sessionStorage`.

## Related files

- `frontend/src/lib/storage.js` — registry and access helpers
- `frontend/src/lib/authToken.js` — in-memory token + legacy purge
- `frontend/src/test/storage.test.js` — registry, migration, failure and boundary tests
