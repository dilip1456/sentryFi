/**
 * App-wide popup audit at 390x844 (phone). On every tab of the demo, open
 * each control that declares a popup (aria-haspopup dialog/menu/listbox) and
 * check the popup fits the screen, scrolls instead of spilling off it, and
 * closes by Escape; dialogs (not alert dialogs or menus) must also show an X
 * that is a 44px target with nothing drawn under it, and must not scroll
 * sideways.
 *
 * POPUP_WIDTHS=360,390,430 runs the same crawl at other phone widths.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { closeXProblems, overflowProblems } from "./popup-geometry";

const HEIGHT: Record<number, number> = { 360: 780, 390: 844, 430: 932 };
const WIDTHS = (process.env.POPUP_WIDTHS ?? "390").split(",").map(Number);

const TABS: [string, string][] = [
  ["Home", "overall"], ["Money Map", "moneymap"], ["Spending", "spending"],
  ["Picture", "myfinances"], ["Gift Cards", "giftcards"], ["Benefits", "benefits"],
];
const OPEN = "[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open], [role=listbox][data-state=open]";

async function load(page: Page, view: string) {
  await page.addInitScript(v => sessionStorage.setItem("sentryfi_view", v), view);
  await page.goto("/demo");
  await expect(page.getByText("You're viewing demo data.")).toBeVisible();
  await page.waitForTimeout(500);
}

async function fits(page: Page, pop: Locator, label: string) {
  await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);
  const vp = page.viewportSize()!;
  const r = (await pop.boundingBox())!;
  expect(r.x, `${label}: left edge on screen`).toBeGreaterThanOrEqual(-1);
  expect(r.x + r.width, `${label}: right edge on screen`).toBeLessThanOrEqual(vp.width + 1);
  expect(r.y, `${label}: top on screen`).toBeGreaterThanOrEqual(-1);
  expect(r.y + r.height, `${label}: bottom on screen`).toBeLessThanOrEqual(vp.height + 1);
}

for (const W of WIDTHS) test.describe(`${W}px`, () => {
test.use({ viewport: { width: W, height: HEIGHT[W] ?? 844 }, isMobile: true, hasTouch: true });

for (const [t, view] of TABS) {
  test(`popups on ${t} fit ${W}px and close`, async ({ page, guard }) => {
    test.setTimeout(240_000);
    await load(page, view);
    // Every visible button in the page body is a candidate: most popups here
    // open from state, not a Radix trigger, so crawl them all.
    const seen: string[] = [];
    for (const sel of ["main button:visible, main [role=button]:visible, main [data-txn-row]:visible", "header button:visible"]) {
    const buttons = page.locator(sel);
    const total = Math.min(await buttons.count(), 120);
    for (let i = 0; i < total; i++) {
      const trg = buttons.nth(i);
      if (!(await trg.isVisible().catch(() => false)) || !(await trg.isEnabled().catch(() => false))) continue;
      const label = ((await trg.getAttribute("aria-label")) || (await trg.innerText().catch(() => "")).trim().split("\n")[0].slice(0, 40) || `button ${i}`);
      if (/sign ?out|log ?out|delete account|exit demo|sign up|log in/i.test(label)) continue;
      const url = page.url();
      await trg.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(250);
      const pop = page.locator(OPEN).last();
      if (page.url().split("#")[0] !== url.split("#")[0]) { await load(page, view); continue; }
      if (!(await pop.isVisible().catch(() => false))) continue;
      const role = await pop.getAttribute("role");
      seen.push(`${role}: ${label}`);
      await fits(page, pop, `${t} / ${label}`);
      if (role === "dialog" && (await pop.getAttribute("data-fp-screen")) === null) {
        await expect(pop.getByRole("button", { name: /^(Close|Back)$/ }).first(), `${t} / ${label}: has an X`).toBeVisible();
        expect.soft(await overflowProblems(pop), `${t} / ${label}: no sideways overflow`).toEqual([]);
        if (await pop.locator("button[aria-label=Close]:visible").count()) {
          expect.soft(await closeXProblems(pop), `${t} / ${label}: X is a clear 44px target`).toEqual([]);
        }
      }
      await page.keyboard.press("Escape");
      await expect(page.locator(OPEN), `${t} / ${label}: Escape closes`).toHaveCount(0, { timeout: 3000 }).catch(async () => {
        // nested popups (sheet over screen): Escape peels one at a time
        for (let k = 0; k < 3 && await page.locator(OPEN).count(); k++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
        await expect(page.locator(OPEN), `${t} / ${label}: Escape closes`).toHaveCount(0);
      });
    }
    }
    console.log(`[${t}] ${seen.length} popups: ${seen.join("; ")}`);
    expect(guard.backendCalls).toEqual([]);
  });
}
});
