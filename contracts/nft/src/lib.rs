#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};
use stellar_tokens::non_fungible::{Base, NonFungibleToken};

/// Storage keys for this contract.
#[contracttype]
enum DataKey {
    /// The address authorised to mint (the marketplace contract).
    Minter,
}

/// Optimized packed struct for batch minting operations
/// Packs address (160 bits) + u32 (32 bits) into single storage slot
#[contracttype]
#[derive(Clone)]
pub struct MintRequest {
    pub to: Address,
    pub count: u32,
}

/// Issue #942: documented maximum number of certificates that a single
/// batch-mint entry point may mint. Each minted certificate performs a
/// storage write inside `Base::sequential_mint`, so the per-call work (and
/// therefore the Soroban resource/instruction budget consumed) grows linearly
/// with the batch size. Capping the batch keeps a single call — however large
/// the legitimate purchase or the misconfigured/malicious call from the
/// registered minter — comfortably within the transaction limits instead of
/// failing opaquely on resource exhaustion.
pub const MAX_BATCH_MINT_SIZE: u32 = 100;

#[contract]
pub struct ShareCertificate;

#[contractimpl]
impl ShareCertificate {
    /// Called once after deployment.
    ///
    /// * `minter`  – the marketplace contract address (only caller allowed to mint)
    /// * `uri`     – base URI for token metadata (e.g. `ipfs://Qm…/`)
    /// * `name`    – collection name, e.g. "RWA Share Certificate"
    /// * `symbol`  – collection symbol, e.g. "RWAC"
    pub fn init(e: Env, minter: Address, uri: String, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Minter) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Minter, &minter);
        Base::set_metadata(&e, uri, name, symbol);
    }

    /// Mint a share-certificate NFT to `to`.
    ///
    /// Only the address stored as `Minter` (the marketplace contract) may call
    /// this. Returns the new `token_id`.
    pub fn mint_certificate(e: Env, to: Address) -> u32 {
        let minter: Address = e
            .storage()
            .instance()
            .get(&DataKey::Minter)
            .expect("not initialized");
        minter.require_auth();
        Base::sequential_mint(&e, &to)
    }

    /// Batch mint share-certificate NFTs to multiple recipients.
    ///
    /// Optimized gas-efficient batch minting that reduces storage operations
    /// by processing multiple mint requests in a single transaction.
    ///
    /// * `requests` – vector of (recipient_address, count) pairs
    /// Returns the total number of NFTs minted.
    ///
    /// Issue #942: enforces a documented maximum batch size
    /// (`MAX_BATCH_MINT_SIZE`). Panics with a clear error when the batch would
    /// exceed the ceiling, rather than letting the call fail opaquely on
    /// Soroban resource exhaustion.
    pub fn batch_mint_certificates(e: Env, requests: Vec<MintRequest>) -> u32 {
        let minter: Address = e
            .storage()
            .instance()
            .get(&DataKey::Minter)
            .expect("not initialized");
        minter.require_auth();

        let mut total_minted: u32 = 0;

        // Process mint requests directly from calldata to avoid memory copies
        for i in 0..requests.len() {
            let request = requests.get(i).unwrap();
            // A zero-count entry represents no mints and mints nothing.
            if request.count == 0 {
                continue;
            }
            // Issue #942: reject any single-entry batch that exceeds the
            // documented maximum before touching storage.
            if request.count > MAX_BATCH_MINT_SIZE {
                panic!("Batch mint exceeds maximum batch size of {}", MAX_BATCH_MINT_SIZE);
            }
            // Issue #942: reject batches whose cumulative mint count exceed
            // the documented maximum before touching storage.
            let new_total = total_minted.saturating_add(request.count);
            if new_total > MAX_BATCH_MINT_SIZE {
                panic!("Batch mint exceeds maximum batch size of {}", MAX_BATCH_MINT_SIZE);
            }
            total_minted = new_total;
            for _ in 0..request.count {
                Base::sequential_mint(&e, &request.to);
            }
        }

        total_minted
    }

    /// Batch mint multiple certificates to a single recipient.
    ///
    /// More efficient version when minting multiple NFTs to the same address.
    ///
    /// * `to` – recipient address
    /// * `count` – number of NFTs to mint
    /// Returns the starting token ID.
    ///
    /// Issue #941: rejects `count == 0` before any mint happens — previously
    /// the first `Base::sequential_mint` ran unconditionally, so a zero count
    /// still minted a single (unintended) certificate.
    ///
    /// Issue #942: enforces the documented maximum batch size
    /// (`MAX_BATCH_MINT_SIZE`) with a clear error instead of risking a single
    /// call exceeding the transaction's Soroban resource/instruction budget.
    pub fn batch_mint_to_single(e: Env, to: Address, count: u32) -> u32 {
        let minter: Address = e
            .storage()
            .instance()
            .get(&DataKey::Minter)
            .expect("not initialized");
        minter.require_auth();

        // Issue #941: a zero count must not mint anything. The first mint used
        // to run unconditionally before the loop, so `count == 0` minted one
        // certificate anyway.
        if count == 0 {
            panic!("count must be greater than zero");
        }

        // Issue #942: enforce the documented maximum batch size so a single
        // call cannot exceed the Soroban resource/instruction budget.
        if count > MAX_BATCH_MINT_SIZE {
            panic!("Batch mint exceeds maximum batch size of {}", MAX_BATCH_MINT_SIZE);
        }

        let start_id = Base::sequential_mint(&e, &to);

        // Mint remaining certificates
        for _ in 1..count {
            Base::sequential_mint(&e, &to);
        }

        start_id
    }
}

// Expose the full NonFungibleToken interface so wallets and marketplaces can
// call standard functions (balance, owner_of, token_uri, transfer, approve …).
#[contractimpl(contracttrait)]
impl NonFungibleToken for ShareCertificate {
    type ContractType = Base;
}
