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
```

`baseUrl` may be the service root or an existing `/api/v1` URL. API errors are thrown as `ApiError` with `status` and parsed `body` fields.

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