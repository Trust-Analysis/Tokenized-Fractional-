# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **For contributors:** Please update this file with a brief description of your changes
> under the `[Unreleased]` section when opening a pull request. Use the appropriate
> subsection (`Added`, `Changed`, `Fixed`, `Removed`, `Security`).

## [Unreleased]

## [0.1.0] - 2026-06-28

### Added

- **Share buyback mechanism** — admin can buy back tokenized shares from holders (#163)
- **Tokenized shares transfer** — users can transfer their fractional shares to other addresses (#142)
- **Docker Compose** — multi-service orchestration for local development (#160)
- **FAQ documentation** — answers to common questions added to docs (#147)
- **Transaction history page** — frontend view of past buy/transfer transactions (#157)
- **Confirm purchase modal** — confirmation dialog before buying shares (#145)
- **Theme toggle** — light/dark mode support across the UI (#148)
- **PDF share certificate** — downloadable ownership certificate for purchased shares (#149)
- **Portfolio page** — dedicated page showing user's asset holdings (#134)
- **Notification system** — in-app notifications for contract events (#133)
- **Toast notification system** — transient UI feedback toasts (#137)
- **Request ID tracking** — backend middleware attaches unique IDs to each request (#136)
- **Mobile hamburger navigation** — responsive nav menu for small screens (#129)
- **Admin dashboard** — management interface for marketplace administration (#65)
- **Asset listing grid** — card-based grid view for browsing tokenized assets (#64)
- **Admin timelock** — time-locked execution for sensitive admin operations (#63)
- **Dividend distribution** — contract function to distribute dividends to shareholders (#62)
- **Global state management** — centralised React context for app-wide state (#61)
- **Secondary market** — peer-to-peer share trading between users (#77)
- **Vesting schedule** — time-based token vesting for allocated shares (#72)
- **Whitelist managed by admin** — admin-controlled buyer whitelist (#74)
- **Overflow-safe math helpers** — safe arithmetic utilities in the smart contract (#70)
- **Storybook** — component development and documentation environment (#69)
- **On-chain metadata** — store asset metadata on-chain (#75)
- **Content Security Policy** — CSP headers added to backend (#152)
- **i18n / internationalisation** — multi-language support scaffolding (#158)
- **Sentry monitoring** — error tracking and performance monitoring (#66)
- **Deployment config** — production deployment configuration files (#155)
- **SECURITY.md** — vulnerability disclosure and security policy (#156)
- **CONTRIBUTING.md** — contribution guidelines (#67)
- **Local development setup script** — automated environment bootstrap script (#153)
- **Demo walkthrough** — animated walkthrough banner added to README (#151)
- **Redis caching** — backend response caching with Redis (#59)
- **Structured logging** — JSON-structured log output for the backend (#58)
- **Pagination** — paginated responses for backend API list endpoints (#57)
- **Health check endpoint** — `GET /health` for liveness probing (#60)
- **Loading states and skeletons** — skeleton screens while data is fetching (#56)
- **Property-based / fuzz testing** — fuzz tests for smart contract logic (#71)
- **Edge-case test suite** — extended unit tests covering contract edge cases (#76)
- **EditorConfig** — `.editorconfig` for consistent editor settings (#139)
- **Playwright gitignore entries** — output directories excluded from version control (#162)

### Changed

- Split `App.jsx` into smaller, focused components (#138)
- Extracted Soroban hooks into a dedicated hooks module (#126)
- Refactored inline styles to CSS classes (#39)
- Docker setup extended with error boundary and React Router (#154)

### Fixed

- Freighter wallet contract transaction assembly and signing flow (#19)
- README and `.env.example` network passphrase quoting (#20)
- Replaced `unwrap()` calls with descriptive `expect()` messages (#73, #146)
- Removed deprecated `#[allow]` attributes from smart contract (#135)
- `set_price` and `set_total_shares` admin functions corrected (#68)
- Replaced deprecated Soroban / Stellar SDK APIs (#22)
- `init` function input validation tightened (#127)
- Error constants extracted to a shared module (#141)

### Security

- Content Security Policy headers (#152)
- SECURITY.md with responsible disclosure process (#156)
- Admin whitelist controls (#74)

## [0.0.1] - 2026-06-17

### Added

- Initial project: Soroban smart contract (`RwaMarketplace`) written in Rust
- Express.js backend API for off-chain asset metadata storage
- React + Vite frontend with Freighter wallet integration
- Core contract functions: `init`, `buy_shares`, `get_shares`, `get_available_shares`,
  `get_total_shares`, `get_price`, `pause`, `unpause`, `emergency_withdraw`
- Backend endpoints: `GET /api/rwa`, `POST /api/rwa`, `DELETE /api/rwa/:contractId`
- Swagger UI at `/api-docs`
- Render deployment blueprint (`render.yaml`)
- Nginx reverse-proxy configuration with rate limiting
- Jest + Supertest test suite for backend API (#21)
- Docker support for the backend service

[Unreleased]: https://github.com/Trust-Analysis/Tokenized-Fractional-/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Trust-Analysis/Tokenized-Fractional-/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/Trust-Analysis/Tokenized-Fractional-/releases/tag/v0.0.1
