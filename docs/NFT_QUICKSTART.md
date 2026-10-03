# NFT Certificates — Quick Start

This guide deploys and enables NFT share certificates in a few minutes. It assumes the **RwaMarketplace** contract is already deployed and initialized (see the [development guide](development-setup.md)).

> For the full reference — how minting works, the SEP-41 contract API, metadata schema, wallet integration, and testing — see [NFT_CERTIFICATES.md](NFT_CERTIFICATES.md).

## Prerequisites

- The RwaMarketplace contract deployed and initialized with your payment token.
- Freighter Wallet and the Soroban CLI (`cargo install --locked soroban-cli`).
- An IPFS base URI for certificate metadata.

## 1. Deploy the ShareCertificate NFT Contract

The contract lives in `contracts/nft`:

```bash
cd contracts/nft
cargo build --target wasm32-unknown-unknown --release

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/share_certificate_nft.wasm \
  --source admin \
  --network testnet
# Returns: NFT_CONTRACT_ID
```

## 2. Initialize the NFT Contract

```bash
soroban contract invoke \
  --id <NFT_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  init \
  --minter <RWA_MARKETPLACE_CONTRACT_ID> \
  --uri "ipfs://QmYourMetadataBaseURI/" \
  --name "RWA Share Certificate" \
  --symbol "RWAC"
```

`minter` must be the RwaMarketplace contract address — it is the only account allowed to mint certificates.

## 3. Link the NFT Contract to the Marketplace

```bash
soroban contract invoke \
  --id <RWA_MARKETPLACE_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  set_nft_contract \
  --nft_contract <NFT_CONTRACT_ID>
```

## Done

From this point, every `buy_shares` call mints one NFT per share to the buyer. Certificates are viewable in Freighter Wallet and follow **SEP-41**, so they are tradable peer-to-peer and on secondary Soroban NFT marketplaces.

See [NFT_CERTIFICATES.md](NFT_CERTIFICATES.md) for the API reference, metadata best practices, and testing.