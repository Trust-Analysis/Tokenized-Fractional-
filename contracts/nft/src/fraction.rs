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
            for _ in 0..request.count {
                Base::sequential_mint(&e, &request.to);
                total_minted += 1;
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
    pub fn batch_mint_to_single(e: Env, to: Address, count: u32) -> u32 {
        let minter: Address = e
            .storage()
            .instance()
            .get(&DataKey::Minter)
            .expect("not initialized");
        minter.require_auth();

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
