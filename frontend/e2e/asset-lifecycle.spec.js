// @ts-check
import { test, expect } from '@playwright/test';

const MOCK_PUBKEY = 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR';
const MOCK_CONTRACT_ID = 'CDUMMYCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

// Mock asset metadata for tokenization
const MOCK_ASSET_METADATA = {
  name: 'Commercial Real Estate - Manhattan Tower',
  description: 'A prime 40-story commercial office building located in the heart of Manhattan financial district. The property features modern amenities, LEED Gold certification, and long-term tenant leases with Fortune 500 companies.',
  assetType: 'real_estate',
  jurisdiction: {
    country: 'US',
    region: 'New York',
    legalFramework: 'SEC',
  },
  custodian: {
    name: 'Global Custody Solutions LLC',
    licenseNumber: 'CUST-2024-NY-001',
    contact: {
      email: 'custody@example.com',
      phone: '+12125551234',
    },
  },
  appraisal: {
    value: 50000000000, // $50M in smallest unit
    currency: 'USD',
    date: '2024-01-15',
    method: 'market_comparison',
  },
  documents: [
    {
      type: 'title_deed',
      hash: 'a'.repeat(64),
      url: 'ipfs://QmTestTitleDeed',
    },
    {
      type: 'appraisal_report',
      hash: 'b'.repeat(64),
      url: 'ipfs://QmTestAppraisal',
    },
  ],
  fractionalization: {
    totalShares: 1000000,
    sharePrice: 50000, // $0.05 per share
    currency: 'USD',
    minPurchase: 100,
  },
  version: '1.0',
};

// Mock API responses
const MOCK_TOKENIZED_ASSET = {
  contractId: MOCK_CONTRACT_ID,
  title: 'Commercial Real Estate - Manhattan Tower',
  location: 'New York, NY',
  description: MOCK_ASSET_METADATA.description,
  assetType: 'Commercial',
  totalValuation: '$50,000,000',
  totalShares: 1000000,
  availableShares: 1000000,
  pricePerShare: 0.05,
  imageUrl: '',
  status: 'tokenized',
};

// Intercept backend API calls
async function mockApi(page) {
  // Mock asset list
  await page.route('**/api/v1/rwa', (route) => {
    route.fulfill({ json: { data: [MOCK_TOKENIZED_ASSET] } });
  });

  // Mock single asset
  await page.route('**/api/v1/rwa/**', (route) => {
    route.fulfill({ json: MOCK_TOKENIZED_ASSET });
  });

  // Mock tokenization endpoint
  await page.route('**/api/v1/tokenize', (route) => {
    route.fulfill({ 
      json: { 
        success: true, 
        contractId: MOCK_CONTRACT_ID,
        txHash: '0x' + 'a'.repeat(64),
      } 
    });
  });

  // Mock order placement
  await page.route('**/api/v1/orders', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        json: {
          id: 'order-' + Date.now(),
          status: 'pending',
          txHash: '0x' + 'b'.repeat(64),
        },
      });
    } else {
      route.fulfill({ json: { orders: [] } });
    }
  });

  // Mock GraphQL subscriptions
  await page.route('**/graphql', (route) => {
    route.fulfill({ json: { data: { orders: [] } } });
  });

  // Intercept Soroban RPC calls
  await page.route('**/soroban-testnet.stellar.org/**', (route) => route.abort());
}

test.describe('Asset Lifecycle E2E — Tokenization to Ownership', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    
    // Clear persisted state
    await page.addInitScript(() => {
      localStorage.removeItem('rwa-wallet-store');
      localStorage.removeItem('mock_wallet_pubkey');
      localStorage.removeItem('mock_shares_balance');
    });
  });

  test('complete asset lifecycle: tokenization → fractional minting → order placement → ownership verification', async ({ page }) => {
    // Step 1: Navigate to marketplace
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'RWA Marketplace' })).toBeVisible();

    // Step 2: Connect wallet
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5000 });

    // Step 3: Navigate to asset tokenization page
    await page.getByRole('link', { name: /tokenize asset/i }).click();
    await expect(page.getByRole('heading', { name: /tokenize asset/i })).toBeVisible();

    // Step 4: Fill asset metadata form
    await page.getByLabel(/asset name/i).fill(MOCK_ASSET_METADATA.name);
    await page.getByLabel(/description/i).fill(MOCK_ASSET_METADATA.description);
    await page.getByLabel(/asset type/i).selectOption('real_estate');
    await page.getByLabel(/country/i).fill('US');
    await page.getByLabel(/legal framework/i).fill('SEC');
    
    // Step 5: Upload documents (mock)
    const fileInput = page.getByLabel(/documents/i);
    await fileInput.setInputFiles({
      name: 'title-deed.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('mock pdf content'),
    });

    // Step 6: Submit tokenization
    await page.getByRole('button', { name: /tokenize asset/i }).click();

    // Step 7: Wait for tokenization success
    await expect(page.getByText(/asset tokenized successfully/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(MOCK_CONTRACT_ID)).toBeVisible();

    // Step 8: Configure fractionalization
    await page.getByLabel(/total shares/i).fill('1000000');
    await page.getByLabel(/share price/i).fill('0.05');
    await page.getByLabel(/minimum purchase/i).fill('100');

    // Step 9: Mint fractional tokens
    await page.getByRole('button', { name: /mint fractional tokens/i }).click();
    await expect(page.getByText(/fractional tokens minted/i)).toBeVisible({ timeout: 10000 });

    // Step 10: Navigate to asset detail page
    await page.getByRole('link', { name: MOCK_ASSET_METADATA.name }).click();
    await expect(page.getByRole('heading', { name: MOCK_ASSET_METADATA.name })).toBeVisible();

    // Step 11: Verify fractionalization details
    await expect(page.getByText(/1,000,000 total shares/i)).toBeVisible();
    await expect(page.getByText(/\$0.05 per share/i)).toBeVisible();
    await expect(page.getByText(/100 minimum purchase/i)).toBeVisible();

    // Step 12: Place buy order
    await page.getByLabel(/buy amount/i).fill('500');
    await page.getByRole('button', { name: /buy shares/i }).click();

    // Step 13: Confirm purchase
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByText(/500 shares/i)).toBeVisible();
    await expect(dialog.getByText(/\$25.00/i)).toBeVisible();
    
    await dialog.getByRole('button', { name: /confirm/i }).click();

    // Step 14: Verify order placed with optimistic UI
    await expect(page.getByText(/order placed - awaiting confirmation/i)).toBeVisible({ timeout: 5000 });

    // Step 15: Verify order appears in order book with pending badge
    await expect(page.getByText(/pending/i)).toBeVisible();
    await expect(page.locator('.pulsing-badge')).toBeVisible();

    // Step 16: Wait for transaction confirmation
    await expect(page.getByText(/order confirmed/i)).toBeVisible({ timeout: 15000 });

    // Step 17: Verify ownership balance updated
    await expect(page.getByText(/your share balance/i)).toBeVisible();
    await expect(page.getByText(/500/i)).toBeVisible();

    // Step 18: Navigate to portfolio/holdings
    await page.getByRole('link', { name: /portfolio/i }).click();
    await expect(page.getByRole('heading', { name: /your portfolio/i })).toBeVisible();

    // Step 19: Verify asset appears in holdings
    await expect(page.getByText(MOCK_ASSET_METADATA.name)).toBeVisible();
    await expect(page.getByText(/500 shares/i)).toBeVisible();
    await expect(page.getByText(/\$25.00/i)).toBeVisible();

    // Step 20: Verify transaction history
    await page.getByRole('tab', { name: /transactions/i }).click();
    await expect(page.getByText(/buy order/i)).toBeVisible();
    await expect(page.getByText(/500 shares/i)).toBeVisible();
  });

  test('GraphQL subscription triggers real-time events during trade flow', async ({ page }) => {
    // Track WebSocket messages
    const wsMessages = [];
    page.on('websocket', ws => {
      ws.on('framereceived', frame => {
        if (frame.payload) {
          wsMessages.push(JSON.parse(frame.payload.toString()));
        }
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5000 });

    // Place an order and verify subscription events
    await page.getByLabel(/buy amount/i).fill('100');
    await page.getByRole('button', { name: /buy shares/i }).click();
    
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.getByRole('button', { name: /confirm/i }).click();

    // Wait for subscription event
    await page.waitForTimeout(2000);

    // Verify WebSocket subscription received order update
    const orderUpdate = wsMessages.find(msg => 
      msg.type === 'data' && 
      msg.payload?.data?.orderUpdated
    );

    expect(orderUpdate).toBeDefined();
    expect(orderUpdate.payload.data.orderUpdated.status).toBe('pending');
  });

  test('order rollback on transaction failure', async ({ page }) => {
    // Mock failed transaction
    await page.route('**/api/v1/orders', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          json: { error: 'Transaction failed or reverted on-chain' },
        });
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5000 });

    // Attempt to place order
    await page.getByLabel(/buy amount/i).fill('100');
    await page.getByRole('button', { name: /buy shares/i }).click();
    
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.getByRole('button', { name: /confirm/i }).click();

    // Verify error toast appears
    await expect(page.getByText(/transaction failed or reverted/i)).toBeVisible({ timeout: 5000 });

    // Verify optimistic state was rolled back
    await expect(page.getByText(/500 shares/i)).not.toBeVisible();
    await expect(page.getByText(/your share balance/i)).toContainText('0');
  });

  test('multiple fractional token purchases in single session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /connect freighter/i }).click();
    await expect(page.getByTitle(MOCK_PUBKEY)).toBeVisible({ timeout: 5000 });

    // First purchase
    await page.getByLabel(/buy amount/i).fill('100');
    await page.getByRole('button', { name: /buy shares/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText(/order confirmed/i)).toBeVisible({ timeout: 10000 });

    // Second purchase
    await page.getByLabel(/buy amount/i).fill('200');
    await page.getByRole('button', { name: /buy shares/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText(/order confirmed/i)).toBeVisible({ timeout: 10000 });

    // Verify cumulative balance
    await expect(page.getByText(/300/i)).toBeVisible();
  });
});
