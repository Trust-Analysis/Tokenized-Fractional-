# Contributing to Tokenized Fractional RWA Marketplace

Thank you for your interest in contributing! This document outlines the process and guidelines for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Pull Request Process](#pull-request-process)
- [Local Secret Scanning](#local-secret-scanning)
- [Testing](#testing)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

Be respectful, collaborative, and constructive. Harassment, offensive comments, and unprofessional behavior are not tolerated. We aim to create a welcoming environment for contributors of all experience levels.

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **Rust** (latest stable) for smart contract development
- **Soroban CLI** — `cargo install --locked soroban-cli`
- **Freighter Wallet** browser extension (for frontend testing)

### Local Setup

For a complete Ubuntu/Debian setup, run [`scripts/setup.sh`](scripts/setup.sh). It installs the required Node.js, Docker, Terraform, Rust, and Soroban toolchains. See [Development Setup](docs/development-setup.md) for SSH aliases when using multiple GitHub accounts.

Jenkins integration testing is documented in [Jenkins Integration Pipeline](docs/jenkins.md).
Run [Contract Resource Benchmarks](docs/contract-benchmarks.md) before changing or deploying contract state-change logic.

1. **Clone the repository**

   ```bash
   git clone https://github.com/Trust-Analysis/Tokenized-Fractional-.git
   cd Tokenized-Fractional-
   ```

2. **Install backend dependencies**

   ```bash
   cd backend
   npm install
   cp .env.example .env   # Edit .env with your values
   ```

3. **Install frontend dependencies**

   ```bash
   cd frontend
   npm install
   cp .env.example .env   # Edit .env with your values
   ```

4. **Build the smart contract**

   ```bash
   cd contracts
   cargo build --target wasm32-unknown-unknown --release
   # OR: soroban contract build
   ```

5. **Run the development servers**

   ```bash
   # Terminal 1 — Backend
   cd backend
   npm run dev

   # Terminal 2 — Frontend
   cd frontend
   npm run dev
   ```

6. Open `http://localhost:5173` in your browser.

---

## GraphQL Quickstart

The backend exposes a GraphQL API for querying marketplace assets. For a detailed walkthrough, see [GRAPHQL_QUICKSTART.md](GRAPHQL_QUICKSTART.md).

### Quick Setup

1. **Start the backend** (from `backend/`):
   ```bash
   npm run dev
   ```

2. **Open the GraphQL Playground**:
   ```
   http://localhost:3001/graphql
   ```

3. **Run a test query** in Apollo Sandbox:
   ```graphql
   query {
     assets(limit: 5) {
       contractId
       title
       pricePerShare
     }
   }
   ```

---

## Development Workflow

1. Pick an issue from the [issue tracker](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues).
2. Comment on the issue to let others know you're working on it.
3. Create a feature branch from `main` (see [branch naming](#branch-naming-conventions)).
4. Make your changes, following the [code style guidelines](#code-style-guidelines).
5. Add tests for any new functionality.
6. Ensure all existing tests pass (`cd backend && npm test`, `cd contracts && cargo test`).
7. Open a pull request (see [PR process](#pull-request-process)).

---

## Code Style Guidelines

### General

- Use **2-space indentation** in JavaScript/JSX files.
- Use **4-space indentation** in Rust files.
- Prefer **ES modules** (`import`/`export`) over CommonJS (`require`/`module.exports`).
- Use **meaningful variable and function names** — avoid single-letter names except for loop indices.

### JavaScript / React (Frontend)

- Use **functional components** with hooks — no class components.
- Use **CSS Modules** for component-scoped styling (`.module.css`).
- Group imports: external libraries first, then internal components, then styles.
- Use `const` by default, `let` only when reassignment is needed. Never use `var`.
- Prefer **async/await** over raw Promise chains.
- Handle loading, empty, and error states in every component that fetches data.

### Node.js / Express (Backend)

- Use **structured logging** via Pino — avoid `console.log` / `console.error` in production code.
- Validate all user input before processing.
- Use environment variables for configuration — never hardcode secrets.
- Keep route handlers thin — extract business logic into helper functions.

### Rust / Soroban (Contracts)

- Follow standard Rust formatting (`cargo fmt`).
- Use `Result` types with meaningful error messages instead of `unwrap()` / `expect()`.
- Document public functions with doc comments (`///`).
- Add input validation for all public entry points.

---

## Branch Naming Conventions

Use the following format for branch names:

```
<type>/<issue-number>-<short-description>
```

**Types:**
- `feat/` — New features or enhancements
- `fix/` — Bug fixes
- `docs/` — Documentation changes
- `refactor/` — Code refactoring (no behavior changes)
- `test/` — Adding or updating tests
- `chore/` — Maintenance, dependency updates, config changes

**Examples:**
```
feat/27-asset-listing-grid
fix/42-share-balance-calculation
docs/41-contributing-md
refactor/15-structured-logging
```

---

## Pull Request Process

1. **Link your PR to the issue** — use GitHub's "Development" sidebar or add `Closes #XX` in the description.
2. **Keep PRs focused** — one issue/feature per PR. If a change is large, break it into smaller PRs.
3. **Write a clear description** — explain *what* you changed and *why*. Include screenshots for UI changes.
4. **Ensure CI passes** — all tests must pass before requesting review.
5. **Request review** — add at least one reviewer. Be open to feedback and iterate.

### PR Description Template

```markdown
## Description
Brief summary of the changes.

## Related Issue
Closes #XX

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring
- [ ] Other (describe)

## Testing
- [ ] Backend tests pass (`cd backend && npm test`)
- [ ] Contract tests pass (`cd contracts && cargo test`)
- [ ] Manual testing performed (describe below)

## Screenshots (if applicable)
```

---

## Local Secret Scanning

`backend/.env.example` and `frontend/.env.example` are templates — the real `.env` files stay on
your machine and must never be committed. Three layers guard against committing one by accident.

### 1. CI (always on, no setup)

[`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) runs
[gitleaks](https://github.com/gitleaks/gitleaks) over the **full commit history on every pull
request**, to any base branch, and on pushes to `main`/`dev`. It fails the PR when it finds a
secret. The same job also fails if a real `.env` file is tracked in git — only
`.env.example`, `.env.template`, and `.env.sample` are allowed.

CI is the authoritative gate. Even with no local tooling, a secret cannot merge.

### 2. Pre-commit hook (optional, recommended)

The [husky](https://typicode.github.io/husky/) pre-commit hook already runs for everyone via
`npm install` (the root `prepare` script installs it). It scans **staged** content with gitleaks
before each commit, so a secret is caught before it ever reaches a branch.

The scan is **skipped with a warning** if gitleaks is not installed, so it never blocks
contributors who have not set it up. To enable it locally:

```bash
# macOS / Linux
brew install gitleaks

# Windows (PowerShell)
winget install Gitleaks.Gitleaks

# or any platform — download the release binary and put it on your PATH
# https://github.com/gitleaks/gitleaks/releases
```

Then verify it is wired up:

```bash
gitleaks version
```

To check everything currently staged without committing:

```bash
gitleaks git --staged --config .gitleaks.toml --redact
```

**Opting out.** If gitleaks blocks a commit you know is safe, bypass it for that one commit:

```bash
SKIP_GITLEAKS=1 git commit -m "..."
```

CI still scans the branch, so this only skips the local convenience check.

### 3. GitHub push protection (repository setting)

GitHub's own secret scanning and push protection should also be enabled for the repository. This
is a **repository setting rather than a file in the repo**, so a maintainer with admin access must
turn it on:

**Settings → Code security and analysis → Secret scanning → Enable**
**Settings → Code security and analysis → Secret scanning and push protection → Enable**

(Equivalent API calls, for a maintainer with `admin` scope on the repo:

```bash
curl -X PUT -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/Trust-Analysis/Tokenized-Fractional- \
  -d '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}'
```

)

Push protection blocks a push before the secret reaches the history, which is the strongest of the
three layers. Note that on public repositories secret scanning is free; on private repositories
GitHub may charge for it — gitleaks in CI is free either way.

### If a secret is committed

Removing the line does **not** un-leak a secret, because it stays in the history. Rotate or revoke
the credential first, then remove the file. Force-pushing a rewritten history is a last resort —
coordinate with maintainers, because it invalidates other people's clones.

### False positives

`.gitleaks.toml` holds narrowly-scoped allowlists for the placeholder values this repository
intentionally commits (doc examples such as `YOUR_API_KEY`, and the public Stellar contract ID
documented in the analytics docs). If gitleaks flags something legitimate:

- **One line** — append `// gitleaks:allow` (or `# gitleaks:allow`) to that line.
- **A value used across files** — add the exact literal to a `[[allowlists]]` block in
  `.gitleaks.toml`.

Do not add broad path or directory allowlists. The allowlist entries in `.gitleaks.toml` are
deliberately keyed to exact placeholder strings so that a real credential is never suppressed.

---

## Testing

### Backend Tests

```bash
cd backend
npm test
```

Tests use Jest and Supertest. The test suite covers:
- API endpoint behavior (GET, POST, DELETE)
- Validation logic
- Rate limiting (write endpoints)
- Caching behavior (Redis integration tests)
- Health check endpoint
- Helper functions

**Writing new tests:**
- Place test files in `backend/__tests__/`.
- Use descriptive `describe` / `test` blocks.
- Clean up test data in `afterAll` / `afterEach` hooks.

### Smart Contract Tests

```bash
cd contracts
cargo test
```

The contract tests verify core functionality including initialization, share purchases, pause/unpause, and emergency withdrawal.

### Frontend

The frontend uses Vite's dev server for rapid development:

```bash
cd frontend
npm run dev     # Start dev server
npm run build   # Production build
npm run preview # Preview production build
```

---

## Reporting Bugs

Found a bug? Please open an issue with the following information:

1. **Description** — What happened? What did you expect to happen?
2. **Steps to Reproduce** — Step-by-step instructions to trigger the bug.
3. **Environment** — OS, browser (if frontend), Node.js version, Rust version, Soroban CLI version.
4. **Screenshots / Logs** — Any relevant error messages, console output, or screenshots.
5. **Severity** — How critical is this? (cosmetic, functional, crash, security)

Use the "bug" label when creating the issue.

---

## Requesting Features

Have an idea for a new feature? Open an issue with:

1. **Problem Statement** — What problem does this feature solve?
2. **Proposed Solution** — How should it work? Be as specific as possible.
3. **Alternatives Considered** — What other approaches did you think about?
4. **Scope** — Is this a small enhancement or a major feature?

Use the "enhancement" label when creating the issue. Feature requests will be discussed and prioritized by maintainers.

---

## Project Structure Reference

```
├── contracts/          # Soroban smart contract (Rust)
│   ├── Cargo.toml
│   └── src/lib.rs
├── backend/            # Off-chain metadata API (Express.js)
│   ├── package.json
│   ├── index.js        # Main server + routes
│   ├── cache.js        # Redis caching layer
│   └── __tests__/      # Jest test suite
├── frontend/           # React + Vite application
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx           # Entry point
│       ├── App.jsx            # Main app component
│       ├── App.module.css     # App-specific styles
│       ├── components/        # Reusable UI components
│       ├── store/             # Zustand state management
│       └── styles/            # Global theme
└── CONTRIBUTING.md    # This file
```

---

## Questions?

If you have questions about contributing, feel free to:
- Comment on the relevant issue
- Open a new discussion in the issue tracker
- Reach out to the maintainers

Thank you for contributing! 🚀
