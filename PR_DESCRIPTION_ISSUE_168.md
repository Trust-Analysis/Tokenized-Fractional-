## Summary

Implements [SIP-4](https://github.com/stellar/stellar-protocol/blob/master/core/sip-0004.md) / [SEP-46](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0046.md) contract metadata standard for the RWA Marketplace contract.

## Changes

### Compile-time metadata (Wasm custom section)
- Added `contractmeta!()` macro entries embedded in the `contractmetav0` Wasm section:
  - `name`: `RWA Marketplace`
  - `version`: `0.2.0`
  - `description`: `Tokenized Fractional RWA Marketplace`
  - `sep`: `41` (token interface compliance)

### Runtime metadata
- Defined `ContractMetadata` struct with `name`, `version`, and `description` fields (`#[contracttype]`)
- Added `ContractMetadata` variant to `DataKey` enum
- Metadata is stored in instance storage during `init()`
- Added public `get_contract_metadata()` query function

### Tests
- `test_get_contract_metadata_returns_expected_values` — validates name, version, description
- `test_get_contract_metadata_before_init_panics` — confirms panic on uninitialized read

### Documentation
- Updated `docs/architecture.md` with SIP-4 section, Wasm entries table, and data type reference

## Related

closes #168
