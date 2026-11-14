const { test, expect } = require("@playwright/test");

test.describe("Asset Search, Filter, and Sort (#786)", () => {
  test("filters assets by search query and updates URL", async ({ page }) => {
    await page.goto("/");

    const searchInput = page.locator("input[placeholder*='Search assets']");
    await searchInput.fill("Manhattan");

    await expect(page.locator("text=Luxury Manhattan Condo Unit 12B")).toBeVisible();
    await expect(page.locator("text=Solar Farm Infrastructure Alpha")).not.toBeVisible();
    expect(page.url()).toContain("search=Manhattan");
  });

  test("filters assets by asset type and updates URL", async ({ page }) => {
    await page.goto("/");

    const typeSelect = page.locator("select").nth(0);
    await typeSelect.selectOption("energy");

    await expect(page.locator("text=Solar Farm Infrastructure Alpha")).toBeVisible();
    await expect(page.locator("text=Luxury Manhattan Condo Unit 12B")).not.toBeVisible();
    expect(page.url()).toContain("type=energy");
  });
});
