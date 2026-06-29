// @ts-check
import { test, expect } from '@playwright/test';

const MOCK_PUBKEY = 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR';

// Shared mock assets returned by the API route
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

// Intercept backend API calls so tests work without a running backend
async function mockApi(page) {
  await page.route('**/api/v1/rwa', (route) =>
    route.fulfill({ json: { data: MOCK_ASSETS } })
  );
  await page.route('**/api/v1/rwa/**', (route) =>
    route.fulfill({ json: MOCK_ASSETS[0] })
  );
  // Intercept Soroban RPC calls — not needed in mock-wallet mode but prevents network errors
  await page.route('**/soroban-testnet.stellar.org/**', (route) => route.abort());
}

test.describe('RWA Marketplace — critical user flows', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    // Clear persisted wallet state between tests
    await page.addInitScript(() => {
      localStorage.removeItem('rwa-wallet-store');
      localStorage.removeItem('mock_wallet_pubkey');
      localStorage.removeItem('mock_shares_balance');
    });
  });

  // ── 1. Viewing assets ────────────────────────────────────────────────────
  test('displays the marketplace heading and asset grid on load', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'RWA Marketplace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /available assets/i })).toBeVisible();

    // Asset card from the mocked API should appear
    await expect(page.getByText('Downtown Office Building')).toBeVisible();
    await expect(page.getByText('New York, NY')).toBeVisible();
  });

  // ── 2. Connecting wallet ─────────────────────────────────────────────────
  test('connects the mock wallet and shows the public key', async ({ page }) => {
    await page.goto('/');

    const connectBtn = page.getByRole('button', { name: /connect freighter/i });
    await expect(connectBtn).toBeVisible();

    await connectBtn.click();

    // After connecting, the public key should appear and connect button disappear
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5_000 });
    await expect(connectBtn).not.toBeVisible();

    // Share balance section should now be visible
    await expect(page.getByText(/your share balance/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /buy shares/i })).toBeVisible();
  });

  // ── 3. Buying shares ─────────────────────────────────────────────────────
  test('buys shares: opens confirm dialog, confirms, shows toast', async ({ page }) => {
    await page.goto('/');

    // Connect wallet first
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5_000 });

    // Set quantity to 3
    const input = page.getByLabel(/buy amount/i).or(page.locator('#buy-amount-input'));
    await input.fill('3');

    // Click Buy Shares → confirm dialog appears
    await page.getByRole('button', { name: /buy shares/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/3/)).toBeVisible();

    // Confirm the purchase
    const confirmBtn = page.getByRole('button', { name: /confirm/i });
    await confirmBtn.click();

    // Toast with "submitted" message should appear
    await expect(page.getByText(/transaction submitted/i)).toBeVisible({ timeout: 8_000 });
  });

  // ── 4. Disconnecting wallet ──────────────────────────────────────────────
  test('disconnects the wallet and returns to the initial state', async ({ page }) => {
    await page.goto('/');

    // Connect first
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5_000 });

    // Disconnect
    await page.getByRole('button', { name: /disconnect/i }).click();

    // Should be back to unauthenticated state
    await expect(page.getByRole('button', { name: /connect freighter/i })).toBeVisible();
    await expect(page.getByText(/your share balance/i)).not.toBeVisible();
  });
});
