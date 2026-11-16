import { test, expect, openDemo } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync } from "fs";

/**
 * Coarse-pointer tap targets: the global @media (pointer: coarse) floor is
 * 40px and used to outrank Tailwind min-h-11 / h-11, shrinking intended 44px
 * controls. This suite emulates a touch phone at Dilip's widths and asserts
 * the Spending period tabs, Insights, and the other repaired controls are
 * at least 44×44.
 */
const WIDTHS: [number, number][] = [
  [360, 780],
  [390, 844],
  [412, 915],
];

const SHOTS = process.env.TAP44_SHOTS_DIR;

async function assertMin(locator: import("@playwright/test").Locator, label: string, min = 44) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).toBeTruthy();
  expect(box!.height, `${label} height ${Math.round(box!.height)}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box!.width, `${label} width ${Math.round(box!.width)}`).toBeGreaterThanOrEqual(min - 0.5);
}

async function openView(page: Page, view: string) {
  await page.addInitScript(v => sessionStorage.setItem("sentryfi_view", v), view);
  await openDemo(page);
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await settle(page).catch(() => {});
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

for (const [w, h] of WIDTHS) {
  test.describe(`coarse tap 44 @ ${w}`, () => {
    test.use({
      viewport: { width: w, height: h },
      isMobile: true,
      hasTouch: true,
    });

    test("pointer is coarse and Spending period tabs + Insights are >= 44px", async ({ page }) => {
      await openView(page, "spending");
      const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
      expect(coarse, "pointer: coarse media query").toBe(true);

      const tabs = page.getByRole("tablist", { name: "Period" }).getByRole("tab");
      await expect(tabs).toHaveCount(5);
      for (const tab of await tabs.all()) {
        const name = (await tab.innerText()).trim() || "period tab";
        await assertMin(tab, `Spending period tab "${name}"`);
      }
      await assertMin(page.getByRole("button", { name: "Previous month" }), "Spending previous period");
      await assertMin(page.getByRole("button", { name: "Next month" }), "Spending next period");
      await assertMin(page.getByRole("button", { name: "Open spending insights" }), "Insights");
      await shot(page, `spending-${w}`);
    });

    test("Gift Cards Add and Money Map Tag are >= 44px", async ({ page }) => {
      await openView(page, "giftcards");
      await assertMin(page.getByRole("button", { name: "Add", exact: true }), "Gift Cards Add");
      await shot(page, `giftcards-${w}`);

      await page.getByRole("navigation").getByRole("button", { name: "Money Map", exact: true })
        .or(page.getByRole("button", { name: "Money Map", exact: true })).first().click();
      await expect(page.getByRole("button", { name: /^(Tag \d+|Edit roles)$/ })).toBeVisible({ timeout: 15_000 });
      const tag = page.getByRole("button", { name: /^(Tag \d+|Edit roles)$/ });
      await tag.scrollIntoViewIfNeeded();
      await assertMin(tag, "Money Map Tag chip");
      await shot(page, `moneymap-${w}`);
    });

    test("Picture Confirm / Not-recurring icons are >= 44px", async ({ page }) => {
      await openView(page, "myfinances");
      const card = page.getByTestId("rcv-card");
      await card.scrollIntoViewIfNeeded();
      await card.getByRole("button", { name: /Review/ }).click();
      const item = page.getByTestId("rcv-list").getByTestId("rcv-item").first();
      await expect(item).toBeVisible();
      const label = (await item.locator(".rcv-lbl b").innerText()).trim();
      await assertMin(item.getByRole("button", { name: `Confirm ${label}` }), "Confirm recurring");
      await assertMin(item.getByRole("button", { name: `${label} is not recurring` }), "Not recurring");
      await shot(page, `picture-review-${w}`);
    });

    test("auth mode tabs (and reset actions) are >= 44px", async ({ page }) => {
      await page.goto("/auth");
      await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();
      await assertMin(page.getByRole("button", { name: "Sign in", exact: true }).first(), "Auth Sign in tab");
      await assertMin(page.getByRole("button", { name: "Create account" }).first(), "Auth Create account tab");
      await assertMin(page.getByRole("button", { name: "Sign in", exact: true }).nth(1), "Auth Sign in submit");
      await assertMin(page.getByRole("button", { name: "Forgot password?" }), "Auth Forgot password");
      await page.getByRole("button", { name: "Forgot password?" }).click();
      await assertMin(page.getByRole("button", { name: "Send reset email" }), "Auth Send reset email");
      await assertMin(page.getByRole("button", { name: "Cancel" }), "Auth Cancel reset");
      await assertMin(page.getByRole("button", { name: "Continue with Google" }), "Auth Google");
      await shot(page, `auth-${w}`);
    });

    test("Home title and Benefits / Timeline / Settings chrome are >= 44px where present", async ({ page }) => {
      await openView(page, "overall");
      await assertMin(page.getByRole("button", { name: /Sentry Finance/ }).first(), "Home title button");
      await shot(page, `home-${w}`);

      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Benefits" }).or(page.getByRole("button", { name: "Benefits", exact: true })).first().click();
      await expect(page.locator("[data-testid='example-data']:visible")).toBeVisible();
      await shot(page, `benefits-${w}`);

      const timeline = page.getByRole("button", { name: "Timeline" }).first();
      await assertMin(timeline, "Timeline header button");
      await timeline.click();
      await expect(page.getByTestId("tl-tab-history")).toBeVisible({ timeout: 10_000 });
      await shot(page, `timeline-${w}`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Menu" }).click();
      const settings = page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Settings" });
      if (await settings.count()) {
        await assertMin(settings.first(), "Settings menu item");
        await settings.first().click();
        const dlg = page.getByRole("dialog").filter({ hasText: "Settings" });
        if (await dlg.isVisible().catch(() => false)) {
          await shot(page, `settings-${w}`);
        }
      } else {
        // Guest demo hides Settings (needs auth). The menu itself is still a target.
        await shot(page, `header-menu-${w}`);
      }
    });
  });
}
