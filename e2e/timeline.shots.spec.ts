import type { Page } from "@playwright/test";
import { test, expect, openDemo } from "./fixtures";

/**
 * Review screenshots for the Timeline (not part of the regular run).
 *   TL_SHOTS=/path/to/dir npx playwright test e2e/timeline.shots.spec.ts
 * File names mirror the approved prototype's mockups.
 */
const OUT = process.env.TL_SHOTS;
test.skip(!OUT, "set TL_SHOTS=<dir> to capture review screenshots");

const panel = (p: Page) => p.getByTestId("tl-panel");
const settle = (p: Page) => p.waitForTimeout(450);
const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png` });
const loaded = (p: Page) => expect(p.getByTestId("tl-skeleton")).toHaveCount(0);
async function toEnd(p: Page) {
  const body = p.getByTestId("tl-body");
  for (let i = 0; i < 60 && !(await p.getByTestId("tl-end").count()); i++) {
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await p.waitForTimeout(150);
  }
  await p.getByTestId("tl-end").scrollIntoViewIfNeeded();
  await expect(p.getByTestId("tl-end")).toBeVisible();
}

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("shots", async ({ page }) => {
    await openDemo(page);
    await shot(page, "timeline-desktop-closed-1440x900");
    await page.locator("aside").getByRole("button", { name: "Timeline" }).click();
    await expect(page.getByTestId("tl-skeleton").first()).toBeVisible();
    await shot(page, "timeline-desktop-skeleton-initial-1440x900");
    await loaded(page); await settle(page);
    await shot(page, "timeline-desktop-open-1440x900");

    await panel(page).locator(".tl-ev.ghost").first().click(); await settle(page);
    await shot(page, "timeline-desktop-detail-upcoming-1440x900");
    await page.keyboard.press("Escape"); await settle(page);
    await panel(page).locator('.tl-ev:not(.ghost)[data-cat="alerts"]').first().click(); await settle(page);
    await shot(page, "timeline-desktop-detail-alert-1440x900");
    await page.keyboard.press("Escape"); await settle(page);
    await panel(page).locator('.tl-ev:not(.ghost)[data-cat="spending"]').first().click(); await settle(page);
    await shot(page, "timeline-desktop-detail-1440x900");
    await page.keyboard.press("Escape"); await settle(page);

    await panel(page).getByRole("button", { name: /^Filters/ }).click(); await settle(page);
    await shot(page, "timeline-desktop-filters-1440x900");
    await page.keyboard.press("Escape");
    await panel(page).getByRole("button", { name: "Jump to date" }).click(); await settle(page);
    await shot(page, "timeline-desktop-jump-1440x900");
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Jan 1" }).click();
    await loaded(page); await settle(page);
    await shot(page, "timeline-desktop-jumped-jan1-1440x900");
    await page.getByTestId("tl-jumped").getByRole("button", { name: /Back to today/ }).click();
    await loaded(page);

    await page.getByTestId("tl-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId("tl-skeleton").first()).toBeVisible();
    await shot(page, "timeline-desktop-skeleton-scroll-1440x900");
    await loaded(page); await settle(page);
    await shot(page, "timeline-desktop-scrolled-sticky-1440x900");
    await toEnd(page); await settle(page);
    await shot(page, "timeline-desktop-end-1440x900");

    await panel(page).getByRole("button", { name: /^Filters/ }).click();
    await page.getByTestId("tl-transfers").click(); // show internal transfers
    await page.keyboard.press("Escape");
    await page.getByTestId("tl-body").evaluate(el => { el.scrollTop = 0; });
    await loaded(page);
    await panel(page).locator("[data-internal]").first().scrollIntoViewIfNeeded(); await settle(page);
    await shot(page, "timeline-desktop-transfers-shown-1440x900");

    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Start of history" }).click(); await loaded(page);
    await panel(page).locator(".tl-chips").getByRole("button", { name: "Taxes" }).click(); await loaded(page);
    await expect(page.getByTestId("tl-empty")).toBeVisible(); await settle(page);
    await shot(page, "timeline-desktop-empty-1440x900");
  });
});

test.describe("phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("shots", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "More", exact: true }).click(); await settle(page);
    await shot(page, "timeline-mobile-more-sheet-390x844");
    await page.getByRole("button", { name: "Timeline", exact: true }).last().click();
    await expect(page.getByTestId("tl-skeleton").first()).toBeVisible();
    await shot(page, "timeline-mobile-skeleton-390x844");
    await loaded(page); await settle(page);
    await shot(page, "timeline-mobile-screen-390x844");

    await panel(page).locator('.tl-ev:not(.ghost)[data-cat="spending"]').first().click(); await settle(page);
    await shot(page, "timeline-mobile-detail-sheet-390x844");
    await page.getByTestId("tl-detail-sheet").getByRole("button", { name: "Close" }).click(); await settle(page);
    await panel(page).locator(".tl-ev.ghost").first().click(); await settle(page);
    await shot(page, "timeline-mobile-detail-upcoming-390x844");
    await page.getByTestId("tl-detail-sheet").getByRole("button", { name: "Close" }).click(); await settle(page);

    await panel(page).getByRole("button", { name: /^Filters/ }).click(); await settle(page);
    await shot(page, "timeline-mobile-filters-390x844");
    await page.getByTestId("tl-sheet-filters").getByRole("button", { name: "Close" }).click(); await settle(page);
    await panel(page).getByRole("button", { name: "Jump to date" }).click(); await settle(page);
    await shot(page, "timeline-mobile-jump-390x844");
    await page.getByTestId("tl-sheet-jump").getByRole("button", { name: "Last month" }).click();
    await loaded(page); await settle(page);
    await shot(page, "timeline-mobile-jumped-390x844");
    await page.getByTestId("tl-jumped").getByRole("button", { name: /Back to today/ }).click();
    await loaded(page);

    await page.getByTestId("tl-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId("tl-skeleton").first()).toBeVisible();
    await shot(page, "timeline-mobile-skeleton-scroll-390x844");
    await loaded(page); await settle(page);
    await shot(page, "timeline-mobile-scrolled-sticky-390x844");
    await toEnd(page); await settle(page);
    await shot(page, "timeline-mobile-end-390x844");

    await page.getByTestId("tl-body").evaluate(el => { el.scrollTop = 0; });
    await panel(page).locator(".tl-chips").getByRole("button", { name: "Bills" }).click();
    await loaded(page); await settle(page);
    await shot(page, "timeline-mobile-filtered-bills-390x844");
  });
});
