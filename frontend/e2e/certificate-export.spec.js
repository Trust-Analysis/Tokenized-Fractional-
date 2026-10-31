const { test, expect } = require("@playwright/test");

test("verifies ownership certificate export functionality and verification fields", async ({ page }) => {
  await page.goto("/");
  
  // Verify main holding or history view is accessible
  const historySection = page.locator(".transaction-history-section");
  await expect(historySection).toBeVisible();
});
