import { test, expect, openDemo } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Recurring review on the one My Financial Picture at 360/390/430 (phone:
 * item opens as a bottom sheet) and 1440 (dialog): "To review" list, "How we
 * found this", Edit and Confirm move an item out of "To review" (into
 * Confirmed), Not recurring + Undo, Restore from Dismissed; no horizontal
 * overflow. Demo data; backend stubbed.
 */
const SHOTS = process.env.FP_SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

async function openPicture(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
  await openDemo(page);
  await expect(page.getByTestId("financial-picture")).toBeVisible();
}

async function noOverflow(page: Page, width: number) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, "page horizontal overflow").toBeLessThanOrEqual(width + 1);
  for (const d of await page.getByRole("dialog").all()) {
    const { sw: s, cw } = await d.evaluate(n => { const b = n.querySelector(".scr-b, .ov-b") ?? n; return { sw: b.scrollWidth, cw: b.clientWidth }; });
    expect(s, "dialog horizontal overflow").toBeLessThanOrEqual(cw + 1);
  }
}

for (const width of [360, 390, 430, 1440]) {
  const mobile = width < 768;
  test.describe(`picture @ ${width}`, () => {
    test.use(mobile ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } });

    test("review, edit + confirm leave To review, dismiss + undo, restore", async ({ page }) => {
      const tag = `picture-${width}`;
      await openPicture(page);
      const card = page.getByTestId("rcv-card");
      await card.scrollIntoViewIfNeeded();
      await expect(card).toContainText("To review");
      await expect(page.getByTestId("rcv-count")).toContainText(/\d+ detected items? to confirm or dismiss/);
      await shot(page, `${tag}-01-card`);

      await card.getByRole("button", { name: /Review all/ }).click();
      const list = page.getByTestId("rcv-list");
      await expect(list).toBeVisible();
      await expect(list.getByTestId("rcv-pending-head")).toBeVisible();
      await page.waitForTimeout(400);
      await noOverflow(page, width);
      await shot(page, `${tag}-02-list`);
      const pending = list.getByTestId("rcv-item");
      const start = await pending.count();
      expect(start).toBeGreaterThan(3);

      // Item detail: "How we found this" with matched transactions.
      const first = pending.first();
      const label = (await first.locator(".rcv-lbl b").innerText()).trim();
      await first.locator(".rcv-main").click();
      const detail = page.getByTestId("rcv-item-detail");
      await expect(detail).toBeVisible();
      await expect(detail.getByText("How we found this")).toBeVisible();
      await expect(detail.getByRole("list", { name: "Matched transactions" }).locator("li").first()).toBeVisible();
      await page.waitForTimeout(400);
      await noOverflow(page, width);
      await shot(page, `${tag}-03-item`);

      // Edit: amount → "Edited", and it leaves "To review".
      await detail.getByRole("button", { name: "Edit" }).click();
      await detail.getByLabel("Amount each time").fill("123.45");
      await shot(page, `${tag}-04-edit`);
      await detail.getByRole("button", { name: "Save" }).click();
      await expect(page.getByTestId("rcv-item-detail").locator(".rcv-badge.ok")).toContainText("Edited");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("rcv-item-detail")).toBeHidden();
      if (!(await list.isVisible())) await card.getByRole("button", { name: /Review all|See all/ }).click();
      await expect(pending).toHaveCount(start - 1);
      await list.getByRole("button", { name: "Show" }).first().click();
      await expect(list.getByTestId("rcv-confirmed").getByTestId("rcv-item").filter({ hasText: label }).first()).toContainText("$123");
      await list.getByRole("button", { name: "Hide" }).first().click();

      // Confirm another item: gone from "To review".
      const second = pending.first();
      const secondLabel = (await second.locator(".rcv-lbl b").innerText()).trim();
      await second.getByRole("button", { name: `Confirm ${secondLabel}` }).click();
      await expect(pending).toHaveCount(start - 2);

      // Not recurring → Undo.
      const third = pending.first();
      const thirdLabel = (await third.locator(".rcv-lbl b").innerText()).trim();
      await third.getByRole("button", { name: `${thirdLabel} is not recurring` }).click();
      await expect(pending).toHaveCount(start - 3);
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "marked not recurring" });
      await expect(toast).toBeVisible();
      await shot(page, `${tag}-05-undo-toast`);
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(pending).toHaveCount(start - 2);

      // Not recurring → Restore from Dismissed.
      await pending.filter({ hasText: thirdLabel }).first().getByRole("button", { name: `${thirdLabel} is not recurring` }).click();
      await expect(pending).toHaveCount(start - 3);
      await list.getByRole("button", { name: "Show" }).last().evaluate(n => n.scrollIntoView({ block: "center" }));
      await list.getByRole("button", { name: "Show" }).last().click();
      const dis = list.getByTestId("rcv-dismissed").filter({ hasText: thirdLabel });
      // The frozen test clock keeps the last toast up; keep the row clear of it.
      await dis.getByRole("button", { name: "Restore" }).evaluate(n => n.scrollIntoView({ block: "center" }));
      await shot(page, `${tag}-06-dismissed`);
      await dis.getByRole("button", { name: "Restore" }).click();
      await expect(pending).toHaveCount(start - 2);
      await noOverflow(page, width);
    });
  });
}

test("phone: an item opens as a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicture(page);
  await page.getByTestId("rcv-card").getByRole("button", { name: /Review all/ }).click();
  await page.getByTestId("rcv-list").getByTestId("rcv-item").first().locator(".rcv-main").click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByTestId("rcv-item-detail") });
  await expect(sheet.locator(".grab")).toHaveCount(1);
});
