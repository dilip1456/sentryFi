import type { Page, Locator } from "@playwright/test";
import { test, expect, openDemo, QA_NOW } from "./fixtures";

/**
 * Paycheck anomaly alerts in the Timeline (demo): they appear under the
 * Alerts filter, open in the same detail dialog (desktop) / sheet (390px),
 * and "Mark as seen" flips them to Seen. QA_NOW = 2026-10-20.
 */
const panel = (p: Page) => p.getByTestId("tl-panel");
const PAY = '[data-tl-ev="alert:paycheck-shortfall-2026-10"]';
const SHOTS = process.env.TL_SHOTS;
const shot = async (p: Page, name: string) => { if (SHOTS) { await p.waitForTimeout(450); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const waitLoaded = (p: Page) => expect(p.getByTestId("tl-skeleton")).toHaveCount(0);

async function checkDetail(d: Locator) {
  await expect(d.getByTestId("tl-detail")).toContainText("Usually ~2 paychecks land per month based on recent history — only 1 found so far this month.");
  await expect(d.getByTestId("tl-detail")).toContainText("Paychecks this month");
  await expect(d.getByTestId("tl-detail")).toContainText("1 of usual ~2");
  await expect(d.getByTestId("tl-detail")).toContainText("SentryFi paycheck check");
  await expect(d.getByTestId("tl-detail")).toContainText("Tue, Oct 20, 2026");
}

async function alertsOnly(p: Page, chipsRoot: Locator) {
  await chipsRoot.getByRole("button", { name: "Alerts" }).click(); await waitLoaded(p);
  const cats = await panel(p).locator(".tl-ev:not(.ghost)").evaluateAll(els => [...new Set(els.map(e => (e as HTMLElement).dataset.cat))]);
  expect(cats).toEqual(["alerts"]);
}

test.describe("Timeline paycheck alerts · desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => { await openDemo(page); });

  test("P1-P5 Alerts filter shows the paycheck alert; dialog; Mark as seen; closes", async ({ page, guard }) => {
    await page.locator("aside").getByRole("button", { name: "Timeline" }).click(); await waitLoaded(page);
    await expect(panel(page).locator(PAY)).toBeVisible(); // P1 in All, near the top
    await alertsOnly(page, panel(page).locator(".tl-chips"));
    const card = panel(page).locator(PAY);
    await expect(card).toBeVisible(); // P2 under Alerts
    await expect(card).toHaveClass(/\balert\b/);
    await expect(card).toContainText("Paycheck may be missing");
    await expect(card).toContainText("Only 1 of your usual ~2 paychecks this month");
    await expect(card).toHaveAttribute("aria-label", /Needs a look$/);

    const dlg = page.getByTestId("tl-detail-dialog");
    await shot(page, "paycheck-1440-alerts-filter");
    await card.click();
    await expect(dlg).toBeVisible(); // P3 same dialog
    await checkDetail(dlg);
    await shot(page, "paycheck-1440-dialog");
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(card).toBeFocused();

    await card.click(); await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Mark as seen" }).click(); // P4
    await expect(dlg.getByRole("button", { name: "Mark as seen" })).toHaveCount(0);
    await expect(dlg.getByTestId("tl-detail")).toContainText("Seen");
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toBeHidden();
    await expect(card).not.toHaveClass(/\balert\b/); // P5 card shows Seen
    await expect(card).toHaveAttribute("aria-label", /Seen$/);
    await shot(page, "paycheck-1440-seen");
    expect(guard.consoleErrors).toEqual([]);
  });

  test("P6 not shown for other filters or a jump before the 20th", async ({ page }) => {
    await page.locator("aside").getByRole("button", { name: "Timeline" }).click(); await waitLoaded(page);
    await panel(page).locator(".tl-chips").getByRole("button", { name: "Income" }).click(); await waitLoaded(page);
    await expect(panel(page).locator(PAY)).toHaveCount(0);
    await panel(page).locator(".tl-chips").getByRole("button", { name: "All" }).click(); await waitLoaded(page);
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Last month" }).click(); await waitLoaded(page);
    await expect(panel(page).locator(PAY)).toHaveCount(0);
  });
});

test.describe("Timeline paycheck alerts · phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.beforeEach(async ({ page }) => { await openDemo(page); });

  test("P7-P9 Alerts chip in the filter sheet, detail sheet, Mark as seen, close methods", async ({ page, guard }) => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "Timeline", exact: true }).last().click();
    await expect(panel(page)).toBeVisible(); await waitLoaded(page);
    await panel(page).getByRole("button", { name: "Filters" }).click();
    const fs = page.getByTestId("tl-sheet-filters");
    await expect(fs).toBeVisible();
    await alertsOnly(page, fs);
    await fs.getByRole("button", { name: "Done" }).click(); await expect(fs).toBeHidden();

    const card = panel(page).locator(PAY);
    await expect(card).toBeVisible(); // P7
    const cb = (await card.boundingBox())!;
    expect(cb.height).toBeGreaterThanOrEqual(44);
    expect(cb.x + cb.width).toBeLessThanOrEqual(390);

    const sheet = page.getByTestId("tl-detail-sheet");
    const open = async () => { await card.click(); await expect(sheet).toBeVisible(); await page.waitForTimeout(350); };
    await shot(page, "paycheck-390-alerts-filter");
    await open(); // P8 same sheet
    await checkDetail(sheet);
    await shot(page, "paycheck-390-sheet");
    await expect.poll(async () => { const b = (await sheet.boundingBox())!; return Math.round(b.y + b.height); }).toBe(844); // bottom sheet
    await sheet.getByRole("button", { name: "Close" }).click(); await expect(sheet).toBeHidden();
    await open(); await page.keyboard.press("Escape"); await expect(sheet).toBeHidden();
    await open(); await page.goBack(); await expect(sheet).toBeHidden(); await expect(panel(page)).toBeVisible();
    await open(); await page.mouse.click(195, 60); await expect(sheet).toBeHidden();

    await open();
    const mark = sheet.getByRole("button", { name: "Mark as seen" });
    const mb = (await mark.boundingBox())!;
    expect(mb.height).toBeGreaterThanOrEqual(44);
    await mark.click(); // P9
    await expect(mark).toHaveCount(0);
    await expect(sheet.getByTestId("tl-detail")).toContainText("Seen");
    await sheet.getByRole("button", { name: "Close" }).click(); await expect(sheet).toBeHidden();
    await expect(card).toHaveAttribute("aria-label", /Seen$/);
    await shot(page, "paycheck-390-seen");
    expect(guard.consoleErrors).toEqual([]);
  });
});
