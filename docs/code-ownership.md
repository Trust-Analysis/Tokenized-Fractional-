# Code Ownership

Issue: [#799](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/799)

## The problem

Pull requests touching the highest-risk parts of the codebase were routed to no
particular reviewer. Two paths carry risk that no test suite fully retires:

- **`contracts/`** — deployed bytecode is effectively immutable, and the
  marketplace contract custodies user payment-token funds.
- **The backend's authentication, authorisation and secret-handling code** — a
  mistake here is a security incident rather than a bug.

Any contributor with merge rights could previously approve a change to either.

## What is in the repository

[`.github/CODEOWNERS`](../.github/CODEOWNERS) assigns both path families, plus
the dependency-automation and infrastructure files, to the maintainers listed
in this document. Rules are evaluated top to bottom and **the last matching
pattern wins**, so the file is ordered broadest-first with the highest-risk
paths last.

| Area | Paths | Owners |
|---|---|---|
| Smart contracts | `contracts/` | `@Fatimasanusi` `@Khadeejaarh` |
| Backend auth and secrets | `backend/auth.js`, `backend/authMiddleware.js`, `backend/env.js`, `backend/index.js`, `backend/src/middleware/`, `backend/src/routes/` | `@Fatimasanusi` `@Khadeejaarh` |
| Transaction construction (frontend) | `frontend/src/hooks/useSoroban.js`, `frontend/src/context/FreighterWalletContext.jsx`, `frontend/src/store/useWalletStore.js`, `frontend/src/machines/` | `@Fatimasanusi` `@Khadeejaarh` |
| Supply-chain automation | `.github/dependabot.yml`, `renovate.json`, `.github/workflows/security.yml`, `.github/workflows/dependency-audit.yml`, `.github/dependency-audit-baseline.json` | `@Fatimasanusi` |
| Infrastructure | `render.yaml`, `terraform/`, `k8s/`, `nginx/`, `docker-compose.yml`, `Jenkinsfile` | `@Fatimasanusi` |
| Everything else | `*` | `@Fatimasanusi` |

## What is deliberately *not* enforced by this change

Committing a `CODEOWNERS` file only makes GitHub **request** the listed
reviewers. It does not make their approval **required**. The second half of
issue #799's acceptance criteria — "require CODEOWNERS approval on those paths
specifically" — is a repository setting, not a file, and cannot be shipped in a
pull request.

### Admin steps to make ownership binding

A repository admin must enable these under
**Settings → Branches → Branch protection rules → `main`**:

1. **Require a pull request before merging** — enabled.
2. **Require approvals** — set to `1`.
3. **Require review from Code Owners** — enabled. This is the switch that turns
   `.github/CODEOWNERS` from a suggestion into a gate.
4. **Dismiss stale pull request approvals when new commits are pushed** —
   enabled. Without it, an approval can be invalidated by a later push.
5. **Require status checks to pass before merging** — enabled, with the checks
   from `Pull Request Quality & Security`, `Dependency Audit`, `Frontend
   Accessibility Tests` and the new `Dependency Update Gate` selected.
6. **Do not allow bypassing the above settings** — enabled, including for
   administrators. Ownership rules that administrators can bypass do not
   constrain the account most likely to push directly.
7. **Allow force pushes** and **Allow deletions** — disabled.

Until step 3 is enabled, `.github/CODEOWNERS` still auto-requests the right
reviewer on every affected pull request. That is useful on its own — it removes
the "nobody knew to look at this" failure mode — but it is not enforcement, and
the issue should not be considered fully satisfied by this file alone.

The same branch-protection configuration covers the requirements in issue
[#798](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/798)
(branch protection on `main`) and the CI gating required by issue
[#800](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/800)
(dependency updates merged only once checks pass).

## Maintaining this file

- Ownership is by path, per the table above. When a new directory becomes
  security-relevant, add a rule rather than widening the `*` default.
- Every pattern must name an account that exists. A typo silently produces a
  rule that matches nothing.
- Keep the ordering rule in mind: adding a broad rule *below* a narrow one
  silently overrides it. Add new rules above the default and below the
  highest-risk block unless you intend otherwise.

`tests/test_issue_799_codeowners.py` validates the structure this document
describes: that the file parses, that `contracts/` and the security-relevant
backend paths are assigned to real-looking owners, that those owners are
documented here, and that the default rule comes first.
