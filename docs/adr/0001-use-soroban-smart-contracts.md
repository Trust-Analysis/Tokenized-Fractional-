# ADR-0001: Use Soroban Smart Contracts for RWA Marketplace

**Date:** 2026-06-28  
**Status:** Accepted  
**Author:** Team

## Context

The project needed a smart contract platform to handle tokenization of real-world assets (RWA) on a blockchain. The solution needed to be:
- Reliable and secure for financial transactions
- Accessible to a broad audience without high barriers to entry
- Capable of handling fractional share ownership
- Integrated with existing Stellar ecosystem tooling

## Decision

We chose **Soroban Smart Contracts** on the Stellar Network to implement the core RWA marketplace logic. Soroban uses Rust for contract development and provides native integration with the Stellar ledger.

## Consequences

### Positive
- **Built on Stellar**: Leverages the Stellar Network's reliability and federation model
- **Rust-based**: Strong type system and memory safety prevent common smart contract vulnerabilities
- **Direct blockchain integration**: No cross-chain bridges needed
- **Low transaction costs**: Stellar's architecture keeps fees minimal
- **Freighter wallet support**: Excellent UX for Stellar-based transactions
- **Testnet availability**: Easy to test before mainnet deployment

### Negative
- **Smaller ecosystem**: Fewer third-party tools compared to Ethereum/Solana
- **Learning curve**: Rust and Soroban are newer to many developers
- **Limited DeFi options**: Fewer existing protocols to integrate with
- **Platform dependency**: Tied to Stellar Network's development roadmap

## Alternatives Considered

### Ethereum + Solidity
Rejected due to high gas fees, more complex tooling, and not aligned with Stellar's accessibility goals.

### Cosmos SDK
Rejected because it requires running validator nodes; Stellar's simpler model better fits our use case.

### Hyperledger Fabric
Rejected because it's enterprise-focused and lacks the public blockchain benefits we need.

## Notes

- Soroban contracts are written in Rust and compiled to WebAssembly
- The contract uses the Stellar Asset Contract for payment tokens
- Integration with Freighter provides seamless transaction signing
