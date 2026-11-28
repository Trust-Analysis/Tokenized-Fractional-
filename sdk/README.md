# Tokenized Fractional SDK

Framework-agnostic TypeScript clients for the marketplace's off-chain API and Soroban contract. The package can be used from a Next.js server action, route handler, or browser client.

## Build

```bash
npm install
npm run build:sdk
```

## REST API

```ts
import { RwaApiClient } from '@trust-analysis/tokenized-fractional-sdk';

const api = new RwaApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.API_KEY,
});

const assets = await api.listAssets({ assetType: 'real_estate', page: 1, limit: 20 });
const matches = await api.searchAssets({ search: 'apartment', limit: 10 });
const history = await api.getPriceHistory(contractId, {
  from: '2026-01-01T00:00:00.000Z',
  resolution: 'day',
  limit: 100,
});
```

`baseUrl` may be the service root or an existing `/api/v1` URL. API errors are thrown as `ApiError` with `status` and parsed `body` fields.

## Version compatibility

The SDK is versioned independently from the Soroban contract and the backend
REST API. This matrix maps SDK semver ranges to the supported contract
versions (the `version` field returned by the contract's
`get_contract_metadata()`) and backend REST API versions (the `info.version`
of the OpenAPI spec served at `GET /api-docs.json`). It is the rendered copy
of `COMPATIBILITY_MATRIX` in [`src/compatibility.ts`](src/compatibility.ts);
update both together.

| SDK version | Contract versions (`get_contract_metadata().version`) | REST API versions (`/api-docs.json` `info.version`) | Notes |
|-------------|--------------------------------------------------------|------------------------------------------------------|-------|
| `0.1.x`     | `>=0.4.0 <0.5.0`                                       | `>=2.0.0 <3.0.0`                                     | Developed and tested against contract 0.4.0 and backend API 2.0.0 (REST paths under `/api/v1`). |
| `0.2.x`     | `>=0.5.0 <0.6.0`                                       | `>=2.0.0 <3.0.0`                                     | Contract 0.5.0 removes the legacy dividend entry points; use the distribution methods below. See [Income distribution](#income-distribution). |

### Runtime compatibility check

Both clients can check the deployed versions at runtime and **warn** on a
known-incompatible combination (they keep working — the check is
best-effort and never throws):

```ts
import { RwaApiClient, SorobanClient } from '@trust-analysis/tokenized-fractional-sdk';

// REST: reads GET /api-docs.json → info.version
const api = new RwaApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL! });
const apiReport = await api.checkCompatibility();
// → { compatible: false, warnings: ['Deployed REST API version "1.0.0" is outside …'] }

// Soroban: reads get_contract_metadata().version (needs a funded account, like any read)
const soroban = new SorobanClient({ rpcUrl, contractId, signer });
const contractReport = await soroban.checkCompatibility(publicKey);

// Or check explicit versions without touching the network:
import { checkCompatibility, warnOnIncompatibleCombination } from '@trust-analysis/tokenized-fractional-sdk';

const report = checkCompatibility({ contractVersion: '0.4.0', apiVersion: '2.0.0' });
warnOnIncompatibleCombination({ contractVersion: '9.9.9' }); // logs a console warning
```

## Tests

```bash
npm test   # builds, then runs the node:test suite in test/
```

## CI and releases

The SDK has its own workflow, `.github/workflows/sdk.yml`, independent of the
main application pipelines:

- **Build & test** — `npm ci`, typecheck, build and `node --test` on every PR
  and push that touches `sdk/`.
- **Publish** — pushing a `sdk-vMAJOR.MINOR.PATCH` tag builds the SDK and
  publishes it to npm on its own release cadence. Requires the `NPM_TOKEN`
  repository secret.
- **Contract / SDK sync check** — a PR that changes `contracts/src` fails
  unless the SDK also changed or the PR is labelled `sdk-contract-sync`.

### When the contract's public interface changes

Work through this checklist and either push the SDK update in the same PR or
label the PR `sdk-contract-sync`:

- [ ] Check whether any method/field the SDK calls was added, renamed or
      removed (the SDK reads `get_contract_metadata` and calls contract
      methods via `SorobanClient.read`/`write`).
- [ ] If the deployed contract version moves to a new minor/major, update
      `COMPATIBILITY_MATRIX` in [`src/compatibility.ts`](src/compatibility.ts)
      **and** the rendered table in this README.
- [ ] Bump `version` in `package.json` when releasing the matching SDK
      version, then tag it `sdk-v<version>`.
- [ ] Run `npm test` locally.

## Income distribution

The contract has a single, canonical income-distribution path: the
accumulator-based `deposit_distribution` / `claim_distribution` pair. Income
is deposited per token and holders claim their pro-rata share from the
accumulator. This is the only income path documented and supported by the SDK.

### Removed legacy dividend entry points

Earlier contract versions also exposed a second, overlapping system:
`distribute_dividends`, `claim_dividends` and `set_dividend_policy` (with
withholding and reinvestment options). Those entry points are deprecated and
have been removed from the contract ABI — they are no longer callable and the
SDK does not wrap them. See `docs/adr/` for the consolidation decision.

### Migration for SDK consumers

If your integration used the legacy dividend methods, migrate as follows:

- Replace `distribute_dividends(...)` with `deposit_distribution(...)`.
  Withholding and reinvestment are no longer applied by the contract; perform
  any such policy off-chain before depositing.
- Replace `claim_dividends(...)` with `claim_distribution(...)`.
- Remove any calls to `set_dividend_policy(...)`; there is no on-chain
  replacement.
- Update the contract version in your `COMPATIBILITY_MATRIX` expectations to
  `>=0.5.0 <0.6.0` (SDK `0.2.x`) and re-run `npm test`.

```ts
// Deposit income for holders (admin), then let a holder claim their share.
await soroban.write('deposit_distribution', adminPublicKey, [/* amount ScVal */]);
await soroban.write('claim_distribution', holderPublicKey, []);
```

## Soroban transactions

Signing is injected so the SDK does not depend on a specific wallet provider:

```ts
import { SorobanClient } from '@trust-analysis/tokenized-fractional-sdk';
import { signTransaction } from '@stellar/freighter-api';

const soroban = new SorobanClient({
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org:443',
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID!,
  signer: async (xdr, networkPassphrase) => {
    const result = await signTransaction(xdr, { networkPassphrase });
    if (result.error || !result.signedTxXdr) throw new Error(result.error?.message ?? 'Signing failed');
    return result.signedTxXdr;
  },
});

const shares = await soroban.read('get_shares', publicKey, [/* Soroban ScVals */]);
const submitted = await soroban.write('buy_shares', publicKey, [/* Soroban ScVals */]);
```

The SDK simulates every read and write. Write operations assemble the simulation result before asking the injected signer to sign, then submit the signed transaction to Soroban RPC.