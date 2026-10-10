# Privacy, NFT Metadata and Frontend Resilience Resolutions

Resolution notes for the three issues assigned to this contributor.

| Issue | Title | Status in `main` |
| --- | --- | --- |
| [#804](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/804) | No test confirming NFT certificate metadata conforms to a marketplace-compatible standard | **Open** — target standard identified; test specified below |
| [#806](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/806) | No resilience test simulating an RPC timeout or malformed response for the frontend | **Open** — narrower than reported; test specified below |
| [#812](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/812) | No data-retention or privacy policy covering personal data or log retention | **Open** — data collection is real and already configured; policy specified below |

One finding contradicts the issue text: the logging stack in this repository
**does** define a retention policy, and it is not enabled. Details in #812.

---

## #804 — NFT certificate metadata conformance

### Target standard (first acceptance criterion)

**SEP-0050, the Stellar Non-Fungible Token Metadata Standard.** This resolves
the issue's first acceptance criterion directly.

SEP-0050 mirrors the ERC-721 metadata JSON convention. The metadata document
served at a token's URI is expected to contain `name`, `description`, `image`
and `attributes`, where each attribute is `{ "trait_type": ..., "value": ... }`.
Media is normally referenced by an `ipfs://` URI.

This is the right target for this repository specifically, because the contract
already follows SEP-0050's on-chain/off-chain split. There is no competing
convention to reconcile.

### What the contract actually does

`contracts/nft/src/lib.rs` is 115 lines and a thin wrapper over
`stellar_tokens::non_fungible::Base` (`stellar-tokens = "0.7.1"`). It stores a
single base URI for the whole collection at initialisation
(`contracts/nft/src/lib.rs:33-39`):

```rust
pub fn init(e: Env, minter: Address, uri: String, name: String, symbol: String) {
    if e.storage().instance().has(&DataKey::Minter) {
        panic!("already initialized");
    }
    e.storage().instance().set(&DataKey::Minter, &minter);
    Base::set_metadata(&e, uri, name, symbol);
}
```

Every mint path — `mint_certificate` (`:45`), `batch_mint_certificates` (`:62`)
and `batch_mint_to_single` (`:91`) — calls `Base::sequential_mint` and passes
**no per-token metadata**:

```rust
pub fn mint_certificate(e: Env, to: Address) -> u32 {
    let minter: Address = e.storage().instance()
        .get(&DataKey::Minter)
        .expect("not initialized");
    minter.require_auth();
    Base::sequential_mint(&e, &to)
}
```

**Consequence for testing.** There is no on-chain metadata document, so a test
cannot validate a metadata object read from contract state. All marketplace-
visible metadata is off-chain: `token_uri` resolves to
`{base_uri}/{token_id}` and the viewer fetches that JSON. A blank or broken
render therefore means a missing or malformed file at the URI — which the
contract cannot observe or prevent.

This splits the work into two test layers, and the second is where the actual
risk lives.

### Layer 1 — contract test (guards the part the contract owns)

There are currently **no tests for this contract at all**. `contracts/tests/`
contains only `dividend_integration_tests.rs` and `dividend_e2e_tests.rs`; there
is no `nft/` test module. Add `contracts/nft/src/test.rs` (declared behind
`#[cfg(test)]`) covering:

- `init` sets the base URI, collection name and symbol, and is rejected on a
  second call (`panic!("already initialized")`).
- `token_uri` for a minted token equals `{base_uri}/{token_id}` — this is the
  join that the whole off-chain scheme depends on, and it is exactly the kind of
  thing that silently changes between `stellar-tokens` releases.
- The minted token id is sequential and starts where `Base` starts it.
- `mint_certificate` rejects a non-minter caller, and
  `batch_mint_certificates` mints the requested count.
- **The base URI is well-formed** — a non-empty string, and a base URI that does
  not already end in the separator. A trailing-slash mismatch here produces
  `.../ipfs//1` and is the most likely cause of the "mints fine, renders blank"
  symptom the issue describes, and it is cheap to assert on-chain.

### Layer 2 — metadata schema validation (guards the part that actually breaks)

This is the test the issue is really asking for. A JSON Schema for SEP-0050
metadata, validated against a representative document:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SEP-0050 NFT certificate metadata",
  "type": "object",
  "required": ["name", "image"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "image": { "type": "string", "pattern": "^(ipfs://|https://)" },
    "attributes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["trait_type", "value"],
        "properties": {
          "trait_type": { "type": "string" },
          "value": { "type": ["string", "number", "boolean"] }
        }
      }
    }
  }
}
```

Two things worth being deliberate about:

- **`name` and `image` are the required minimum, not all four.** Viewers
  generally tolerate a missing `description` and render an empty `attributes`
  array, but a missing `image` is the blank-card case. Requiring exactly what
  breaks rendering keeps the test useful instead of becoming ritual.
- **`image` must be pinned to a scheme.** An `http://` image on an NFT
  marketplace link-rot; `ipfs://` does not. This is a content decision, so
  confirm it before encoding it in a test.

Then validate both a known-good fixture and the failure modes: missing `image`,
`image` with no scheme, `attributes` entry missing `value`, and a document that
is valid JSON but not an object. A bare `require('metadata.json')` only covers
the happy path, which is the part already known to work.

### Third acceptance criterion

"Manually verify a test certificate renders correctly on at least one real
external NFT viewer" is a manual step and cannot be automated. Do it, and record
the viewer name, contract id and token id in the PR. Note that a Soroban NFT has
to be viewed through a viewer that supports SEP-0050 — a conventional
ERC-721-only viewer will not render it at all, and a blank card there is not
evidence of bad metadata.

---

## #806 — frontend RPC resilience testing

### The gap is narrower than the issue states

The error-mapping layer is **already tested**. `src/lib/errorMapper.test.js`
covers network failures, rate limiting and timeouts:

```
src/test/errorMapper.test.js:179   describe('network and RPC errors', …)
src/test/errorMapper.test.js:184   expect(mapped.message).toBe('We could not reach the Stellar network.')
src/test/errorMapper.test.js:189   mapError(new Error('Request failed with status 429')).code === 'RPC_RATE_LIMITED'
src/test/errorMapper.test.js:190   mapError(new Error('503 Service Unavailable')).code === 'RPC_UNAVAILABLE'
src/test/errorMapper.test.js:197   timeout → 'The network took too long to respond.'
```

The mapper is also well built for this purpose: `src/lib/errorMapper.js` has an
ordered `ERROR_CATALOG` with a dedicated `NETWORK` category covering unreachable
(`:379`), rate-limited (`:399`), 502/503/504 (`:407`) and timeout (`:415`, matching
`'timeout of'`, `'aborted'`), plus an unknown-error fallback.

**What is untested is the hook.** `src/test/useSoroban.test.js` contains three
tests, all for `useSorobanWrite` (`:99`, `:117`, `:135`).
`grep -rn "useSorobanRead" src/test/` returns **nothing** — `useSorobanRead` has
zero test coverage. So the untested surface is whether a failing RPC call
actually reaches the hook's error state and renders a fallback, not whether the
error message is well-chosen.

### Two real resilience gaps the tests would expose

`src/hooks/useSoroban.js` (224 lines) has a retry wrapper at `:39-65`:

```js
const withRetry = async (operationFn, operationName) => {
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      return await operationFn();
    } catch (error) {
      const isRateLimited = error?.message?.includes("429") || error?.response?.status === 429;
      const isServiceUnavailable = error?.message?.includes("503") || error?.response?.status === 503;
      if ((!isRateLimited && !isServiceUnavailable) || attempt === MAX_RETRIES) {
        throw error;
      }
      attempt++;
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000);
      ...
    }
  }
};
```

**Gap 1 — a timeout is not retried.** Only `429` and `503` are retried. A
timeout throws through on the first attempt even though `errorMapper` has a
dedicated entry for it, so the user sees an error on a request that would
succeed on retry. Retrying timeouts is exactly what the backoff above was
written for.

**Gap 2 — there is no client-side request timeout.** `grep` for `AbortController`
or `Promise.race` across `src/hooks/useSoroban.js` returns nothing. The
`.setTimeout(30)` calls at `:114` and `:189` are the **Soroban RPC
`getTransaction` timeout, in seconds** — a server-side wait budget, not a
client-side deadline. A request that hangs at the transport layer leaves
`loading` true indefinitely with no error state and no retry, so the UI never
reaches a fallback at all. This is the "RPC endpoint is slow" case the issue
names, and today it produces a permanent spinner rather than an error screen.

Both are worth fixing alongside the tests, since a resilience test that asserts
a fallback UI will fail against the current implementation.

### Tests to add

The project already has vitest 2.1.9, `@testing-library/react` 16.3 and
`@testing-library/jest-dom` 6.6, with `npm test` → `vitest run`. There is no MSW
dependency, so mock at the module boundary with `vi.mock` on the
`@stellar/stellar-sdk` / `@stellar/soroban-sdk` RPC module, following the
pattern already established in `src/test/useSoroban.test.js`. Use
`vi.useFakeTimers()` to drive the retry backoff rather than real waits.

New file `src/test/useSorobanResilience.test.js`, plus a component-level test
that asserts the rendered fallback:

- **RPC hangs** — promise never settles. Assert the error state is reached
  within the client-side timeout budget, and that the UI leaves `loading`.
  This is the test that fails today.
- **RPC rejects with a timeout-shaped error** (`'timeout of 30000ms exceeded'`)
  — assert `useSorobanRead` surfaces the mapped `'The network took too long to
  respond.'` copy and that the retry loop is entered.
- **Malformed response** — RPC resolves with an object missing the expected
  ledger entries, or with `result: null`. Assert the hook errors rather than
  setting `data` to a partially-valid object. This is the case most likely to
  produce a silent wrong render, and it is currently unchecked.
- **Retries exhausted** — three `503`s in a row. Assert the final error is
  surfaced, and that exactly three attempts were made (not four — the
  `attempt <= MAX_RETRIES` loop condition is worth pinning).
- **Retries then succeed** — two `503`s then a success. Assert the value
  resolves and no error state is left set. The current tests never exercise the
  success-after-retry path.
- **Fallback UI** — render a component using the hook and assert the network
  error state renders the mapped message, not a raw `'Failed to fetch'`. The
  mapper is tested in isolation; nothing currently asserts the *rendered*
  output.

---

## #812 — data retention and privacy policy

This is the one issue of the three that a Markdown file genuinely resolves, and
it should be written from the configuration that actually exists rather than
from assumptions. The stack already collects personal data, so this is
documenting a real data flow, not a hypothetical one.

### What is collected today

**Log ingestion — `elk/filebeat/filebeat.yml`.** Filebeat tails all Docker
container logs and runs two metadata processors:

```yaml
processors:
  - add_docker_metadata:
      host: "unix:///var/run/docker.sock"
  - add_host_metadata: ~
```

`add_host_metadata` attaches the host's identity and network metadata, and
`add_docker_metadata` attaches the container's. Both carry the host IP address.
Every ingested log record therefore has host and container identity attached
before it reaches Logstash.

**Nginx access logs — `elk/logstash/pipeline/logstash.conf:14-50`.** The
pipeline parses nginx JSON access logs and maps these fields to ECS:

| Source field | Indexed as | Personal? |
| --- | --- | --- |
| `http_x_forwarded_for` / client IP | source address | **Yes** |
| `http_user_agent` | `user_agent.original` | **Yes** — fingerprinting |
| `http_referer` | `http.request.referrer` | **Yes** |
| `request_uri` | `url.original` | Yes where it carries identifiers |
| `status`, `body_bytes_sent` | response status/size | No |

**Backend application logs — `logstash.conf:51-85`.** Pino structured JSON is
mapped into ECS (`level`, `msg`, request/response, `responseTime`, `err`).
These carry user context, because the backend is the layer that knows which
account performed a transaction.

**KYC/allowlist — `contracts/src/lib.rs:1156-1187`.** The opt-in buyer
allowlist (issue #700) is real and live: `add_to_allowlist`,
`remove_from_allowlist`, `set_allowlist_enabled`. It stores Stellar
`Address` values.

**A Stellar address is pseudonymous, not anonymous.** It is pseudonymous data
under GDPR — no name or email is attached, but an address is linkable to a
person through any KYC record the user submitted off-chain, and it is
permanent and publicly readable on-chain. An allowlist entry is an
"is this person cleared to buy" record about an identifiable individual. This
is the most sensitive category in the stack and the one the issue is right to
flag.

**Telemetry.** `OPENTELEMETRY_TRACING_UIDE.md` and Sentry-tagged log records
(`logstash.conf:75-81`, `add_tag => ["sentry_log"]`) indicate error-reporting
telemetry that may carry request context and user identifiers.

### The retention policy exists but is not enabled

This is the substantive finding, and it did not match the issue's framing.

`elk/elasticsearch/init.sh` defines a complete ILM policy for the
`rwa-logs-*` indices:

| Phase | `min_age` | Action |
| --- | --- | --- |
| hot | `0ms` | set priority |
| warm | `7d` | forcemerge, shrink, 1 replica |
| cold | `30d` | 0 replicas |
| **delete** | **`90d`** | **delete index** |

So a 90-day retention was designed. But the Logstash output block
(`elk/logstash/pipeline/logstash.conf:101-108`) does not apply it:

```conf
output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "rwa-logs-%{+YYYY.MM.dd}"
    manage_template => false
    ilm_enabled => false
  }
}
```

`ilm_enabled => false` and `manage_template => false` both disable the
automatic application of the policy and template. And `init.sh` is a manual
script — its own header says *"Run this once after Elasticsearch is healthy"*
— so on a fresh environment neither the policy nor the template exists at all.

**Net effect: there is no enforced retention.** Daily indices accumulate
indefinitely unless an operator remembers to run `init.sh` and then flips the
ILM flag. A privacy policy cannot honestly claim 90-day retention while that is
the state of the configuration, so this needs fixing before the policy is
published.

There is also **no anonymisation anywhere in the pipeline**. The only field
stripping is `remove_field => ["[json][req]", "[json][res]", "[json][err]"]`
(`logstash.conf:96-98`), which tidies nested backend objects and does nothing to
IP addresses. If 90-day retention is judged too long for IP addresses, masking
or truncation in Logstash is the place to do it.

### Policy document to author

`PRIVACY.md` at the repository root, alongside the existing `SECURITY.md`. It
should cover:

1. **Scope** — the dApp (frontend, backend, gateway), the Soroban contracts, and
   the `elk/` logging stack.
2. **Data inventory** — a table of each data category, its source, and whether it
   is personal data. Use the table above; it is derived from the config rather
   than assumed. Categories: server access logs (IP, user-agent, referer),
   backend application logs, error/tracing telemetry, allowlist/KYC records,
   wallet addresses and on-chain transaction history, and the IPFS metadata
   documents published with each certificate.
3. **Roles** — for a dApp, state plainly that the operator acts as controller for
   server-side logs and telemetry, and that **on-chain data is immutable and
   outside the operator's control** — it cannot be deleted, only obscured. This
   is the single most important disclosure in the document and it must not be
   glossed over.
4. **Retention per category** — a table with a concrete period and the
   enforcement mechanism for each. Cite the ILM policy once `ilm_enabled` is
   fixed; do not cite it before then.
5. **Lawful basis** — legitimate interests for security and operational logs
   (Art. 6(1)(f)); contract performance for anything needed to complete a
   purchase.
6. **Rights and how to exercise them** — access, rectification, erasure,
   restriction, objection, and portability, with a named contact and a
   response window (30 days is the Art. 12(3) default). Be explicit that
   on-chain records cannot be erased and state what the operator *can* do.
7. **Sub-processors** — the infrastructure providers for hosting, the RPC node
   operator, the IPFS pinning service, and the Sentry-equivalent. This list has
   to be produced from actual deployment config, not invented; if it cannot be
   confirmed, mark it as outstanding rather than guessing.
8. **International transfers** — where infrastructure is hosted.
9. **Security** — link to the existing `SECURITY.md` rather than duplicating it.
10. **Contact and effective date**, plus a change-log entry so revisions are
    traceable.

State the retention period as the period that is actually enforced. If a period
is aspirational, mark it as such rather than presenting it as current.

### Footer link (second acceptance criterion)

`frontend/src/components/Footer/Footer.jsx` (41 lines) currently renders a
single link to the status page, added by issue #797, using a build-time
override with a deliberate placeholder:

```jsx
export const DEFAULT_STATUS_URL = 'https://status.example.com';

export default function Footer({ statusUrl }) {
  const { t } = useTranslation();
  const href = statusUrl || import.meta.env?.VITE_STATUS_URL || DEFAULT_STATUS_URL;
  return (
    <footer className={styles.footer}>
      <a className={styles.link} href={href} target="_blank"
         rel="noreferrer noopener" data-testid="status-page-link">
        <span className={styles.dot} aria-hidden="true" />
        {t('footer.status')}
      </a>
    </footer>
  );
}
```

Add the policy link following the pattern already established here: a
`DEFAULT_PRIVACY_URL` constant, a `privacyUrl` prop, an
`import.meta.env?.VITE_PRIVACY_URL` override, and a
`data-testid="privacy-policy-link"` anchor. Note the component's own comment
(`:8-16`) explains the placeholder is "deliberately obvious rather than a
plausible-looking URL that would silently point at nothing" — apply the same
reasoning to the privacy URL so a missing configuration is visible in review.

Two details that will otherwise be missed:

- **The link is translated.** It uses `t('footer.status')`, so the new label
  needs a `footer.privacy` key in the locale files. This repository enforces
  locale parity — `src/i18n/localeParity.js` with
  `src/test/i18nLocaleParity.test.js` — so a key added to one locale and not the
  others will fail `npm test`. Add it to every locale in the same commit.
- **There is no `Footer` test.** `find src -iname "*Footer*"` returns only the
  component and its stylesheet, so nothing will catch a regression. Add
  `src/test/Footer.test.jsx` asserting both links render with the expected
  `href`, which also gives the privacy link its first regression guard.

---

## Summary of required changes

| Issue | Change | Size |
| --- | --- | --- |
| #804 | Add contract tests for `contracts/nft/src/lib.rs`; add SEP-0050 JSON Schema + metadata validation tests; manual external-viewer check | Medium — new test coverage, no production change |
| #806 | Add `useSorobanResilience` tests with `vi.mock` + fake timers; fix the two gaps the tests expose (retry timeouts, add a client-side deadline) | Medium — tests plus two hook fixes |
| #812 | Author `PRIVACY.md`; enable `ilm_enabled` and the index template; add the footer link, `footer.privacy` i18n key across all locales, and `Footer.test.jsx` | Medium — policy text plus small code changes |

**#812 has one ordering constraint.** `PRIVACY.md` should not claim 90-day
retention while `logstash.conf:106` disables it. Flip `ilm_enabled` to `true`,
wire up the template, and confirm `init.sh` runs in deployment before the policy
is published.

#804 is the lowest risk — it is test coverage for code that already works, and
no production change is required. #806 is the one most likely to surface real
defects, since two of its tests are expected to fail against the current hook.
#812's blocking dependency is the retention enforcement, not the writing.
