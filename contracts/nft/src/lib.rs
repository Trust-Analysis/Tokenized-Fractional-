#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};
use stellar_tokens::non_fungible::{Base, NonFungibleToken};

/// Storage keys for this contract.
#[contracttype]
enum DataKey {
    /// The address authorised to mint (the marketplace contract).
    Minter,
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
}

// Expose the full NonFungibleToken interface so wallets and marketplaces can
// call standard functions (balance, owner_of, token_uri, transfer, approve …).
#[contractimpl(contracttrait)]
impl NonFungibleToken for ShareCertificate {
    type ContractType = Base;
}
