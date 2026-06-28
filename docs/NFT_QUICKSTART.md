# NFT Certificates — Quick Start

## Feature Summary

✅ **Already Implemented:**
- NFT contracts use Soroban's SEP-41 standard (via `stellar-tokens` library)
- `buy_shares` automatically mints one NFT per share when configured
- Full wallet compatibility with Freighter and other Stellar wallets
- Tested and verified in production code

## 1-Minute Setup

### Deploy NFT Contract

```bash
cd contracts/nft
cargo build --target wasm32-unknown-unknown --release

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/share_certificate_nft.wasm \
  --source admin \
  --network testnet
# Returns: NFT_CONTRACT_ID
```

### Initialize NFT Contract

```bash
soroban contract invoke \
  --id <NFT_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- init \
  --minter <RWA_MARKETPLACE_CONTRACT_ID> \
  --uri "ipfs://QmYourBaseURI/" \
  --name "RWA Share Certificate" \
  --symbol "RWAC"
```

### Link to Marketplace

```bash
soroban contract invoke \
  --id <RWA_MARKETPLACE_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- set_nft_contract \
  --nft_contract <NFT_CONTRACT_ID>
```

## Done! 

Users now get NFTs when buying shares. Certificates are:
- Viewable in Freighter Wallet
- Tradeable peer-to-peer
- Listed on secondary NFT marketplaces

See [NFT_CERTIFICATES.md](NFT_CERTIFICATES.md) for full technical details.
