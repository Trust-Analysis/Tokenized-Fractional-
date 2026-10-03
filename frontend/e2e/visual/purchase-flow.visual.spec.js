// @ts-check
//
// Visual regression for the critical purchase flow (issue #794).
//
// These are screenshot comparisons, not functional assertions — `marketplace.spec.js`
// already covers behaviour. A refactor or a dependency upgrade that changes
// layout here fails the run and produces a diff image to review.
//
// The baseline PNGs live in `e2e/visual/__screenshots__/` and are committed.
// Update them deliberately with `npm run test:visual:update`; never blindly
// accept a diff.
import { test, expect } from '@playwright/test';

const MOCK_PUBKEY = 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR';

const MOCK_ASSETS = [
  {
    contractId: 'CDUMMYCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    title: 'Downtown Office Building',
    location: 'New York, NY',
    description: 'Prime commercial real estate in Manhattan.',
    assetType: 'Commercial',
    totalValuation: '$5,000,000',
    imageUrl: '',
  },
];

// Intercept backend API calls so a screenshot never depends on a live backend.
async function mockApi(page) {
  await page.route('**/api/v1/rwa', (route) => route.fulfill({ json: { data: MOCK_ASSETS } }));
  await page.route('**/api/v1/rwa/**', (route) => route.fulfill({ json: MOCK_ASSETS[0] }));
  await page.route('**/soroban-testnet.stellar.org/**', (route) => route.abort());
}

async function connectWallet(page) {
  await page.getByRole('button', { name: /connect freighter/i }).click();
  await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5_000 });
}

// Regions that legitimately change between runs: charts animate and toasts
// carry the wall-clock time. Masked so only structural changes fail the diff.
function dynamicRegions(page) {
  return [
    page.locator('[class*="recharts"]'),
    page.locator('[class*="timestamp"]'),
  ];
}

async function shot(page, name) {
  await expect(page).toHaveScreenshot(name, { mask: dynamicRegions(page) });
}

test.describe('Purchase flow — visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(() => {
      localStorage.removeItem('rwa-wallet-store');
      localStorage.removeItem('mock_wallet_pubkey');
      localStorage.removeItem('mock_shares_balance');
      localStorage.removeItem('mock_tx_failure');
    });
  });

  test('01 — asset detail', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /available assets/i })).toBeVisible();
    await expect(page.getByText('Downtown Office Building')).toBeVisible();
    await shot(page, 'purchase-flow-01-asset-detail.png');
  });

  test('02 — purchase panel, wallet connected', async ({ page }) => {
    await page.goto('/');
    await connectWallet(page);
    await expect(page.getByText(/your share balance/i)).toBeVisible();
    await shot(page, 'purchase-flow-02-purchase-panel.png');
  });

  test('03 — confirmation dialog', async ({ page }) => {
    await page.goto('/');
    await connectWallet(page);

    const input = page.getByLabel(/buy amount/i).or(page.locator('#buy-amount-input'));
    await input.fill('3');
    await page.getByRole('button', { name: /buy shares/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await shot(page, 'purchase-flow-03-confirmation.png');
  });

  test('04 — success state', async ({ page }) => {
    await page.goto('/');
    await connectWallet(page);

    const input = page.getByLabel(/buy amount/i).or(page.locator('#buy-amount-input'));
    await input.fill('3');
    await page.getByRole('button', { name: /buy shares/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await dialog.getByRole('button', { name: /confirm/i }).click();

    await expect(page.getByText(/transaction submitted/i)).toBeVisible({ timeout: 8_000 });
    await shot(page, 'purchase-flow-04-success.png');
  });

  test('05 — failure state', async ({ page }) => {
    // The mock write is failed deterministically; see useSoroban.js.
    await page.addInitScript(() => localStorage.setItem('mock_tx_failure', 'true'));

    await page.goto('/');
    await connectWallet(page);

    const input = page.getByLabel(/buy amount/i).or(page.locator('#buy-amount-input'));
    await input.fill('3');
    await page.getByRole('button', { name: /buy shares/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await dialog.getByRole('button', { name: /confirm/i }).click();

    // Toasts carry role="alert"; the error toast is the failure surface.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8_000 });
    await shot(page, 'purchase-flow-05-failure.png');
  });
});
