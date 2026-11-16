import { test, expect, openDemo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { mkdirSync } from "fs";

/**
 * Option B compact notifications: urgent strip, dense inbox, no page-top
 * banners, 44px targets under pointer:coarse, no horizontal overflow.
 */

const WIDTHS: { name: string; width: number; height: number; mobile: boolean }[] = [
  { name: "360", width: 360, height: 780, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "412", width: 412, height: 915, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
];

const SHOTS = process.env.NC_SHOTS_DIR ?? "/workspace/sentryfi-review/notifications-compact";

async function noHorizontalOverflow(page: Page, extra?: Locator) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc, "document horizontal overflow").toBeLessThanOrEqual(1);
  expect(overflow.body, "body horizontal overflow").toBeLessThanOrEqual(1);
  if (extra) {
    const handle = await extra.elementHandle();
    if (handle) {
      const { sw, cw } = await handle.evaluate(n => ({ sw: (n as HTMLElement).scrollWidth, cw: (n as HTMLElement).clientWidth }));
      expect(sw, "panel horizontal overflow").toBeLessThanOrEqual(cw + 1);
    }
  }
}

async function assertMin(locator: Locator, label: string, min = 44) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).toBeTruthy();
  expect(box!.height, `${label} height ${Math.round(box!.height)}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box!.width, `${label} width ${Math.round(box!.width)}`).toBeGreaterThanOrEqual(min - 0.5);
}


async function assertStripLayout(page: Page, strip: Locator) {
  const msg = strip.locator(".nc-strip-msg");
  const view = strip.locator(".nc-strip-view");
  await expect(msg).toBeVisible();
  await expect(view).toBeVisible();
  const s = (await strip.boundingBox())!;
  const m = (await msg.boundingBox())!;
  const v = (await view.boundingBox())!;
  const mid = s.y + s.height / 2;
  expect(Math.abs((m.y + m.height / 2) - mid), "strip text vertical center").toBeLessThanOrEqual(4);
  expect(Math.abs((v.y + v.height / 2) - mid), "View vertical center").toBeLessThanOrEqual(4);
  expect(v.height, "View height").toBeGreaterThanOrEqual(43.5);
  expect(v.width, "View width").toBeGreaterThanOrEqual(43.5);

  const gap = await page.evaluate(() => {
    const stripEl = document.querySelector("[data-testid='urgent-strip']");
    const main = document.querySelector("main");
    if (!stripEl || !main) return Infinity;
    const bottom = stripEl.getBoundingClientRect().bottom;
    let nextTop = Infinity;
    for (const el of main.querySelectorAll("*")) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.height < 8 || r.width < 8) continue;
      if (r.top + 0.5 >= bottom && r.top < nextTop) nextTop = r.top;
    }
    return nextTop - bottom;
  });
  expect(gap, `gap from strip to next content (${Math.round(gap)}px)`).toBeGreaterThanOrEqual(0);
  expect(gap, `gap from strip to next content (${Math.round(gap)}px)`).toBeLessThanOrEqual(16);
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);

async function shot(page: Page, name: string) {
  await settle(page).catch(() => {});
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function openInbox(page: Page) {
  await page.getByRole("button", { name: "Notifications" }).first().click();
  const panel = page.getByTestId("inbox-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function swipeSheetDown(page: Page, sheet: Locator) {
  // vaul measures drag time with Date.now(); the fixture's frozen clock
  // makes every drag look instantaneous, so let time flow for the gesture.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(new Date(now + 5000));
  const grab = sheet.locator(".grab").first();
  await expect(grab).toBeVisible();
  const b = (await grab.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y + i * 40); await page.waitForTimeout(16); }
  await page.mouse.up();
}

for (const vp of WIDTHS) {
  test.describe(`notifications compact @ ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: true,
    });

    test("home has an urgent strip, no page banners, and no overflow", async ({ page, guard }) => {
      await openDemo(page);
      const strip = page.getByTestId("urgent-strip");
      await expect(strip).toBeVisible();
      await expect(strip).toContainText(/Urgent/);
      // Only a shortfall, a missing paycheck, or a bill due tomorrow belong on the strip.
      await expect(strip).toContainText(/Paycheck may be missing/);
      await expect(strip).toContainText(/\+1 more/);
      await expect(strip).not.toContainText(/Joint Checking|duplicate|over budget/i);
      // Option B in RATIONALE.md keeps a numeric badge so the unread count stays visible.
      const badge = page.locator("[data-testid='inbox-badge'], [data-testid='inbox-badge-side']").filter({ visible: true });
      await expect(badge.first()).toBeVisible();
      await expect(badge.first()).toHaveText(/^\d+\+?$/);
      await expect(page.getByRole("button", { name: /Notifications, \d+ unread/ }).first()).toBeVisible();
      await expect(page.getByText("Get the Sentry Finance Android app")).toHaveCount(0);
      await expect(page.getByText("You're viewing demo data.")).toBeHidden();
      await expect(page.getByRole("heading", { name: "Action items" })).toHaveCount(0);
      await assertStripLayout(page, strip);
      await noHorizontalOverflow(page);
      await shot(page, `after-home-${vp.name}`);
      expect(guard.consoleErrors).toEqual([]);
    });

    test("strip opens the inbox; filters, stacks and 44px targets", async ({ page, guard }) => {
      await openDemo(page);
      await page.getByTestId("urgent-strip").click();
      const panel = page.getByTestId("inbox-panel");
      await expect(panel).toBeVisible();
      await expect(panel.locator("#nc-title")).toHaveText("Notifications");
      await expect(panel.getByText("Needs attention")).toBeVisible();
      await expect(panel.getByText("Paycheck may be missing")).toBeVisible();
      // Collapsed bill stack
      const bills = panel.getByTestId("inbox-stack").filter({ hasText: /bill reminder/ });
      await expect(bills).toBeVisible();
      await bills.click();
      await expect(panel.getByRole("button", { name: /Netflix/ })).toBeVisible();
      await noHorizontalOverflow(page, panel);
      if (vp.mobile) {
        await assertMin(panel.locator('[data-nc-filter="unread"]'), "Unread filter");
        await assertMin(panel.locator('[data-nc-filter="all"]'), "All filter");
        await assertMin(panel.getByRole("button", { name: /Mark all read/ }), "Mark all read");
        await assertMin(page.getByTestId("urgent-strip"), "Urgent strip");
        const close = panel.getByRole("button", { name: /^(Close|Back|Close notifications)$/ }).first();
        await assertMin(close, "Inbox close");
      }
      await shot(page, `after-inbox-${vp.name}`);
      expect(guard.consoleErrors).toEqual([]);
    });

    test("inbox closes via X / Back and Escape", async ({ page }) => {
      await openDemo(page);
      const panel = await openInbox(page);
      const close = panel.getByRole("button", { name: /^(Close|Back|Close notifications)$/ }).first();
      await close.click();
      await expect(panel).toBeHidden();

      await openInbox(page);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    if (vp.mobile) {
      test("detail sheet closes via X, Escape and swipe-down", async ({ page }) => {
        await openDemo(page);
        const panel = await openInbox(page);
        await panel.getByRole("button", { name: /Paycheck may be missing/ }).click();
        const detail = page.getByTestId("inbox-detail");
        await expect(detail).toBeVisible();
        await expect(detail.getByRole("button", { name: "Mark done" })).toBeVisible();
        await assertMin(detail.getByRole("button", { name: "Mark done" }), "Mark done");
        await assertMin(detail.getByRole("button", { name: "Dismiss" }), "Dismiss");
        await noHorizontalOverflow(page, detail);
        await shot(page, `after-detail-${vp.name}`);

        await detail.getByRole("button", { name: "Close" }).click();
        await expect(detail).toBeHidden();

        await panel.getByRole("button", { name: /Paycheck may be missing/ }).click();
        await expect(detail).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(detail).toBeHidden();
        await expect(panel).toBeVisible();

        await panel.getByRole("button", { name: /Paycheck may be missing/ }).click();
        await expect(detail).toBeVisible();
        await swipeSheetDown(page, detail);
        await expect(detail).toBeHidden();
        await expect(panel).toBeVisible();
      });
    }

    test("Escape closes Settings opened from Extend history, and the inbox is already closed", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
      await openDemo(page);
      const panel = await openInbox(page);
      if (await panel.getByTestId("inbox-stack").count()) {
        const stacks = panel.getByTestId("inbox-stack");
        const n = await stacks.count();
        for (let i = 0; i < n; i++) {
          const s = stacks.nth(i);
          if ((await s.getAttribute("aria-expanded")) !== "true") await s.click();
        }
      }
      await panel.getByRole("button", { name: /Extend bank history/ }).click();
      const detail = page.getByTestId("inbox-detail");
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "Extend history" }).click();
      const dlg = page.getByRole("dialog").filter({ hasText: "Settings" });
      await expect(dlg).toBeVisible();
      await expect(panel).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
    });

    test("Picture no longer shows the history hint card; review card is compact", async ({ page, guard }) => {
      await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
      await openDemo(page);
      await expect(page.getByTestId("financial-picture")).toBeVisible();
      await expect(page.getByTestId("history-hint")).toHaveCount(0);
      const card = page.getByTestId("rcv-card");
      await expect(card).toBeVisible();
      await expect(card).toContainText(/to review/);
      await noHorizontalOverflow(page);
      await shot(page, `after-picture-${vp.name}`);
      expect(guard.consoleErrors).toEqual([]);
    });
  });
}
