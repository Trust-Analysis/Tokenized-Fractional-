# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest (main) | ✅ |

## Scope

This policy covers security vulnerabilities in:

- **Smart Contract** (`contracts/`) — Soroban/Rust logic handling share purchases, admin controls, and token transfers on the Stellar network.
- **Backend API** (`backend/`) — Express.js off-chain metadata service.
- **Frontend** (`frontend/`) — React + Vite dApp interacting with Freighter wallet and Soroban RPC.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via one of these channels:

1. **GitHub Private Vulnerability Reporting** (preferred): [Report a vulnerability](https://github.com/Trust-Analysis/Tokenized-Fractional-/security/advisories/new)
2. **Email**: Send details to the repository maintainers. Find contact info in the repository's GitHub profile.

### What to include

- A clear description of the vulnerability and its potential impact.
- The component affected (smart contract / backend / frontend).
- Steps to reproduce or a proof-of-concept (PoC).
- Any suggested mitigations.

## Response Timeline

| Stage | Target |
| ----- | ------ |
| Acknowledgement | Within 72 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days (critical issues sooner) |
| Public disclosure | After fix is deployed |

## Smart Contract Considerations

The Soroban smart contract manages financial transactions on the Stellar network. High-severity issues include:

- Unauthorised access to `admin`-only functions (`pause`, `unpause`, `emergency_withdraw`).
- Re-entrancy or integer overflow in `buy_shares`.
- Bypassing the pause mechanism.
- Token drain or fund misappropriation.

## Disclosure Policy

We follow a **coordinated disclosure** model. We ask reporters to keep the vulnerability confidential until we have released a fix and notified affected users.

We will credit researchers who responsibly disclose valid vulnerabilities (unless they prefer to remain anonymous).

## Out of Scope

- Vulnerabilities in third-party dependencies (report those upstream).
- Issues that require physical access to a user's device.
- Social engineering attacks.
- Freighter Wallet bugs (report to [Freighter](https://github.com/stellar/freighter)).
