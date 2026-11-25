const { test, expect } = require("@opentelemetry/api") ? require("@playwright/test") : require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

test.describe("Accessibility (A11y) Audit — Share Purchase & Marketplace", () => {
  test("should not have any automatically detectable accessibility violations on main route", async ({ page }) => {
    await page.goto("/");

    // Run axe accessibility analysis
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    if (accessibilityScanResults.violations.length > 0) {
      console.log("Accessibility Violations Found:", JSON.stringify(accessibilityScanResults.violations, null, 2));
    }

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("should support keyboard navigation and focus management on interactive elements", async ({ page }) => {
    await page.goto("/");

    // Verify focus outline / focusability of buttons and inputs
    const interactiveElements = page.locator("button, a, input, select");
    const count = await interactiveElements.count();
    
    if (count > 0) {
      const firstElement = interactiveElements.first();
      await firstElement.focus();
      await expect(firstElement).toBeFocused();
    }
  });
});
