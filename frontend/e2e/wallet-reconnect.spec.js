const { test, expect } = require("@playwright/test");

test.describe("Wallet Auto-Reconnect Behavior (#785)", () => {
  test("first-time user sees manual connect button and no auto-reconnect", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Connect Freighter Wallet")).toBeVisible();
    await expect(page.locator("text=Connected:")).not.toBeVisible();
  });

  test("returning user with flag in localStorage auto-reconnects on page reload", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wallet_previously_connected", "true");
      window.freighterApi = {
        isConnected: async () => true,
        getPublicKey: async () => "GBRPYHIL2CI3FNQ4BXLFMNDLFIM33A"
      };
    });

    await page.goto("/");
    await expect(page.locator("text=Connected: GBRPYH...L33A")).toBeVisible();
  });

  test("falls back gracefully if wallet authorization was revoked or fails", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wallet_previously_connected", "true");
      window.freighterApi = {
        isConnected: async () => false,
        getPublicKey: async () => { throw new Error("User revoked permissions"); }
      };
    });

    await page.goto("/");
    await expect(page.locator("text=Connect Freighter Wallet")).toBeVisible();
  });
});
