# Troubleshooting Guide

This guide covers common issues you may encounter while developing, deploying, or using the Tokenized Fractional RWA Marketplace.

## Table of Contents

- [Build Errors](#build-errors)
- [Deployment Failures](#deployment-failures)
- [Connection Issues](#connection-issues)
- [Transaction Failures](#transaction-failures)
- [Diagnostic Commands](#diagnostic-commands)

---

## Build Errors

### Frontend Build Fails with "Cannot find module"

**Problem**: `npm run build` fails with "Cannot find module" errors in the frontend directory.

**Solution**:
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Cause**: Corrupted node_modules or missing dependencies.

---

### Backend Compilation Error: "SyntaxError in Soroban contract"

**Problem**: Contract fails to compile with Rust syntax errors.

**Solution**:
```bash
cd contracts
cargo clean
cargo build --target wasm32-unknown-unknown
```

**Cause**: Stale build artifacts or dependency issues. The `cargo clean` forces a full rebuild.

---

### Vite Configuration Error: "Cannot read property 'ssrConfig'"

**Problem**: Frontend build fails with Vite configuration error.

**Solution**:
1. Check `frontend/vite.config.js` is valid JavaScript
2. Ensure all imports in config are correct:
   ```bash
   cd frontend
   npm install
   ```
3. Try rebuilding:
   ```bash
   npm run build
   ```

**Cause**: Missing dependencies or corrupted Vite cache.

---

## Deployment Failures

### Backend Service Fails to Start on Render

**Problem**: Backend service shows "Failed to bind port" or "EADDRINUSE" error.

**Solution**:
1. Check environment variables in Render dashboard:
   - Ensure `PORT=3001` is set
   - Verify `NODE_ENV=production`
2. Check health check path: should be `/health`
3. Redeploy the service:
   ```bash
   # Manual reboot in Render dashboard
   ```

**Cause**: Port conflict or misconfigured environment variables.

---

### Frontend Fails to Deploy: "Build command failed"

**Problem**: Frontend static site fails during build on Render.

**Solution**:
1. Check build command: should be `npm install && npm run build`
2. Verify `staticPublishPath` is set to `dist`
3. Ensure all environment variables are set:
   - `VITE_CONTRACT_ID` - deployed contract address
   - `VITE_RPC_URL` - Soroban RPC endpoint
   - `VITE_API_URL` - backend URL (e.g., https://rwa-marketplace-backend.onrender.com)

**Diagnostic**:
```bash
cd frontend
npm install
npm run build
ls -la dist/  # verify dist folder exists
```

---

### Database Connection Fails

**Problem**: Backend cannot connect to database (if using PostgreSQL).

**Solution**:
1. Verify connection string is correct:
   ```bash
   echo $DATABASE_URL
   ```
2. Test connection:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```
3. Check firewall/network rules allow connection
4. Restart the service

---

## Connection Issues

### Frontend Cannot Reach Backend API

**Problem**: Frontend shows "Failed to fetch" or CORS error.

**Error message**:
```
Access to XMLHttpRequest at 'https://rwa-marketplace-backend.onrender.com/api/rwa' 
from origin 'https://rwa-marketplace-frontend.onrender.com' has been blocked by CORS policy
```

**Solution**:
1. Check CORS configuration in `backend/index.js`:
   ```javascript
   cors({
     origin: process.env.CORS_ORIGINS?.split(',') || '*',
     credentials: true
   })
   ```
2. Set `CORS_ORIGINS` environment variable in Render backend settings to include frontend URL
3. Restart backend service
4. Clear browser cache and reload

**Alternative**: Test API directly:
```bash
curl https://rwa-marketplace-backend.onrender.com/api/rwa
```

---

### Cannot Connect to Soroban RPC

**Problem**: Frontend shows "RPC connection failed" or "Cannot fetch RPC data".

**Error example**:
```
TypeError: Failed to fetch
/api/rwa connection refused
```

**Solution**:
1. Verify RPC URL is correct in environment variables
2. Test RPC endpoint manually:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org:443 \
     -H "Content-Type: application/json" \
     -d '{"method":"sorobanrpc/getHealth","params":[],"id":1,"jsonrpc":"2.0"}'
   ```
3. If RPC is down, check Stellar status page: https://status.stellar.org/
4. Ensure contract is deployed on the network

---

### Freighter Wallet Not Detecting Contract

**Problem**: Freighter shows "Contract not found" error when attempting to invoke.

**Solution**:
1. Verify contract ID is correct:
   ```bash
   stellar contract info --network testnet <CONTRACT_ID>
   ```
2. Check contract is deployed on correct network (testnet vs mainnet)
3. Update `VITE_CONTRACT_ID` if contract was redeployed
4. Clear Freighter cache:
   - Extension menu → Settings → Clear Cache
   - Reload browser
4. Verify contract invocation in RPC:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org \
     -d '{"jsonrpc":"2.0","id":"1","method":"sorobanrpc/getContractData","params":{"contractId":"<CONTRACT_ID>"}}'
   ```

---

## Transaction Failures

### "Insufficient Balance" when Buying Shares

**Problem**: User tries to buy shares but transaction fails with insufficient balance error.

**Solution**:
1. Check user has enough payment tokens (USDC or configured token):
   ```bash
   # Via Freighter: View Assets tab
   # Or check on Stellar Expert: https://stellar.expert/explorer/testnet/
   ```
2. Verify user has at least 1 XLM for transaction fees:
   ```bash
   # Check account on Stellar Expert or via RPC
   ```
3. If on testnet, request funding:
   ```bash
   curl https://friendbot.stellar.org/?addr=<ACCOUNT_ADDRESS>
   ```

---

### Transaction Timeout or "Transaction Pending"

**Problem**: Transaction submitted but appears to be pending indefinitely.

**Error**:
```
Transaction submitted but result not available (timeout)
Tx: xxxxxxx
```

**Solution**:
1. Wait a few more seconds (Soroban transactions can take up to 30 seconds)
2. Check transaction status on Stellar Expert:
   ```
   https://stellar.expert/explorer/testnet/tx/<TRANSACTION_HASH>
   ```
3. If still pending after 2 minutes, the transaction likely failed:
   - Try again with a new transaction
   - Check RPC is healthy (test with `/health` endpoint)

---

### "Shares Not Available" Error

**Problem**: User attempts to buy shares but gets error that asset/shares are unavailable.

**Solution**:
1. Check asset exists in `data.json`:
   ```bash
   grep "<ASSET_ID>" backend/data.json
   ```
2. Verify asset has available shares:
   ```json
   {
     "id": "asset1",
     "totalShares": 1000,
     "availableShares": 500,  // Must be > 0
     "pricePerShare": 10
   }
   ```
3. Check contract state:
   ```bash
   soroban contract inspect --network testnet <CONTRACT_ID>
   ```

---

### "Insufficient Gas" or "Transaction Too Large"

**Problem**: Soroban contract execution fails with gas/resource limit error.

**Solution**:
1. **Reduce data size**: Pass smaller data payloads to contract
2. **Optimize contract**: Check contract code for inefficient loops
3. **Increase transaction fee**:
   ```javascript
   // In frontend transaction building
   builder.setFee('10000')  // Increase from default
   ```
4. **Rebuild contract in release mode**:
   ```bash
   cd contracts
   cargo build --target wasm32-unknown-unknown --release
   ```

---

## Diagnostic Commands

### Check Backend Health

```bash
# Test API endpoint
curl https://rwa-marketplace-backend.onrender.com/health

# Fetch assets
curl https://rwa-marketplace-backend.onrender.com/api/rwa

# Check logs
# Via Render dashboard: View Logs tab
```

### Check Frontend Build

```bash
cd frontend

# Verify build succeeds
npm run build

# Check bundle size
npm run build -- --report

# Serve production build locally
npm install -g serve
serve -s dist
```

### Check Soroban Contract

```bash
# View contract details
soroban contract info --network testnet <CONTRACT_ID>

# Get contract source (if uploaded to IPFS)
curl https://ipfs.io/ipfs/<HASH>

# Check contract events
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "sorobanrpc/getEvents",
    "params": {
      "filters": [{"type": "contract", "contractIds": ["<CONTRACT_ID>"]}],
      "limit": 100
    }
  }'
```

### Test RPC Connection

```bash
# Check Soroban RPC health
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"method":"sorobanrpc/getHealth","params":[],"id":1,"jsonrpc":"2.0"}'

# Expected response:
# {"jsonrpc":"2.0","result":{"status":"healthy"},"id":"1"}
```

### Debug Environment Variables

```bash
# Backend
echo "PORT: $PORT"
echo "NODE_ENV: $NODE_ENV"
echo "CORS_ORIGINS: $CORS_ORIGINS"

# Frontend (build time)
echo "VITE_CONTRACT_ID: $VITE_CONTRACT_ID"
echo "VITE_RPC_URL: $VITE_RPC_URL"
echo "VITE_API_URL: $VITE_API_URL"
```

---

## Getting Help

If your issue is not covered here:

1. **Check existing issues**: https://github.com/Trust-Analysis/Tokenized-Fractional-/issues
2. **Review logs**: Check Render dashboard logs or local terminal output
3. **Enable debug mode**: Set `DEBUG=*` for verbose logging
4. **Contact the team**: Open a new issue with:
   - Error message and stack trace
   - Steps to reproduce
   - Environment (testnet/mainnet, which browser, OS)
   - Diagnostic command outputs

