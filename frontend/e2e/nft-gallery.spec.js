const { test, expect } = require("@playwright/test");

test.describe("My NFT Share Certificates Gallery (#788)", () => {
  test("shows wallet connection prompt when not connected", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Connect your Freighter wallet to view your owned NFT certificates")).toBeVisible();
  });

  test("renders NFT certificates gallery for connected users", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wallet_previously_connected", "true");
      window.freighterApi = {
        isConnected: async () => true,
        getPublicKey: async () => "GBRPYHIL2CI3FNQ4BXLFMNDLFIM33A"
      };
    });

    await page.goto("/");
    await expect(page.locator("text=My NFT Share Certificates")).toBeVisible();
    await expect(page.locator("text=NFT-CERT-001")).toBeVisible();
    await expect(page.locator("text=Luxury Manhattan Condo Unit 12B")).toBeVisible();
  });
});
