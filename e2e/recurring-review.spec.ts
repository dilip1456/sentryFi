import { test, expect, openDemo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Detected recurring items on the one My Financial Picture at 360/390/430
 * (phone: item opens as a bottom sheet) and 1440 (dialog). Detections are
 * settled internally: no "To review" queue, no counts, no review chips.
 * Each plan row still opens its detail, where Edit opens the compact edit
 * sheet (form + recent charges), Remove hides it (Undo), and Hidden items
 * restores it. No horizontal overflow. Demo data; backend stubbed.
 */
const SHOTS = process.env.FP_SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

async function openPicture(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
  await openDemo(page);
  await expect(page.getByTestId("financial-picture")).toBeVisible();
}

/** A real pointer click at the element's center, once it is visible, stable and not covered. */
async function realClick(_page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate(n => n.scrollIntoView({ block: "center" })); // clear of the sticky header and toasts
  await loc.click();
}

async function noOverflow(page: Page, width: number) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, "page horizontal overflow").toBeLessThanOrEqual(width + 1);
  for (const d of await page.getByRole("dialog").all()) {
    const { sw: s, cw } = await d.evaluate(n => { const b = n.querySelector(".scr-b, .ov-b") ?? n; return { sw: b.scrollWidth, cw: b.clientWidth }; });
    expect(s, "dialog horizontal overflow").toBeLessThanOrEqual(cw + 1);
  }
}

const detectedRows = (page: Page) => page.getByTestId("plan-upcoming").locator('[data-testid="plan-row"][data-source="confirmed"]');

for (const width of [360, 390, 430, 1440]) {
  const mobile = width < 768;
  test.describe(`picture @ ${width}`, () => {
    test.use(mobile ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } });

    test("no review queue; edit, remove + undo, restore from Hidden items", async ({ page }) => {
      const tag = `picture-${width}`;
      await openPicture(page);
      const pic = page.getByTestId("picture-page");
      await expect(page.getByTestId("rcv-card")).toHaveCount(0);
      await expect(pic).not.toContainText(/to review|needs review|detected items? to confirm/i);
      const plan = page.getByTestId("plan-upcoming");
      await realClick(page, plan.getByRole("button", { name: "By cadence" }));
      await expect(plan.locator(".pl-st.det, .pl-st.ok")).toHaveCount(0); // no Needs review / Confirmed chips
      const rows = detectedRows(page);
      const start = await rows.count();
      expect(start).toBeGreaterThan(3);
      await shot(page, `${tag}-01-plan`);

      // Detail → Edit opens the compact edit sheet (form + recent charges).
      const label = (await rows.first().locator(".pl-lbl b").innerText()).trim();
      await realClick(page, rows.first());
      const detail = page.getByTestId("plan-item-detail");
      await expect(detail).toBeVisible();
      await expect(detail.getByRole("button", { name: "Confirm" })).toHaveCount(0);
      await realClick(page, detail.getByRole("button", { name: "Edit", exact: true }));
      const item = page.getByTestId("rcv-item-detail");
      await expect(item).toBeVisible();
      await expect(item.getByTestId("rcv-edit-form")).toBeVisible();
      await expect(item.getByTestId("rcv-history")).toBeVisible();
      await expect(item).not.toContainText(/Confidence \d+%|\d+ match/);
      await item.getByLabel("Expected amount").fill("123.45");
      await page.waitForTimeout(300);
      await noOverflow(page, width);
      await shot(page, `${tag}-02-edit`);
      await realClick(page, item.getByRole("button", { name: "Save" }));
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "updated" })).toBeVisible();
      await page.keyboard.press("Escape");
      if (await page.getByTestId("plan-item-detail").isVisible()) await page.keyboard.press("Escape");
      await expect(page.getByTestId("rcv-item-detail")).toBeHidden();
      await expect(rows.filter({ hasText: label }).first()).toContainText("$123");

      // Remove → Undo.
      const second = rows.nth(1);
      const secondLabel = (await second.locator(".pl-lbl b").innerText()).trim();
      await realClick(page, second);
      await realClick(page, page.getByTestId("plan-item-detail").getByRole("button", { name: "Remove" }));
      await expect(rows.filter({ hasText: secondLabel })).toHaveCount(0);
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "marked not recurring" });
      await expect(toast).toBeVisible();
      await realClick(page, toast.getByRole("button", { name: "Undo" }));
      await expect(rows.filter({ hasText: secondLabel }).first()).toBeVisible();

      // Remove → restore from Hidden items.
      await realClick(page, rows.filter({ hasText: secondLabel }).first());
      await realClick(page, page.getByTestId("plan-item-detail").getByRole("button", { name: "Remove" }));
      await expect(rows.filter({ hasText: secondLabel })).toHaveCount(0);
      await expect(page.getByTestId("plan-item-detail")).toBeHidden();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await realClick(page, page.getByTestId("plan-hidden"));
      const list = page.getByTestId("rcv-list");
      await expect(list).toBeVisible();
      await expect(list).not.toContainText(/to review|confirmed \d|\b\d+ items?\b/i);
      await realClick(page, list.getByRole("button", { name: "Show" }));
      const dis = list.getByTestId("rcv-dismissed").filter({ hasText: secondLabel });
      await dis.getByRole("button", { name: "Restore" }).evaluate(n => n.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      await noOverflow(page, width);
      await shot(page, `${tag}-03-hidden`);
      await realClick(page, dis.getByRole("button", { name: "Restore" }));
      await page.keyboard.press("Escape");
      await expect(rows.filter({ hasText: secondLabel }).first()).toBeVisible();
      await noOverflow(page, width);
    });
  });
}

test("phone: an item's edit view opens as a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicture(page);
  await realClick(page, page.getByTestId("plan-upcoming").getByRole("button", { name: "By cadence" }));
  await realClick(page, detectedRows(page).first());
  await realClick(page, page.getByTestId("plan-item-detail").getByRole("button", { name: "Edit", exact: true }));
  const sheet = page.getByRole("dialog").filter({ has: page.getByTestId("rcv-item-detail") });
  await expect(sheet.locator(".grab")).toHaveCount(1);
});
