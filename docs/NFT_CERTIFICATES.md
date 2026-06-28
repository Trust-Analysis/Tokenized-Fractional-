# NFT Share Certificates

## Overview

When users purchase fractional shares of a real-world asset on the RWA Marketplace, they automatically receive NFT share certificates representing their ownership. These NFTs are compliant with **Soroban's SEP-41 Non-Fungible Token standard** and can be:

- **Viewed** in wallet applications that support Soroban NFTs (e.g., Freighter Wallet)
- **Traded** on secondary NFT marketplaces built on Stellar
- **Transferred** peer-to-peer to other Stellar addresses
- **Used** as collateral in lending protocols or other DeFi applications

## How It Works

### Minting Process

1. User calls `buy_shares(shares)` on the RwaMarketplace contract
2. The contract transfers the payment tokens to the admin address
3. If an NFT contract is configured, the marketplace mints **one NFT per share purchased** to the buyer's address
4. Each NFT is sequentially numbered and represents a unique certificate

### SEP-41 Compliance

The ShareCertificate contract implements the full **SEP-41 Non-Fungible Token** interface via the `stellar-tokens` library:

- **Sequential Minting**: Each NFT receives a unique `token_id`
- **Standard Methods**: Supports `transfer`, `approve`, `balance_of`, `owner_of`, `token_uri`, and more
- **Metadata**: Each NFT links to metadata (name, description, image) via a base URI

## Setup

### 1. Deploy the ShareCertificate NFT Contract

The ShareCertificate contract is located in `contracts/nft/`:

```bash
cd contracts/nft
cargo build --target wasm32-unknown-unknown --release
```

Deploy using Soroban CLI:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/share_certificate_nft.wasm \
  --source admin \
  --network testnet
```

Copy the returned Contract ID (starts with `C`).

### 2. Initialize the NFT Contract

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

**Parameters:**
- `minter`: The RwaMarketplace contract address (only entity allowed to mint certificates)
- `uri`: Base IPFS URI for NFT metadata (e.g., `ipfs://Qm.../`)
- `name`: Collection name (displayed in wallets)
- `symbol`: Collection symbol (short identifier)

### 3. Link the NFT Contract to the Marketplace

Once both contracts are deployed, call `set_nft_contract` on the RwaMarketplace to enable minting:

```bash
soroban contract invoke \
  --id <RWA_MARKETPLACE_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  set_nft_contract \
  --nft_contract <NFT_CONTRACT_ID>
```

From this point forward, every `buy_shares` call will mint NFTs to the buyer.

## Smart Contract API

### RwaMarketplace

| Function | Parameters | Description | Auth |
|----------|-----------|-------------|------|
| `set_nft_contract` | `nft_contract: Address` | Configure the NFT contract for certificate minting | Admin |
| `buy_shares` | `token: Address, shares: u32` | Purchase shares and mint NFTs (if configured) | Buyer (whitelisted) |

### ShareCertificate (SEP-41)

| Function | Parameters | Description | Auth |
|----------|-----------|-------------|------|
| `init` | `minter, uri, name, symbol` | Initialize NFT contract | Any (once only) |
| `mint_certificate` | `to: Address` | Mint a new certificate NFT | Minter only |
| `transfer` | `from, to, token_id` | Transfer NFT ownership | Owner or approved |
| `approve` | `owner, spender, token_id` | Approve address to transfer NFT | Owner |
| `balance_of` | `account: Address` | Get user's NFT balance | Any |
| `owner_of` | `token_id: u32` | Get owner of specific NFT | Any |
| `token_uri` | `token_id: u32` | Get metadata URI for NFT | Any |

## Metadata

NFTs link to metadata via a base URI set during initialization. For example:

```
Base URI: ipfs://QmYourHash/
Token ID: 1
Full URI: ipfs://QmYourHash/1.json
```

Each metadata file should follow the SEP-41 metadata schema (similar to NFT standards across blockchains):

```json
{
  "name": "RWA Share Certificate #1",
  "description": "Share certificate representing ownership of fractional real-world asset",
  "image": "ipfs://QmImageHash/certificate-1.png",
  "attributes": [
    {
      "trait_type": "Asset Class",
      "value": "Real Estate"
    },
    {
      "trait_type": "Certificate Number",
      "value": "1"
    }
  ]
}
```

## Wallet Integration

### Freighter Wallet

Freighter supports SEP-41 NFTs. To view your certificates:

1. Open Freighter
2. Navigate to **Assets** or **Collectibles**
3. Your share certificates appear with metadata and images
4. Click to transfer, approve, or view details

### Secondary Marketplaces

Once Stellar's NFT ecosystem matures, these certificates can be listed on secondary marketplaces. The contracts support all standard transfer and approval methods required for marketplace integration.

## Testing

Run the contract tests to verify NFT minting:

```bash
cd contracts
cargo test test_buy_shares_mints_nfts -- --nocapture
```

This test verifies that:
- Buying shares mints the correct number of NFTs
- NFTs are owned by the buyer
- The marketplace contract can mint (via `NftContractClient`)

## Notes

- **No Fee on NFT Minting**: Minting certificates is part of the share purchase transaction; no separate fee is charged.
- **Backward Compatibility**: If no NFT contract is set, `buy_shares` works normally without minting (verified by `test_buy_shares_without_nft_contract_still_works`).
- **One NFT per Share**: Each share purchased mints exactly one NFT certificate, providing clear 1:1 traceability.
- **Metadata Best Practices**: Host metadata and images on IPFS or Arweave for decentralized, censorship-resistant storage.
