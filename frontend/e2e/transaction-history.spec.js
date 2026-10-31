const { test, expect } = require("@playwright/test");

test("renders transaction history section and Stellar Expert explorer links", async ({ page }) => {
  await page.goto("/");
  const historySection = page.locator(".transaction-history-section");
  await expect(historySection).toBeVisible();
  await expect(page.locator("text=Past Purchase History")).toBeVisible();
});
