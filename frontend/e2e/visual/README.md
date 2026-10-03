# Visual regression — purchase flow

Issue: [#794](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/794)

Screenshot comparisons for the screens a buyer goes through, so a refactor or a
dependency upgrade cannot silently change the layout:

| Test | Screen |
| --- | --- |
| `01` | Asset detail / marketplace view |
| `02` | Purchase panel with the wallet connected |
| `03` | Confirmation dialog |
| `04` | Success state |
| `05` | Failure state |

## Running

```bash
cd frontend

# Compare against the committed baselines
npm run test:visual

# Regenerate the baselines (only when the change is intended)
npm run test:visual:update
```

Both commands use [`playwright.visual.config.js`](../../playwright.visual.config.js),
which is separate from the functional e2e config so it can pin everything that
would otherwise make pixels differ: a single browser, a fixed viewport, device
scale factor 1, `colorScheme: light`, `animations: 'disabled'`, and a
`maxDiffPixelRatio` that absorbs anti-aliasing noise but not layout movement.

## Baselines

The reference images live in `__screenshots__/purchase-flow.visual.spec.js/` and
are **committed**. CI compares against them and uploads the report plus the
`-actual.png` / `-diff.png` images as the `visual-regression-report` artefact.

**Review every diff before updating a baseline.** Regenerating snapshots to make
a red build green defeats the purpose of the suite — the diff *is* the signal.
If a change is intended, review the images, then commit the new baselines in the
same pull request as the code that caused them.

## Making the failure state reproducible

Test `05` sets `localStorage.mock_tx_failure = 'true'`, which
[`useSoroban.js`](../../src/hooks/useSoroban.js) honours when the mock wallet is
enabled (the same mechanism as `mock_wallet_pubkey`). It is read at call time,
so one build can exercise both the success and failure branches without a second
build.

## Scope

These tests cover the purchase flow only — the screens where a visual bug costs
a sale or, worse, makes a user misread what they are buying. Adding a screen
here means adding a baseline for it, which is a commitment to keep it stable.
