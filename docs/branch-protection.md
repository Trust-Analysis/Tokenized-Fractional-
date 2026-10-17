# Branch Protection on `main`

Issue: [#798](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/798)

## Why this exists

The project accepts external contributions and `contracts/` custodies real
funds. Without protection on `main`, a direct push or an unreviewed merge lands
untested — or unreviewed — changes on the branch everybody deploys from.

Branch protection is a **repository setting, not a file**, so it is invisible in
git history and easy to turn off by accident. This repository keeps the desired
state under version control and provides a script to apply and verify it.

## The policy

| Setting | Value | Why |
| --- | --- | --- |
| Required approving reviews | **at least one** | A second pair of eyes on every change. |
| Dismiss stale reviews on push | on | An approval must be for the code that merges, not an earlier revision. |
| Require approval of the most recent push | on | Stops "approve, then push something else". |
| Required status checks | the list below | CI must be green on the exact merge commit. |
| Require branches to be up to date | on | Otherwise a green branch is merged onto a `main` it never saw. |
| Require conversation resolution | on | Review comments are not optional. |
| Require linear history | on | No merge commits; clean reverts. |
| Allow force pushes | **off** | A force push can erase reviewed history. |
| Allow deletions | **off** | `main` must not be deleted. |
| Include administrators | on | The rules are not advisory for maintainers. |

The machine-readable version lives in
[`.github/branch-protection.json`](../.github/branch-protection.json).

### Required status checks

These are the **job names** (`name:` in the workflow), not the workflow names:

| Check | Workflow |
| --- | --- |
| `TruffleHog Secret Scanning` | `pr.yml` |
| `Soroban Fuzz Tests (proptest)` | `pr.yml` |
| `Contracts WebAssembly Build` | `pr.yml` |
| `CodeQL Analysis` | `security.yml` |
| `Secret Scanning` | `security.yml` |
| `Security Linting` | `security.yml` |
| `SQL Injection Prevention Tests` | `security.yml` |
| `npm audit (high/critical)` | `dependency-audit.yml` |
| `cargo audit (contracts)` | `dependency-audit.yml` |
| `gitleaks` | `gitleaks.yml` |

**Only checks that run on *every* pull request may be required.** GitHub treats
a required check that never reports as permanently pending, so a path-filtered
workflow would deadlock unrelated PRs. These are deliberately **not** required,
even though they are valuable, because they are scoped by path:

- `Locale parity & key usage` (`i18n-check.yml`, `frontend/src/locales/**`)
- `Frontend Unit Tests (Vitest + RTL)` (`frontend-a11y.yml`, `frontend/**`)
- `data.json vs On-Chain Drift Detection`, `README API Examples (docs as tests)`
  (`backend-docs-and-data-integrity.yml`)
- `Generate & Validate API Docs` (`docs.yml`)

If one of those is later made to run on every PR, add it to the JSON **and** to
the table above in the same change.

## Applying and verifying

Both operations need the [`gh` CLI](https://cli.github.com/) authenticated with a
token that has **admin** access to the repository (admin read to verify, admin
write to apply).

```bash
# Apply the policy from .github/branch-protection.json
./scripts/branch-protection.sh apply

# Verify the live settings still match, without changing anything
./scripts/branch-protection.sh check
```

`check` exits non-zero when any required setting is missing, so it is suitable
for a scheduled drift-detection workflow once an admin-scoped token is available
(the default `GITHUB_TOKEN` cannot read branch protection). Until then, run it
after any repository-settings change and before a release.

`REPO=owner/name BRANCH=dev` overrides the target.

## Changing the policy

1. Edit `.github/branch-protection.json`.
2. If you touched the required checks, update the table above **and** confirm
   each new check runs on every PR (see the rule above).
3. Run `./scripts/branch-protection.sh apply`.
4. Commit the JSON change — the pull request is the review.

## What this does not cover

- **Tag protection** and **environment protection rules** (e.g. the Render
  deploy environment) are separate GitHub settings and are not managed here.
- The **merge queue** is not enabled. If branch-protection time-to-merge becomes
  a problem, it is an additive change to this policy.
- Protection is only as strong as the accounts with admin access; keep that set
  small and audited.
