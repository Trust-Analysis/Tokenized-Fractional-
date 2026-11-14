const { test, expect } = require("@playwright/test");

test.describe("Official Contract Verification & Anti-Phishing (#787)", () => {
  test("displays contract address, copy button, and official registry link", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Official Contract Verification")).toBeVisible();
    await expect(page.locator("text=CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE")).toBeVisible();
    
    const copyButton = page.locator("button:has-text('Copy Contract Address')");
    await expect(copyButton).toBeVisible();

    const registryLink = page.locator("a:has-text('Verify against Official Registry')");
    await expect(registryLink).toBeVisible();
    await expect(registryLink).toHaveAttribute("href", /official-deployments.md/);
  });
});
