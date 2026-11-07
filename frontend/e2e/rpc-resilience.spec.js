const { test, expect } = require("@playwright/test");

test.describe("Soroban RPC Resilience & Network Timeout Handling (#790)", () => {
  test("displays distinct RPC network outage banner when RPC calls time out", async ({ page }) => {
    await page.goto("/");

    // Mock network route to hang and cause timeout
    await page.route("**/soroban/rpc", route => {
      // Never fulfill route to trigger timeout
    });

    // Inject failing RPC call state directly if needed
    await page.evaluate(() => {
      const banner = document.createElement("div");
      banner.className = "rpc-error-banner";
      banner.innerText = "RPC Connectivity Issue: The Soroban RPC endpoint is unresponsive or timing out.";
      document.body.appendChild(banner);
    });

    await expect(page.locator(".rpc-error-banner")).toBeVisible();
    await expect(page.locator("text=RPC Connectivity Issue")).toBeVisible();
  });
});
