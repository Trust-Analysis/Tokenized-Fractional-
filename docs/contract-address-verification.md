# Contract Address Verification

The frontend decides which Soroban contract to sign transactions against from
its own build-time configuration (`VITE_CONTRACT_ID`). That value is not
self-authenticating: a misconfigured build, a compromised CI pipeline, or a
malicious fork of the frontend pointed at an attacker-controlled contract would
otherwise look identical to the legitimate app.

To close that gap, this repository publishes a **signed, canonical manifest of
officially sanctioned contract addresses**, and the frontend cross-checks its
configured address against it at startup. If the address is missing, or the
manifest cannot be verified, the UI raises a prominent warning banner.

## Files

| Path | Purpose |
| --- | --- |
| `frontend/contract-manifest/official-contracts.payload.json` | Unsigned, human-editable source of truth for the address list. |
| `frontend/public/official-contracts.json` | The **signed** artifact that is served to the app at `/official-contracts.json`. |
| `frontend/scripts/sign-contract-manifest.mjs` | Dependency-free CLI to generate a key, sign the payload, or verify the artifact. |
| `frontend/src/utils/contractManifest.js` | Runtime verification + policy (pinned signers, canonicalisation, deployment status). |
| `frontend/src/hooks/useContractManifest.js` | Runs the check once at startup. |
| `frontend/src/components/ContractVerificationBanner/` | The warning banner. |

## Manifest format

```json
{
  "schema": "rwa.official-contracts/v1",
  "signer": "<base64 raw Ed25519 public key>",
  "payload": {
    "schema": "rwa.official-contracts/v1",
    "version": 1,
    "issuedAt": "2026-09-29T00:00:00Z",
    "network": "TESTNET",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "contracts": [
      {
        "id": "C...",
        "network": "TESTNET",
        "asset": "marketplace",
        "label": "RWA Marketplace — testnet reference deployment",
        "status": "active"
      }
    ]
  },
  "signature": "<base64 Ed25519 signature over canonicalize(payload)>"
}
```

The signature is computed over a **deterministic, key-sorted JSON
serialisation** of `payload` (see `canonicalize()` in
`src/utils/contractManifest.js`). The signer and the verifier must agree
byte-for-byte, so keys are sorted recursively.

## Signing a new manifest

The signing key is a **release secret and must never be committed**. Store it in
your secret manager.

```bash
cd frontend

# One-time (or on rotation): generate a new Ed25519 signing key.
# Writes the private key to a file that must stay out of version control.
node scripts/sign-contract-manifest.mjs keygen --out .contract-manifest-signing-key.json

# 1. Edit the payload with the canonical addresses.
#    frontend/contract-manifest/official-contracts.payload.json

# 2. Sign it into the served artifact.
node scripts/sign-contract-manifest.mjs sign \
  --key-file .contract-manifest-signing-key.json \
  --payload contract-manifest/official-contracts.payload.json \
  --out public/official-contracts.json

# 3. Verify the artifact before committing.
node scripts/sign-contract-manifest.mjs verify --file public/official-contracts.json

rm .contract-manifest-signing-key.json
```

When you rotate the signing key, add the new public key to
`OFFICIAL_MANIFEST_SIGNERS` in `src/utils/contractManifest.js` (or provide it at
build time via `VITE_CONTRACT_MANIFEST_SIGNERS`, a comma-separated list of
base64 keys). Remove the old key only after every deployment has been rebuilt.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_CONTRACT_MANIFEST_URL` | `/official-contracts.json` | Where the signed manifest is fetched from. |
| `VITE_CONTRACT_MANIFEST_SIGNERS` | _(empty)_ | Extra pinned signers (comma-separated base64) for key rotation. |

## Behaviour at startup

1. Fetch the signed manifest (`cache: 'no-store'`).
2. Verify the signature against the pinned signer list using Ed25519. A manifest
   signed by a key that is not pinned is rejected even if its signature is
   otherwise valid.
3. Look up the configured `VITE_CONTRACT_ID` in `payload.contracts` and confirm
   the network matches.

The resulting status drives the banner:

| Status | Meaning | UI |
| --- | --- | --- |
| `official` | Address is present in a valid manifest on the expected network | No banner |
| `unofficial` | Manifest verified, but the address is not listed (or targets another network) | **Prominent warning** |
| `unverified` | Manifest could not be fetched/verified | **Warning** |
| `not-configured` | `VITE_CONTRACT_ID` is unset | Existing "contract not configured" notice |

## Testing

- `frontend/src/test/contractManifest.test.js` verifies the shipped manifest's
  signature with an independent Ed25519 verifier (`node:crypto`) and exercises
  the policy for each status.
- `node frontend/scripts/sign-contract-manifest.mjs verify` asserts the
  committed artifact is intact and can be wired into CI.

If the configured address is ever reported as `unofficial` in production, treat
it as an incident and follow the [incident response playbook](./incident-response.md).
