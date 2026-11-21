import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression config (issue #794).
 *
 * Kept separate from `playwright.config.js` so the functional e2e run stays
 * fast and the snapshot run can pin the things that make pixels reproducible:
 * one browser, one viewport, one device scale factor, one colour scheme, and
 * animations disabled. A different environment must not produce a different
 * diff.
 */
export default defineConfig({
  testDir: './e2e/visual',

  // A visual diff is a result to review, not a flaky test to retry.
  retries: 0,
  timeout: 60_000,
  fullyParallel: false,

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]],

  // Snapshots live beside the spec, committed to git, so a diff is reviewable.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Tolerate sub-pixel anti-aliasing noise, not layout changes.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'retain-on-failure',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 900 },
  },

  projects: [
    {
      name: 'visual-chromium',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1, colorScheme: 'light' },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      VITE_MOCK_WALLET: 'true',
      VITE_CONTRACT_ID: 'CDUMMYCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      VITE_API_URL: 'http://localhost:4173',
    },
  },
});
