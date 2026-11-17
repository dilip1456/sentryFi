/**
 * Gift Cards redesign + nav swap (Dilip, Nov 16): Gift Cards takes Money
 * Map's bottom-bar slot, cards group by issuer, and each card opens a
 * full-screen scannable barcode. Primary CTAs use real mouse clicks at the
 * element's centre (page.mouse.click), not locator.click({ force }).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const SIZES: [number, number][] = [[360, 780], [390, 844], [412, 915], [1440, 900]];

async function realClick(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const b = (await target.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function min44(target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded();
  const b = (await target.boundingBox())!;
  expect(b, `${label} box`).toBeTruthy();
  expect(Math.round(b.height), `${label} height`).toBeGreaterThanOrEqual(44);
  expect(Math.round(b.width), `${label} width`).toBeGreaterThanOrEqual(44);
}

async function noSideScroll(page: Page, label: string) {
  const over = await page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - window.innerWidth;
    const main = document.querySelector("main");
    return Math.max(doc, main ? main.scrollWidth - main.clientWidth : 0);
  });
  expect(over, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
}

async function openDemoHome(page: Page) {
  await page.addInitScript(() => { sessionStorage.clear(); localStorage.removeItem("sentryfi_giftcards_view"); });
  await page.goto("/demo");
  await expect(page.locator("[data-testid='example-data']:visible")).toBeVisible();
}

for (const [W, H] of SIZES) {
  const mobile = W < 768;
  test.describe(`${W}px`, () => {
    test.use(mobile ? { viewport: { width: W, height: H }, isMobile: true, hasTouch: true } : { viewport: { width: W, height: H } });

    test("nav: Gift Cards replaces Money Map, which has no entry point", async ({ page, guard }) => {
      await openDemoHome(page);
      if (mobile) {
        const bar = page.locator("nav.md\\:hidden");
        await expect(bar.getByRole("button")).toHaveText(["Home", "Gift Cards", "Spending", "Picture", "More"]);
        await expect(bar.getByRole("button", { name: /Money Map/ })).toHaveCount(0);
        await realClick(page, bar.getByRole("button", { name: "More" }));
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: "Gift Cards" })).toHaveCount(0);
        await expect(menu.getByRole("menuitem", { name: /Money Map/ })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        const gc = bar.getByRole("button", { name: "Gift Cards" });
        await min44(gc, "Gift Cards tab");
        await realClick(page, gc);
      } else {
        const side = page.locator("aside");
        await expect(side.getByRole("button", { name: /Money Map/ })).toHaveCount(0);
        await realClick(page, side.getByRole("button", { name: "Gift Cards", exact: true }));
      }
      await expect(page.getByTestId("giftcards")).toBeVisible();
      await expect(page.getByRole("button", { name: /Money Map/ })).toHaveCount(0);
      expect(guard.consoleErrors).toEqual([]);
    });

    test("issuer groups, sorting, search and expiring filter", async ({ page, guard }) => {
      await openDemoHome(page);
      if (mobile) await realClick(page, page.locator("nav.md\\:hidden").getByRole("button", { name: "Gift Cards" }));
      else await realClick(page, page.locator("aside").getByRole("button", { name: "Gift Cards", exact: true }));
      const section = page.getByTestId("giftcards");
      await expect(section.getByTestId("gc-total")).toHaveText("$321.13");
      const headers = section.getByTestId("gc-issuer");
      await expect(headers).toHaveCount(7);
      // Default sort: highest issuer total first.
      await expect(headers.first()).toHaveAttribute("data-issuer", "bestbuy");
      const sb = section.getByRole("button", { name: /^Starbucks, 2 cards, \$24\.65/ });
      await expect(sb).toHaveAttribute("aria-expanded", "true");
      await min44(sb, "Issuer header");
      await realClick(page, sb);
      await expect(sb).toHaveAttribute("aria-expanded", "false");
      await expect(section.getByRole("button", { name: /^Show Starbucks ending 5521 at checkout$/ })).toHaveCount(0);
      await realClick(page, sb);
      await expect(section.getByRole("button", { name: /^Show Starbucks ending 5521 at checkout$/ })).toBeVisible();

      const sort = section.getByRole("combobox", { name: "Sort cards" });
      await min44(sort, "Sort");
      await sort.selectOption("expiry");
      await expect(headers.first()).toHaveAttribute("data-issuer", "starbucks");
      await expect(headers.last()).toHaveAttribute("data-issuer", "dominos");

      const flat = section.getByRole("button", { name: "All cards" });
      await min44(flat, "All cards toggle");
      await realClick(page, flat);
      await expect(headers).toHaveCount(0);
      await expect(section.getByRole("button", { name: /^Show .* at checkout$/ })).toHaveCount(9);
      await realClick(page, section.getByRole("button", { name: "By issuer" }));
      await expect(headers).toHaveCount(7);

      await section.getByRole("searchbox", { name: "Search gift cards" }).fill("amazon");
      await expect(headers).toHaveCount(1);
      await section.getByRole("searchbox", { name: "Search gift cards" }).fill("");

      const exp = section.getByTestId("gc-expiring");
      await expect(exp).toContainText("$53.07");
      await min44(exp, "Expiring filter");
      await realClick(page, exp);
      await expect(exp).toHaveAttribute("aria-pressed", "true");
      await expect(section.getByRole("button", { name: /^Show .* at checkout$/ })).toHaveCount(2);
      await realClick(page, exp);
      await min44(section.getByRole("button", { name: "Add gift card" }), "Add gift card");
      await noSideScroll(page, "Gift Cards list");
      expect(guard.consoleErrors).toEqual([]);
    });

    test("Show at checkout renders a barcode full-screen", async ({ page, guard }) => {
      await openDemoHome(page);
      if (mobile) await realClick(page, page.locator("nav.md\\:hidden").getByRole("button", { name: "Gift Cards" }));
      else await realClick(page, page.locator("aside").getByRole("button", { name: "Gift Cards", exact: true }));
      const cta = page.getByRole("button", { name: "Show Best Buy ending 5130 at checkout" });
      await min44(cta, "Row/tile checkout button");
      await realClick(page, cta);
      const view = page.getByTestId("gc-checkout");
      await expect(view).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);
      const vp = page.viewportSize()!;
      const box = (await view.boundingBox())!;
      expect(Math.round(box.width)).toBe(vp.width);
      expect(Math.round(box.height)).toBe(vp.height);
      const code = view.getByRole("img", { name: /Code 128 barcode for Best Buy card number 6155 4321 0987 5130/ });
      await expect(code.locator("svg")).toBeVisible();
      await expect(view.getByTestId("gc-checkout-number")).toHaveText("6155 4321 0987 5130");
      // White, high-contrast surface regardless of the app theme.
      expect(await view.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      // Focus starts inside the dialog.
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=gc-checkout]"))).toBe(true);

      const pin = view.getByRole("button", { name: "Tap to reveal PIN" });
      await min44(pin, "Reveal PIN");
      await expect(view.getByTestId("gc-checkout-pin")).toHaveCount(0);
      await realClick(page, pin);
      await expect(view.getByTestId("gc-checkout-pin")).toHaveText("2841");
      for (const f of ["QR code", "EAN-13", "PDF417", "Code 128"]) {
        const chip = view.getByRole("button", { name: f, exact: true });
        await min44(chip, `${f} chip`);
        await realClick(page, chip);
        await expect(view.getByTestId("gc-barcode").locator("svg")).toBeVisible();
      }
      await noSideScroll(page, "Checkout view");
      const close = view.getByRole("button", { name: "Close", exact: true });
      await min44(close, "Checkout close");
      await realClick(page, close);
      await expect(view).toBeHidden();
      // Focus goes back to the button that opened it.
      await expect(cta).toBeFocused();
      expect(guard.consoleErrors).toEqual([]);
    });

    test("usage history: log a use and see it in the timeline", async ({ page, guard }) => {
      await openDemoHome(page);
      let scope: Locator;
      if (mobile) {
        await realClick(page, page.locator("nav.md\\:hidden").getByRole("button", { name: "Gift Cards" }));
        await realClick(page, page.getByRole("button", { name: /^Starbucks ending 5521/ }));
        scope = page.getByRole("dialog", { name: "Starbucks details" });
      } else {
        await realClick(page, page.locator("aside").getByRole("button", { name: "Gift Cards", exact: true }));
        await realClick(page, page.getByRole("button", { name: /^Starbucks ending 5521, / }));
        scope = page.getByTestId("gc-panel");
        await expect(scope).toHaveAttribute("aria-label", "Starbucks details");
      }
      const history = scope.getByTestId("gc-history");
      await expect(history.getByTestId("gc-total-used")).toHaveText("$11.45");
      await expect(history.getByTestId("gc-history-row")).toHaveCount(4);
      await expect(history.getByTestId("gc-history-row").first()).toContainText("Topped up");

      const addUse = history.getByRole("button", { name: "Add use" });
      await min44(addUse, "Add use");
      await realClick(page, addUse);
      const dlg = page.getByTestId("gc-balance-dialog");
      await expect(dlg).toBeVisible();
      await expect(dlg.getByRole("button", { name: "Used", exact: true })).toHaveAttribute("aria-pressed", "true");
      await dlg.getByLabel("Amount used").fill("4.50");
      await dlg.getByLabel("At (optional)").fill("Starbucks Reserve");
      await expect(dlg.getByTestId("gc-new-balance")).toHaveText("$13.90");
      const save = dlg.getByRole("button", { name: "Log use" });
      await min44(save, "Log use");
      await realClick(page, save);
      await expect(dlg).toBeHidden();

      const first = history.getByTestId("gc-history-row").first();
      await expect(first).toHaveAttribute("data-kind", "spend");
      await expect(first).toContainText("Used at Starbucks Reserve");
      await expect(first).toContainText("−$4.50");
      await expect(first).toContainText("Balance $13.90");
      await expect(history.getByTestId("gc-history-row")).toHaveCount(5);
      await expect(history.getByTestId("gc-total-used")).toHaveText("$15.95");
      await expect(scope).toContainText("$13.90");
      await noSideScroll(page, "History");
      expect(guard.consoleErrors).toEqual([]);
    });

    if (mobile) {
      test("mobile: detail popup CTA and long-press action sheet", async ({ page, guard }) => {
        await openDemoHome(page);
        await realClick(page, page.locator("nav.md\\:hidden").getByRole("button", { name: "Gift Cards" }));
        await realClick(page, page.getByRole("button", { name: /^IKEA ending 3931/ }));
        const dlg = page.getByRole("dialog", { name: "IKEA details" });
        await expect(dlg).toBeVisible();
        await min44(dlg.getByRole("button", { name: "Close", exact: true }), "Detail Close");
        const show = dlg.getByRole("button", { name: "Show at checkout" });
        await min44(show, "Detail Show at checkout");
        await realClick(page, show);
        const view = page.getByTestId("gc-checkout");
        await expect(view.getByRole("img", { name: /EAN-13 barcode for IKEA/ }).locator("svg")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(view).toBeHidden();

        const row = page.getByRole("button", { name: /^Amazon ending 4M2R/ });
        await row.scrollIntoViewIfNeeded();
        const b = (await row.boundingBox())!;
        await page.mouse.move(b.x + 60, b.y + b.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(700);
        await page.mouse.up();
        const sheet = page.getByTestId("gc-action-sheet");
        await expect(sheet).toBeVisible();
        for (const name of ["Show at checkout", "Update balance", "Edit card", "Mark used / archive", "Remove card"]) {
          await min44(sheet.getByRole("button", { name, exact: true }), `Sheet: ${name}`);
        }
        await realClick(page, sheet.getByRole("button", { name: "Show at checkout", exact: true }));
        await expect(page.getByTestId("gc-checkout").getByRole("img", { name: /QR code barcode for Amazon/ }).locator("svg")).toBeVisible();
        expect(guard.consoleErrors).toEqual([]);
      });
    } else {
      test("desktop: tile grid selects into the side panel", async ({ page, guard }) => {
        await openDemoHome(page);
        await realClick(page, page.locator("aside").getByRole("button", { name: "Gift Cards", exact: true }));
        const panel = page.getByTestId("gc-panel");
        await expect(panel).toHaveAttribute("aria-label", "Best Buy details");
        await realClick(page, page.getByRole("button", { name: /^Target ending 0123, \$64\.18$/ }));
        await expect(panel).toHaveAttribute("aria-label", "Target details");
        await expect(page.getByRole("button", { name: /^Target ending 0123, / })).toHaveAttribute("aria-pressed", "true");
        const show = panel.getByRole("button", { name: "Show at checkout" });
        await realClick(page, show);
        await expect(page.getByTestId("gc-checkout").getByRole("img", { name: /PDF417 barcode for Target/ }).locator("svg")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("gc-checkout")).toBeHidden();
        await expect(show).toBeFocused();
        await noSideScroll(page, "Desktop grid");
        expect(guard.consoleErrors).toEqual([]);
      });
    }
  });
}
