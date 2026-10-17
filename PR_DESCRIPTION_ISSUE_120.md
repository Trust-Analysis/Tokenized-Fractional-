# PR Description: Add FAQ / Troubleshooting Guide (#120)

## Description
This PR addresses issue #120 by introducing a comprehensive Troubleshooting & FAQ guide for the Tokenized Fractional RWA Marketplace. The guide helps developers and end-users resolve common friction points including wallet detection errors, contract panics, transaction fee shortfalls, network RPC issues, and backend API connectivity errors.

Additionally, a new section has been appended to the main `README.md` to directly reference and link this guide.

## Related Issue
Closes #120

## Proposed Changes
- **New File**: `docs/FAQ.md`
  - Created a detailed problem-solution index categorized into five key areas:
    1. Freighter Wallet & Connection Issues (installation, unlocked state, permissions).
    2. Transaction & Smart Contract Failures (gas/XLM balances, total share availability checks, contract paused alerts).
    3. Network & Configuration Problems (testnet/mainnet passphrase matching, RPC node availability).
    4. Backend API & Metadata Issues (CORS origins, dev port config, metadata grid failures).
    5. Advanced Operations (Vesting schedules, claimable vested shares, dividend distributions).
- **Modified File**: `README.md`
  - Added a new `Troubleshooting & FAQ` section linking to `docs/FAQ.md`.

## Verification & Testing
1. **File Existence**: Verified `docs/FAQ.md` has been successfully created.
2. **Path Resolution**: Verified the relative link in `README.md` correctly resolves to `docs/FAQ.md`.
3. **Typo and Format Check**: Inspected the Markdown layout, ensuring tables, list formatting, and deep links render correctly.
