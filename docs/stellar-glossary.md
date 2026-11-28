# Stellar and Soroban Glossary

Short definitions for contributors and users who are new to Stellar. These terms explain the technology, not the legal rights or risks of a marketplace asset.

| Term | Plain-language meaning | Further reading |
| --- | --- | --- |
| **Stellar** | A public network for recording and transferring digital assets and payments. | [Stellar basics](https://developers.stellar.org/docs/learn/fundamentals/stellar-basics) |
| **Soroban** | Stellar's smart-contract platform. Contracts run as programs on the network and can read or change ledger state. | [Soroban overview](https://developers.stellar.org/docs/build/smart-contracts/overview) |
| **SEP-41** | A Stellar Ecosystem Proposal defining a common interface for token contracts, including operations such as reading balances and transferring tokens. | [SEP-41 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) |
| **Freighter** | A browser wallet that holds Stellar accounts and asks the user to approve transaction signatures. The application should receive signatures, not the wallet's secret key. | [Freighter](https://www.freighter.app/) |
| **Testnet passphrase** | The network identifier used when building and signing a transaction. It ensures a transaction is intended for Stellar Testnet rather than another Stellar network. | [Stellar networks](https://developers.stellar.org/docs/networks) |
| **Contract WASM** | The compiled WebAssembly program for a Soroban contract. It is uploaded to Stellar and then instantiated at a contract address. | [Deploy a contract](https://developers.stellar.org/docs/build/smart-contracts/getting-started/deploy-to-testnet) |
| **Soroban RPC** | The HTTP API used by applications to query ledger data, simulate contract calls, and submit transactions. | [Soroban RPC API](https://developers.stellar.org/docs/data/rpc) |
| **Simulate transaction** | Ask an RPC server to execute a proposed contract transaction without submitting it. The response includes whether it would succeed and the resources it would need. | [simulateTransaction](https://developers.stellar.org/docs/data/rpc/api-reference/methods/simulateTransaction) |
| **Submit transaction** | Send a signed transaction to the network through Soroban RPC. Submission is not the same as final confirmation; check its status before treating it as settled. | [sendTransaction](https://developers.stellar.org/docs/data/rpc/api-reference/methods/sendTransaction) |
| **Network passphrase** | A string identifying the Stellar network. It is included in transaction signatures so a transaction signed for one network cannot be replayed as-is on another. | [Network configuration](https://developers.stellar.org/docs/networks) |