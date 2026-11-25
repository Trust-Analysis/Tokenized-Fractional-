# Official Contract Manifest — Trust Model & Tamper-Evidence

This directory contains the canonical source of truth for officially recognized contract deployments on the Tokenized Fractional RWA Platform (Issue #792, Issue #906).

---

## 1. Files & Roles

| File | Role | Security Property |
|---|---|---|
| `official-contracts.payload.json` | Unsigned, human-editable address list | Git-tracked source of truth for contract addresses. |
| `frontend/public/official-contracts.json` | Signed JSON envelope (`payload`, `signer`, `signature`) | Cryptographically signed artifact served at `/official-contracts.json`. |
| `frontend/scripts/sign-contract-manifest.mjs` | Offline signing CLI | Signs payload using offline Ed25519 private keys. |
| `frontend/src/utils/contractManifest.js` | Browser verification engine | Cryptographically verifies Ed25519 signature against pinned public keys. |

---

## 2. Trust Model Analysis (Issue #906)

### How Authenticity Is Established

1. **Client-Side Cryptographic Verification (Not Implicit Trust)**:
   The frontend does **not** implicitly trust local contract JSON files or build-time environment variables (`VITE_CONTRACT_ID`).
   At startup, `useContractManifest` fetches the manifest envelope and uses the browser's native WebCrypto API (`crypto.subtle.verify`) to verify the Ed25519 digital signature of the canonicalized payload against a hardcoded, pinned list of trusted signer public keys (`OFFICIAL_MANIFEST_SIGNERS`).
2. **Canonical Serialization**:
   The payload is normalized and recursively key-sorted using `canonicalize()` prior to signing and verification, preventing JSON whitespace or key-ordering tampering.
3. **Offline Signing Key Isolation**:
   The private Ed25519 signing key is **never** committed to version control and is **never** present in CI/CD build environments. It is stored offline in an isolated secret manager and used exclusively during release publishing.

---

## 3. Defense-in-Depth Against Threat Scenarios

| Attack Vector | System Defense | Result |
|---|---|---|
| **Compromised CI / Build Pipeline** | The attacker cannot sign a forged contract without the offline Ed25519 private key. Changing the contract address causes signature verification to fail. | `UNVERIFIED` warning banner shown to all users. |
| **Tampered Build modifying pinned keys** | When `VITE_CONTRACT_MANIFEST_REMOTE_URL` is set, the client cross-checks against an independently-hosted, signed manifest from an out-of-band CDN or secure origin. | `UNOFFICIAL` / `UNVERIFIED` warning banner shown. |
| **Compromised Web Server / CDN** | An attacker modifying `public/official-contracts.json` invalidates the Ed25519 signature. | Signature mismatch triggers `UNVERIFIED` warning. |
| **Phishing / Fraudulent Fork** | Malicious deployment pointing to attacker contract triggers `UNOFFICIAL` warning because the contract ID is not in the official signed manifest. | Prominent red warning banner instructing users not to connect wallets. |

---

## 4. Runtime Secondary Cross-Check

To defend against scenarios where a frontend deployment's local hosting is compromised:
- Configure `VITE_CONTRACT_MANIFEST_REMOTE_URL` to point to an independently hosted, out-of-band copy of the signed manifest (e.g., an immutable S3 bucket or GitHub Pages).
- At runtime, `verifyConfiguredContract()` verifies both the primary manifest and the remote manifest. If the local build claims a contract is official but the independent remote source repudiates it, a tampering alert is immediately rendered.
