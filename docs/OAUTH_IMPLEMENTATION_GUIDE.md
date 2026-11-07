# OAuth 2.0 Multi-Provider Authentication Guide

To provide flexible and secure authentication options, the RWA Marketplace supports multi-provider OAuth 2.0 with Google, GitHub, and Discord.

## 1. Security Best Practices (OAuth 2.1 & PKCE)
- **PKCE (Proof Key for Code Exchange):** Every authorization request generates a cryptographically secure `code_verifier` and `code_challenge` (S256), mitigating authorization code interception attacks.
- **State Parameter Validation:** Cryptographic `state` tokens protect against Cross-Site Request Forgery (CSRF).

## 2. Supported Identity Providers
- **Google:** OpenID Connect (OIDC) flow requesting `openid email profile`.
- **GitHub:** OAuth 2.0 flow requesting `user:email read:user`.
- **Discord:** OAuth 2.0 flow requesting `identify email`.

## 3. Account Linking & Profile Normalization
The `OAuthService.normalizeProfile()` method standardizes disparate provider JSON payloads into a unified user profile object, enabling seamless account linking across multiple identity providers.
