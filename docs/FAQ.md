# Frequently Asked Questions & Troubleshooting Guide

This guide compiles common issues encountered by developers and users of the Tokenized Fractional Real-World Assets (RWA) Marketplace, along with step-by-step instructions to resolve them.

---

## Table of Contents
1. [Freighter Wallet & Connection Issues](#1-freighter-wallet--connection-issues)
2. [Transaction & Smart Contract Failures](#2-transaction--smart-contract-failures)
3. [Network & Configuration Problems](#3-network--configuration-problems)
4. [Backend API & Metadata Issues](#4-backend-api--metadata-issues)
5. [Advanced Operations (Vesting & Dividends)](#5-advanced-operations-vesting--dividends)

---

## 1. Freighter Wallet & Connection Issues

### Issue: Freighter Wallet Not Detected or Failed to Connect
* **Symptoms**: 
  * The frontend console displays: `[WalletStore] connect failed: Error`
  * UI shows an alert: `"Failed to connect Freighter wallet. Ensure the extension is installed and unlocked."`
  * Clicking "Connect Freighter" does nothing or displays a pending spinner infinitely.
* **Root Cause**: 
  * The Freighter browser extension is not installed.
  * The Freighter extension is locked (requires entering password).
  * The dApp does not have permission to connect to the extension.
  * The user is using an unsupported browser or mobile device without Freighter support.
* **Solution**:
  1. **Install Freighter**: Ensure the extension is installed. Get it from the official [Freighter Wallet website](https://www.freighter.app/).
  2. **Unlock the Wallet**: Click the Freighter extension icon in your browser toolbar and enter your password.
  3. **Check Connection Settings**: Open Freighter -> Settings -> Connected Sites, and verify that `http://localhost:5173` is permitted.
  4. **Reload**: Refresh the page (`F5` or `Ctrl+R`) and try clicking the **Connect Freighter** button again.

### Issue: Freighter Transaction Signing Failed / Rejected
* **Symptoms**:
  * Console displays: `[useSorobanWrite] Error executing tx buy_shares: Error: Freighter transaction signing failed`
  * UI displays: `Transaction buy_shares failed` or `Freighter transaction signing failed`
* **Root Cause**:
  * The user rejected the transaction popup inside the Freighter extension.
  * The extension timed out before the user signed the transaction.
* **Solution**:
  1. Open the Freighter popup and review the transaction parameters.
  2. Click **Sign** / **Approve** instead of Reject.
  3. If no popup appears, check if your browser blocked a popup or if the Freighter extension icon is flashing in the extension bar.

---

## 2. Transaction & Smart Contract Failures

### Issue: Transaction Failed — Check your token balance
* **Symptoms**:
  * Buying shares results in a red alert: `"Transaction failed. Check your token balance and try again."`
* **Root Cause**:
  * The buyer wallet does not have a sufficient balance of the required payment token (default Testnet token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`).
  * The buyer wallet does not have enough XLM to pay for transaction fees.
* **Solution**:
  1. **Check XLM balance**: Go to Freighter and ensure you have at least 2-5 XLM to cover base network reserves and gas/transaction fees. If on Testnet, you can fund your address via the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=testnet).
  2. **Check Payment Token balance**: Verify that your Freighter account holds the configured payment token. If you need to mint/receive tokens, contact the admin or use the Stellar Asset Client to mint tokens to your address.

### Issue: "Not enough shares available" Error
* **Symptoms**:
  * An alert box pops up: `"Not enough shares available."`
* **Root Cause**:
  * You are trying to buy more shares than the contract currently has left in its available pool (`AvailableShares`).
* **Solution**:
  1. Reduce your purchase quantity in the buy input to be less than or equal to the remaining available shares displayed in the marketplace.
  2. If you are the Administrator, you can increase the available share supply by invoking the `set_total_shares` function (or via the Admin panel).

### Issue: "Marketplace is currently paused" Error
* **Symptoms**:
  * Buying shares results in: `"Marketplace is currently paused. Try again later."`
* **Root Cause**:
  * The smart contract is currently in a paused state. The admin has called the `pause` method on the contract.
* **Solution**:
  * Wait for the administrator to unpause the marketplace.
  * If you are the Administrator, invoke the `unpause` method on the contract using the CLI or the Admin interface:
    ```bash
    soroban contract invoke --id <CONTRACT_ID> --source admin --network testnet -- unpause
    ```

---

## 3. Network & Configuration Problems

### Issue: "Set VITE_CONTRACT_ID in frontend/.env" Alert
* **Symptoms**:
  * The top of the page displays a warning: `"Set VITE_CONTRACT_ID in frontend/.env to connect to a deployed contract."`
* **Root Cause**:
  * The frontend development server is running, but the `frontend/.env` file is missing or `VITE_CONTRACT_ID` is set to the default placeholder `'C...'`.
* **Solution**:
  1. Ensure you have deployed the smart contract using `soroban contract deploy`.
  2. Copy the resulting contract ID (e.g., `CAS3...`).
  3. Create/edit `frontend/.env` and insert:
     ```env
     VITE_CONTRACT_ID=YOUR_COPIED_CONTRACT_ID
     VITE_RPC_URL=https://soroban-testnet.stellar.org:443
     VITE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
     VITE_API_URL=http://localhost:3001
     ```
  4. Restart your Vite development server (`npm run dev`).

### Issue: RPC Timeout / Connection Mismatch
* **Symptoms**:
  * Simulation fails with RPC errors or timeouts.
  * Unable to fetch initial share balance or available shares.
* **Root Cause**:
  * The RPC server (`https://soroban-testnet.stellar.org:443`) is temporarily down or rate-limited.
  * Your Freighter wallet network settings are set to **Mainnet** instead of **Testnet**.
* **Solution**:
  1. Open Freighter, click the network selection dropdown at the top, and ensure **Testnet** is selected.
  2. Verify that your `frontend/.env` has the correct `VITE_NETWORK_PASSPHRASE` matching Freighter's network settings.
  3. Check the [Stellar Status Page](https://status.stellar.org/) to see if Testnet is undergoing maintenance.

---

## 4. Backend API & Metadata Issues

### Issue: "VITE_API_URL not reachable" or Missing Asset Grid
* **Symptoms**:
  * "Available Assets" section shows a network error, is empty, or spins indefinitely.
  * Browser console displays CORS errors or `fetch failed` to `http://localhost:3001`.
* **Root Cause**:
  * The off-chain metadata Express API is not running.
  * The frontend `VITE_API_URL` environment variable points to the wrong port.
  * The backend `.env` has incorrect `CORS_ORIGINS` settings.
* **Solution**:
  1. **Start the backend**: Navigate to `/backend` and run `npm run dev`. Verify it outputs `Server running on port 3001`.
  2. **Verify CORS**: In `backend/.env`, ensure `CORS_ORIGINS` includes `http://localhost:5173`.
  3. **Check Frontend Config**: Confirm `frontend/.env` contains `VITE_API_URL=http://localhost:3001`.

---

## 5. Advanced Operations (Vesting & Dividends)

### Issue: Vested Shares "No vested shares available to claim"
* **Symptoms**:
  * Claiming vested shares panics or shows a transaction execution error.
* **Root Cause**:
  * The current ledger timestamp is prior to the vesting schedule's cliff or has not reached a point where new shares can be unlocked.
* **Solution**:
  * Verify the vesting duration on your schedule. You can check the current claimable shares using the `get_claimable_vested_shares` method before submitting a claim transaction.

### Issue: "Dividend amount must be positive" or "No holders registered"
* **Symptoms**:
  * Admin dividend distribution transactions fail.
* **Root Cause**:
  * Admin specified a `total_amount` of zero or negative.
  * No users have purchased shares yet, so the contract's holders list is empty.
* **Solution**:
  1. Ensure the distribution amount is greater than zero.
  2. Verify that at least one user has successfully purchased shares (`buy_shares`) before attempting to distribute dividends.
