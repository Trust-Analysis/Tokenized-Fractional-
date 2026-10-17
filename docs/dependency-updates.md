# Dependency Updates

Issue: [#800](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/800)

## The problem

Scanning for *known-vulnerable* dependencies already existed
(`.github/workflows/dependency-audit.yml`, issue #721), but nothing proposed
routine — non-security — version bumps in a way that only surfaced them for
merge once the test suite passed. Routine updates therefore happened manually
and infrequently, and technical debt accumulated.

## Division of responsibility

There is exactly **one tool per job**. Two bots opening version-update PRs would
race each other to rewrite the same lockfile and double the review queue.

| Job | Tool | Configuration |
|---|---|---|
| Routine version bumps (npm + cargo) | **Renovate** | [`renovate.json`](../renovate.json) |
| Security advisories on dependencies | **Dependabot** | [`.github/dependabot.yml`](../.github/dependabot.yml) |
| Auditing the *current* tree for known vulnerabilities | `scripts/check-dependency-audit.mjs`, `cargo audit` | [`.github/workflows/dependency-audit.yml`](../.github/workflows/dependency-audit.yml) |

`open-pull-requests-limit: 0` is set on every Dependabot entry. GitHub documents
this as the supported way to keep security updates while disabling version
updates, which is what moves routine bumps to Renovate. Dependabot keeps its
grouping and schedule, and each group is scoped with
`applies-to: security-updates` so it still batches the PRs Dependabot remains
responsible for.

## What Renovate is configured to do

| Setting | Value | Why |
|---|---|---|
| `enabledManagers` | `npm`, `cargo` | The two ecosystems issue #800 names. Stops Renovate treating non-package directories as packages. |
| `schedule` | `before 6am on monday` | Matches the weekly review cadence below. |
| `automerge` | `false` | **This is the CI gate.** No dependency PR merges itself; merging is a human action taken only once the required checks are green. |
| `platformAutomerge` | `false` | Stops GitHub's own auto-merge from being enabled on Renovate's behalf. |
| `rangeStrategy` | `bump` | Raises the declared range to the new version rather than widening it, so ranges never drift upward silently. |
| `prConcurrentLimit` / `prHourlyLimit` | `5` / `2` | A single advisory cluster can otherwise bury the queue. Deferred work collects in the Dependency Dashboard issue instead. |
| `lockFileMaintenance` | weekly | Refreshes lockfiles that no version bump touches. |
| `vulnerabilityAlerts` | `at any time` | Security fixes are not held for the weekly window. |
| `:dependencyDashboard` | enabled | One issue listing everything Renovate is holding back — the starting point for the weekly review. |

Grouping mirrors the existing Dependabot groups: minor and patch together per
ecosystem, majors isolated, `soroban-sdk` isolated from everything else because
it pins the contract against a specific ledger protocol version. Every PR is
labelled `dependencies` plus an ecosystem label, so the weekly queue is one
label filter.

## How the CI gate works

1. Renovate opens a pull request touching a manifest and its lockfile.
2. `Dependency Update Gate` (`.github/workflows/dependency-update-gate.yml`)
   runs the full suite: backend Jest, frontend Vitest, and the root Python
   tests. `Dependency Audit` re-runs the vulnerability ratchet at the same time.
3. Renovate never merges by itself. A maintainer merges only once the required
   checks are green — see [docs/code-ownership.md](./code-ownership.md) for the
   branch-protection settings that make those checks blocking.

The gate is a normal pull-request workflow rather than a bot-only one on
purpose. A workflow gated with `if: github.actor == 'renovate[bot]'` would never
report for a human pull request, and a required check that never reports leaves
every other pull request stuck waiting on it.

## Required one-time setup

**Renovate must be installed on the repository before its configuration does
anything.** Configuration files are inert until the app is enabled:

1. Install the [Mend Renovate app](https://github.com/apps/renovate) on
   `Trust-Analysis/Tokenized-Fractional-`.
2. Confirm the Dependency Dashboard issue appears within a day.

**If Renovate is not going to be installed**, revert the Dependabot hunk of this
change so version updates continue:

```bash
git revert --no-commit <sha-that-changed-dependabot.yml>
# or manually restore open-pull-requests-limit: 10 / 5 and
# applies-to: version-updates in .github/dependabot.yml
```

Leaving both as configured — Renovate absent *and* Dependabot's version updates
at `0` — would stop routine version bumps entirely.

## Weekly review cadence

Every Monday, one maintainer works the queue. Fifteen minutes is usually enough.

1. Open the **Dependency Dashboard** issue. It lists every update Renovate is
   holding, every rate-limited branch, and anything awaiting a decision.
2. Open the `dependencies` label view. Every open dependency PR is there,
   newest first.
3. For each PR:
   - **Green and grouped** (`deps:npm` / `deps:contracts`, no `deps:major`) —
     skim the release notes in the PR body, merge.
   - **`deps:major`** — read the changelog for breaking changes, check the
     migration notes, and merge only if the affected code paths are covered.
     Anything touching `soroban-sdk` needs the contract test suite plus a
     deliberate decision about the deployed contract's protocol version.
   - **Red** — do not merge. Fix forward if the failure is mechanical;
     otherwise close the PR and open an issue naming the blocker, so the
     Dashboard records the decision.
4. Triage any `security`-labelled PR immediately rather than waiting for
   Monday — those come from Dependabot and are not bound to the weekly window.
5. If a bump is intentionally declined (for example, a major that needs
   contract work first), record the reason in the Dependency Dashboard issue or
   in a `renovate.json` `ignoreDeps` entry, so it is not re-proposed and
   re-declined every week.

### Escalation

Routine bumps should never sit open for more than two review cycles. If a PR is
still open after two Mondays, it either gets merged, gets an owner and a date,
or gets closed with a linked issue explaining the blocker. "Open indefinitely"
is the failure mode this cadence exists to prevent.
