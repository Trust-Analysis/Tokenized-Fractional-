const { test, expect } = require("@playwright/test");

test("displays transaction lifecycle status overlay correctly", async ({ page }) => {
  await page.goto("/");
  
  // Verify status overlay is hidden by default
  const overlay = page.locator(".tx-status-overlay");
  await expect(overlay).not.toBeVisible();
});
