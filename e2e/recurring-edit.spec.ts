import { test, expect, openDemo } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * One tap from any recurring plan row (the pencil) opens the compact edit
 * sheet: rename + expected amount, Save, the row shows the person's values;
 * "Reset to detected" brings the detected ones back. Rows show their pattern
 * line ("Monthly on the 13th · 8 charges since Apr") and thin-history items an
 * Estimated tag. Demo data; backend stubbed.
 */
const SHOTS = process.env.LABEL_EDIT_SHOTS_DIR;
// Settle sheet/dialog animations before a review screenshot.
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, animations: "disabled" }); } };

async function openPlan(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
  await openDemo(page);
  await expect(page.getByTestId("financial-picture")).toBeVisible();
  const plan = page.getByTestId("plan-upcoming");
  const byCadence = plan.getByRole("button", { name: "By cadence" });
  await byCadence.evaluate(n => n.scrollIntoView({ block: "center" }));
  await byCadence.click();
  return plan;
}

for (const width of [390, 1440]) {
  const mobile = width < 768;
  test.describe(`recurring edit @ ${width}`, () => {
    test.use(mobile ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } });

    test("one tap opens the edit sheet; rename + amount stick; reset restores", async ({ page }) => {
      const plan = await openPlan(page);
      const wrap = plan.locator(".pl-wrap").filter({ has: page.locator('[data-testid="plan-row"][data-source="confirmed"]') }).first();
      await expect(wrap).toBeVisible();
      const detected = (await wrap.locator(".pl-lbl b").innerText()).trim();
      // Pattern line on the row.
      await expect(wrap.locator(".pl-lbl")).toContainText(/·|seen once|seen twice/);
      await wrap.evaluate(n => n.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await shot(page, `plan-pattern-lines-${width}`);

      const pencil = wrap.getByTestId("rcv-edit");
      const box = (await pencil.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      await pencil.click(); // ONE tap
      const form = page.getByTestId("rcv-edit-form");
      await expect(form).toBeVisible();
      await expect(page.getByTestId("plan-item-detail")).toHaveCount(0);
      await expect(page.getByTestId("rcv-history")).toBeVisible();
      await expect(form.getByLabel("Name")).toHaveValue(detected);
      await form.getByLabel("Name").fill("My Renamed Bill");
      await form.getByLabel("Expected amount").fill("77.77");
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw).toBeLessThanOrEqual(width + 1);
      await shot(page, `edit-sheet-${width}`);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(page.getByTestId("rcv-edit-form")).toBeHidden();

      const renamed = plan.locator(".pl-wrap").filter({ hasText: "My Renamed Bill" }).first();
      await expect(renamed).toBeVisible();
      await expect(renamed).toContainText("$77.77");

      // Reopen: Reset to detected is offered and restores the detected name.
      await renamed.getByTestId("rcv-edit").click();
      await expect(page.getByTestId("rcv-edit-form")).toContainText(`Detected as “${detected}”`);
      await shot(page, `edit-sheet-renamed-${width}`);
      await page.getByTestId("rcv-reset").click();
      await expect(page.getByTestId("rcv-edit-form")).toBeHidden();
      await expect(plan.locator(".pl-wrap").filter({ hasText: "My Renamed Bill" })).toHaveCount(0);
      await expect(plan.locator(".pl-lbl b").filter({ hasText: detected }).first()).toBeVisible();
    });

    test("thin-history items are marked Estimated with a plain note", async ({ page }) => {
      const plan = await openPlan(page);
      const est = plan.locator(".pl-wrap").filter({ has: page.locator(".pl-st.est") }).first();
      if (!(await est.count())) test.skip(true, "demo data has no thin-history item");
      await est.evaluate(n => n.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await shot(page, `plan-estimated-row-${width}`);
      await est.getByTestId("rcv-edit").click();
      await expect(page.getByTestId("rcv-estimate-note")).toContainText(/Not enough history yet|Irregular timing/);
      await shot(page, `edit-sheet-estimated-${width}`);
    });
  });
}
