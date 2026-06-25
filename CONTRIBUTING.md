# Contributing to Tokenized Fractional RWA Marketplace

Thank you for your interest in contributing! This document outlines the process and guidelines for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Pull Request Process](#pull-request-process)
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
