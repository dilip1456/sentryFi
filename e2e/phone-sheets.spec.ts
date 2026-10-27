import { test, expect, openDemo } from "./fixtures";

// Phone layout: the filter and sort sheets are custom portals (not Radix
// dialogs) and must close on Escape like the transaction detail sheet does.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe("phone sheets close on Escape", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "spending"));
    await openDemo(page);
    await expect(page.locator("[data-txn-row]").first()).toBeVisible();
  });

  test("filter bottom sheet", async ({ page, guard }) => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
    expect(guard.consoleErrors).toEqual([]);
  });

  test("sort sheet", async ({ page }) => {
    await page.getByRole("button", { name: "Sort", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Sort transactions" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("transaction detail sheet", async ({ page }) => {
    await page.locator("[data-txn-row]").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
