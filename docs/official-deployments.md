# Official contract deployments

[The deployment registry](../backend/deployments.json) records the contract
ID, network, Wasm SHA-256, deploy transaction hash and source commit.

Run the marketplace deployment with Stellar CLI 27.1 or newer and a configured
signing identity. Run it from the repository root after building the Wasm
from the checked-out source commit.

```sh
node scripts/deploy-marketplace.mjs testnet admin \
  contracts/target/wasm32-unknown-unknown/release/rwa_marketplace.wasm
```

The command records the new contract as pending after deployment and confirms
the remote Wasm hash. Review the entry and commit the registry update. Promote
the entry to active when it is ready for release and regenerate the frontend
manifest using the existing offline signing command. The signed manifest
must include the active contracts for its network. Use a new payload version
and issuance date when publishing an updated manifest.

The pre-registry Testnet reference is retained as a legacy entry because it
appears in the current signed manifest. The Testnet RPC returned no contract
for this address during registry migration. Its deployment metadata is
unavailable.

To pin a registered deployment in backend configuration, set
`SOROBAN_NETWORK` and `SOROBAN_CONTRACT_ID`. CI checks committed contract
IDs against the registry for their configured networks.
