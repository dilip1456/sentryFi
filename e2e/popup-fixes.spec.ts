/**
 * Regression tests for the popup bugs found on PR #28 (tester run
 * popups-table-fcfc586), at the three phone widths we support:
 *  - the transaction details sheet's close X sat on the amount, and its
 *    content scrolled sideways (475px wide at 390),
 *  - the gift card details X sat on the card art,
 *  - the Spending Filters sheet and the header menu had no X (the menu also
 *    ignored Escape),
 *  - Money Map "Tag N" crashed with React #130 (role chips' icon was undefined).
 * Every X must be a 44px tap target with nothing drawn under it, and no popup
 * may overflow sideways.
 */
import type { Page } from "@playwright/test";
import { test, expect, openDemo } from "./fixtures";
import { expectCleanPopup, settle } from "./popup-geometry";

const SHOTS = process.env.POPUP_SHOTS_DIR; // e.g. /workspace/sentryfi-review/popupfix
const WIDTHS: [number, number][] = [[360, 780], [390, 844], [430, 932]];

async function openView(page: Page, view: string) {
  await page.addInitScript(v => sessionStorage.setItem("sentryfi_view", v), view);
  await openDemo(page);
  await page.waitForTimeout(300);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const reactCrashes = (errors: string[]) => errors.filter(e => /#130|ErrorBoundary|Element type is invalid/.test(e));

for (const [W, H] of WIDTHS) test.describe(`${W}px`, () => {
  test.use({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true });

  test("transaction details: X clear of the amount, no sideways scroll", async ({ page, guard }) => {
    await openView(page, "spending");
    // The tester's repro row: Starbucks $34.50 flagged "Possible duplicate".
    const row = page.locator("[data-txn-row]").filter({ hasText: /Possible duplicate|Dup\?/ }).first();
    await expect(row).toBeVisible();
    await row.click();
    const sheet = page.getByRole("dialog", { name: "Transaction details" });
    await expect(sheet).toBeVisible();
    await expectCleanPopup(page, sheet, "Transaction details");
    await shot(page, `${W}-txn-details`);
    // Edit tab has its own fields; it must not scroll sideways either.
    await sheet.getByRole("button", { name: "Edit", exact: true }).click();
    await expectCleanPopup(page, sheet, "Transaction details / Edit");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    expect(guard.consoleErrors).toEqual([]);
  });

  test("gift card details: X clear of the card art", async ({ page, guard }) => {
    await openView(page, "giftcards");
    await page.locator("main").getByRole("button", { name: /Domino's/ }).first().click();
    const dlg = page.getByRole("dialog", { name: "Domino's details" });
    await expect(dlg).toBeVisible();
    await expectCleanPopup(page, dlg, "Gift card details");
    await shot(page, `${W}-giftcard-details`);
    await dlg.getByRole("button", { name: "Next card" }).click();
    const next = page.getByRole("dialog", { name: /details$/ });
    await expectCleanPopup(page, next, "Gift card details (next card)");
    for (const name of ["Previous card", "Next card"]) {
      const b = (await next.getByRole("button", { name }).boundingBox())!;
      expect(Math.min(b.width, b.height), `${name} is a 44px target`).toBeGreaterThanOrEqual(43.5);
    }
    await next.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(guard.consoleErrors).toEqual([]);
  });

  test("spending filters sheet has an X", async ({ page, guard }) => {
    await openView(page, "spending");
    const trigger = page.getByRole("button", { name: "Filter", exact: true });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await expectCleanPopup(page, sheet, "Filters");
    await shot(page, `${W}-spending-filters`);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(guard.consoleErrors).toEqual([]);
  });

  test("header menu has an X and closes on Escape", async ({ page, guard }) => {
    await openView(page, "overall");
    const gear = page.locator("header").getByRole("button", { name: "Menu", exact: true });
    await gear.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expectCleanPopup(page, menu, "Header menu");
    await shot(page, `${W}-header-menu`);
    await menu.getByRole("button", { name: "Close" }).click();
    await expect(menu).toBeHidden();
    await gear.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    expect(page.url()).toMatch(/\/demo$/);
    expect(guard.consoleErrors).toEqual([]);
  });

  test("Money Map: Tag opens and every role can be picked", async ({ page, guard }) => {
    await openView(page, "moneymap");
    const tag = page.locator("main").getByRole("button", { name: /^(Tag \d+|Edit roles)$/ }).first();
    await expect(tag).toBeVisible();
    await tag.click();
    const dlg = page.getByRole("dialog", { name: "Account roles" });
    await expect(dlg).toBeVisible();
    expect(reactCrashes(guard.consoleErrors), "no React crash opening Tag").toEqual([]);
    await expectCleanPopup(page, dlg, "Account roles");
    await shot(page, `${W}-moneymap-roles`);
    // First account's chips: pick each role in turn.
    const chips = dlg.locator("button[aria-pressed]");
    const perAccount = await dlg.locator("button[aria-pressed]").evaluateAll(bs => {
      const first = bs[0]?.parentElement; return bs.filter(b => b.parentElement === first).length;
    });
    expect(perAccount, "role chips for the first account").toBeGreaterThanOrEqual(6);
    for (let i = 0; i < perAccount; i++) {
      const chip = chips.nth(i);
      const name = (await chip.innerText()).trim();
      await chip.click();
      await expect(chip, `role "${name}" selected`).toHaveAttribute("aria-pressed", "true");
      await expect(chip.locator("svg"), `role "${name}" has its icon`).toHaveCount(1);
    }
    await dlg.getByRole("button", { name: "Done" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    expect(guard.consoleErrors).toEqual([]);
  });

  test("Manage budgets keeps its content clear of the X", async ({ page, guard }) => {
    await openView(page, "spending");
    await page.locator("main").getByRole("button", { name: "Manage budgets" }).first().click();
    const budgets = page.getByRole("dialog", { name: "Manage budgets" });
    await expect(budgets).toBeVisible();
    await expectCleanPopup(page, budgets, "Manage budgets");
    await page.keyboard.press("Escape");
    await expect(budgets).toBeHidden();

    expect(guard.consoleErrors).toEqual([]);
  });
});

// The Rules manager is only reachable from the tablet/desktop toolbar ("More").
test.describe("tablet (800px)", () => {
  test.use({ viewport: { width: 800, height: 1000 } });
  test("Rules dialog: header buttons clear of the X", async ({ page, guard }) => {
    await openView(page, "spending");
    await page.getByRole("button", { name: "More list options" }).click();
    await page.getByRole("menuitem", { name: /^Rules/ }).click();
    const rules = page.getByRole("dialog", { name: "Rules" });
    await expect(rules).toBeVisible();
    await expectCleanPopup(page, rules, "Transaction rules");
    await shot(page, "800-rules");
    await rules.getByRole("button", { name: "Close" }).click();
    await expect(rules).toBeHidden();
    expect(guard.consoleErrors).toEqual([]);
  });
});
