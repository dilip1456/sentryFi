import { test, expect, openDemo } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * "Detected recurring" on My Financial Picture (classic + redesign) at
 * 360/390/430 (phone: item opens as a bottom sheet) and 1440 (dialog):
 * list, "How we found this", Confirm, Edit, Not recurring + Undo, Restore
 * from Dismissed; no horizontal overflow. Demo data; backend stubbed.
 */
const SHOTS = process.env.FP_SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

async function openPicture(page: Page, view: "myfinances" | "myfinances-redesign") {
  await page.addInitScript(v => sessionStorage.setItem("sentryfi_view", v), view);
  await openDemo(page);
  await expect(page.getByTestId(view === "myfinances" ? "financial-picture" : "financial-picture-redesign")).toBeVisible();
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
  for (const view of ["myfinances", "myfinances-redesign"] as const) {
    test.describe(`${view} @ ${width}`, () => {
      test.use(mobile ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } });

      test("review, confirm, edit, dismiss + undo, restore", async ({ page }) => {
        const tag = `${view === "myfinances" ? "classic" : "redesign"}-${width}`;
        await openPicture(page, view);
        const card = page.getByTestId("rcv-card");
        await card.scrollIntoViewIfNeeded();
        await expect(card).toContainText("Detected recurring");
        await expect(card).toContainText(/pattern/);
        await shot(page, `${tag}-01-card`);

        await card.getByRole("button", { name: /Review/ }).click();
        const list = page.getByTestId("rcv-list");
        await expect(list).toBeVisible();
        await expect(list.getByText("Income", { exact: false }).first()).toBeVisible();
        await page.waitForTimeout(400);
        await noOverflow(page, width);
        await shot(page, `${tag}-02-list`);

        // Item detail: "How we found this" with matched transactions.
        const first = list.getByTestId("rcv-item").first();
        const label = (await first.locator(".rcv-lbl b").innerText()).trim();
        await first.locator(".rcv-main").click();
        const detail = page.getByTestId("rcv-item-detail");
        await expect(detail).toBeVisible();
        await expect(detail.getByText("How we found this")).toBeVisible();
        await expect(detail.getByRole("list", { name: "Matched transactions" }).locator("li").first()).toBeVisible();
        await page.waitForTimeout(400);
        await noOverflow(page, width);
        await shot(page, `${tag}-03-item`);

        // Edit: amount → "Edited" badge.
        await detail.getByRole("button", { name: "Edit" }).click();
        await detail.getByLabel("Amount each time").fill("123.45");
        await shot(page, `${tag}-04-edit`);
        await detail.getByRole("button", { name: "Save" }).click();
        await expect(page.getByTestId("rcv-item-detail").locator(".rcv-badge.ok")).toContainText("Edited");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("rcv-item-detail")).toBeHidden();
        if (!(await list.isVisible())) await card.getByRole("button", { name: /Review/ }).click();
        await expect(list.getByTestId("rcv-item").filter({ hasText: label }).first()).toContainText("$123");

        // Confirm another item.
        const second = list.getByTestId("rcv-item").nth(1);
        const secondLabel = (await second.locator(".rcv-lbl b").innerText()).trim();
        await second.getByRole("button", { name: `Confirm ${secondLabel}` }).click();
        await expect(list.getByTestId("rcv-item").filter({ hasText: secondLabel }).first().locator(".rcv-badge.ok")).toContainText("Confirmed");

        // Not recurring → Undo.
        const third = list.getByTestId("rcv-item").nth(2);
        const thirdLabel = (await third.locator(".rcv-lbl b").innerText()).trim();
        const before = await list.getByTestId("rcv-item").count();
        await third.getByRole("button", { name: `${thirdLabel} is not recurring` }).click();
        await expect(list.getByTestId("rcv-item")).toHaveCount(before - 1);
        const toast = page.locator("[data-sonner-toast]").filter({ hasText: "marked not recurring" });
        await expect(toast).toBeVisible();
        await shot(page, `${tag}-05-undo-toast`);
        await toast.getByRole("button", { name: "Undo" }).click();
        await expect(list.getByTestId("rcv-item")).toHaveCount(before);

        // Not recurring → Restore from Dismissed.
        await list.getByTestId("rcv-item").filter({ hasText: thirdLabel }).first().getByRole("button", { name: `${thirdLabel} is not recurring` }).click();
        await expect(list.getByTestId("rcv-item")).toHaveCount(before - 1);
        await list.getByRole("button", { name: "Show" }).click();
        const dis = list.getByTestId("rcv-dismissed").filter({ hasText: thirdLabel });
        // The frozen test clock keeps the last toast up; keep the row clear of it.
        await dis.evaluate(n => n.scrollIntoView({ block: "center" }));
        await shot(page, `${tag}-06-dismissed`);
        await dis.getByRole("button", { name: "Restore" }).click();
        await expect(list.getByTestId("rcv-item")).toHaveCount(before);
        await noOverflow(page, width);
      });
    });
  }
}

test("phone: an item opens as a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicture(page, "myfinances");
  await page.getByTestId("rcv-card").getByRole("button", { name: /Review/ }).click();
  await page.getByTestId("rcv-list").getByTestId("rcv-item").first().locator(".rcv-main").click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByTestId("rcv-item-detail") });
  await expect(sheet.locator(".grab")).toHaveCount(1);
});
