import { test, expect, openDemo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";

/**
 * My Financial Picture on phones (360 / 390 / 430 px): every screen, insight
 * screen, the edit screen and every bottom sheet, with demo data.
 * Asserts, on each one:
 *  - no horizontal overflow (page and the overlay's scroll body), nothing
 *    past the left/right edge;
 *  - every tap target is at least 44 × 44 px;
 *  - no clipped text (overflow hidden without an ellipsis);
 *  - back arrow / close X sit in the same place on every screen / sheet.
 * FP_SHOTS=<dir> also saves a screenshot of each (dir/<width>/<name>.png).
 */

const WIDTHS = [360, 390, 430] as const;
const SHOTS = process.env.FP_SHOTS;
const TOP = "[data-fp-screen][data-state=open], [data-fp-sheet][data-state=open]";

async function openPicture(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
  await openDemo(page);
  await expect(page.getByTestId("financial-picture")).toBeVisible();
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);

interface Audit {
  docOverflow: number; bodyOverflow: number;
  offscreen: string[]; small: string[]; clipped: string[];
  head: { x: number; y: number; w: number; h: number } | null;
}

async function audit(page: Page): Promise<Audit> {
  await settle(page);
  return page.evaluate((TOP) => {
    const vw = document.documentElement.clientWidth;
    const tops = [...document.querySelectorAll<HTMLElement>(TOP)];
    const scope = tops[tops.length - 1] ?? document.querySelector<HTMLElement>("[data-testid=financial-picture]")!;
    const body = scope.querySelector<HTMLElement>(".scr-b, .ov-b") ?? (scope.closest("main") as HTMLElement | null) ?? scope;
    const name = (el: Element) => {
      const l = el.getAttribute("aria-label") || (el as HTMLElement).innerText?.trim().split("\n")[0] || el.getAttribute("name") || el.tagName;
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".") : ""} "${(l || "").slice(0, 40)}"`;
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.closest(".sr-only, [aria-hidden=true], [hidden]")) return false;
      return (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
    };
    const offscreen: string[] = [], small: string[] = [], clipped: string[] = [];
    for (const el of scope.querySelectorAll("*")) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      // Inside a horizontal scroller on purpose? (none expected) — still flag.
      if (r.right > vw + 0.5 || r.left < -0.5) offscreen.push(`${name(el)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
      const cs = getComputedStyle(el);
      const he = el as HTMLElement;
      if (he.children.length === 0 && he.innerText?.trim() && he.scrollWidth > he.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && cs.overflowX !== "auto")
        clipped.push(name(el));
    }
    const sel = "button, a[href], input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea, [role=button], [role=radio], [role=tab], [role=switch], [tabindex='0']";
    for (const el of scope.querySelectorAll(sel)) {
      if (!shown(el) || (el as HTMLButtonElement).disabled && el.closest(".grab")) continue;
      // an amount input is drawn inside its .amt-in box; the box is the target
      const r = (el.tagName === "INPUT" && el.closest(".amt-in") || el).getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) small.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const hd = scope.querySelector(".scr-h .back, .ov-h .ov-x");
    const hr = hd?.getBoundingClientRect();
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      offscreen, small, clipped,
      head: hr ? { x: Math.round(hr.left), y: Math.round(hr.top), w: Math.round(hr.width), h: Math.round(hr.height) } : null,
    };
  }, TOP);
}

async function shot(page: Page, w: number, name: string) {
  if (!SHOTS) return;
  mkdirSync(`${SHOTS}/${w}`, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${w}/${name}.png` });
  // Tall version: the overlay / page body scrolled through, stitched by growing the viewport.
  const h = await page.evaluate((TOP) => {
    const tops = [...document.querySelectorAll<HTMLElement>(TOP)];
    const t = tops[tops.length - 1];
    const b = t?.querySelector<HTMLElement>(".scr-b, .ov-b") ?? document.querySelector("main");
    return b ? b.scrollHeight - b.clientHeight : 0;
  }, TOP);
  if (h > 40) {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: Math.min(vp.height + h, 6000) });
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${w}/${name}-full.png` });
    await page.setViewportSize(vp);
    await settle(page);
  }
}

type Step = (page: Page) => Promise<unknown>;
const sumCard = (name: string): Step => p => p.locator("button.sum-card").filter({ hasText: name }).first().click();
const tile = (name: string): Step => p => p.locator("button.tile").filter({ hasText: name }).first().click();
const inTop = (fn: (top: Locator) => Promise<unknown>): Step => p => fn(p.locator(TOP).last());
const firstRow: Step = inTop(t => t.locator(".lst button.li").first().click());

const SCREENS: [string, Step[]][] = [
  ["main-monthly", []],
  ["main-full-picture", [p => p.getByRole("button", { name: "Full Picture" }).click()]],
  ["sec-income", [sumCard("Income")]],
  ["sec-deductions", [sumCard("Paycheck Deductions")]],
  ["sec-obligations", [sumCard("Obligations")]],
  ["sec-fixed", [sumCard("Fixed Expenses")]],
  ["sec-budgets", [sumCard("Budgeted Categories")]],
  ["sec-cards", [sumCard("Cards & Payoff Accounts")]],
  ["sec-savings", [sumCard("Savings")]],
  ["sec-taxes", [p => p.getByRole("button", { name: "Full Picture" }).click(), sumCard("Taxes")]],
  ["ins-cashflow", [sumCard("Where your money goes")]],
  ["ins-coverage", [sumCard("Coverage Health")]],
  ["ins-taxsavers", [sumCard("Tax Savers")]],
  ["ins-breakdown", [tile("Savings")]],
  ["ins-bracket", [tile("Tax Bracket")]],
  ["ins-risk", [tile("Risk Profile")]],
  ["ins-shares", [tile("Shares")]],
  ["edit", [p => p.getByRole("button", { name: "Edit", exact: true }).click()]],
  ["edit-pick-sheet", [p => p.getByRole("button", { name: "Edit", exact: true }).click(), inTop(t => t.getByRole("button", { name: /covered by/ }).first().click())]],
  ["sheet-row-income", [sumCard("Income"), firstRow]],
  ["sheet-row-deduction", [sumCard("Paycheck Deductions"), firstRow]],
  ["sheet-row-obligation", [sumCard("Obligations"), firstRow]],
  ["sheet-row-fixed-gym", [sumCard("Fixed Expenses"), inTop(t => t.getByRole("button", { name: /^Gym membership, / }).click())]],
  ["sheet-row-budget", [sumCard("Budgeted Categories"), firstRow]],
  ["sheet-row-savings", [sumCard("Savings"), firstRow]],
  ["sheet-row-card", [sumCard("Cards & Payoff Accounts"), inTop(t => t.locator("button.card-item").first().click())]],
  ["sheet-row-card-unpaid", [sumCard("Cards & Payoff Accounts"), inTop(t => t.locator("button.card-item").last().click())]],
  ["sheet-pick-payoff", [sumCard("Cards & Payoff Accounts"), inTop(t => t.locator("button.card-item").first().click()), inTop(t => t.getByRole("button", { name: "Change payoff account" }).click())]],
  ["sheet-add-loan", [sumCard("Obligations"), inTop(t => t.getByRole("button", { name: /^Add/ }).first().click())]],
  ["sheet-add-bill", [sumCard("Fixed Expenses"), inTop(t => t.getByRole("button", { name: /^Add/ }).first().click())]],
  ["sheet-add-budget", [sumCard("Budgeted Categories"), inTop(t => t.getByRole("button", { name: /^Add/ }).first().click())]],
  ["sheet-add-goal", [sumCard("Savings"), inTop(t => t.getByRole("button", { name: /^Add/ }).first().click())]],
  ["sheet-coverage-fix", [sumCard("Coverage Health"), inTop(t => t.getByRole("button", { name: /Gym membership/ }).first().click())]],
];

const report: Record<string, Record<string, Audit>> = {};

for (const w of WIDTHS) {
  test.describe(`phone ${w}px`, () => {
    test.use({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
    for (const [name, steps] of SCREENS) {
      test(name, async ({ page, guard }) => {
        await openPicture(page);
        for (const s of steps) { await s(page); await settle(page); }
        if (!name.startsWith("main")) await expect(page.locator(TOP).last()).toBeVisible();
        const a = await audit(page);
        (report[w] ??= {})[name] = a;
        await shot(page, w, name);
        if (process.env.FP_AUDIT) return;
        expect.soft(a.docOverflow, "page scrolls sideways").toBeLessThanOrEqual(0);
        expect.soft(a.bodyOverflow, "screen/sheet body scrolls sideways").toBeLessThanOrEqual(1);
        expect.soft(a.offscreen, "elements past the screen edge").toEqual([]);
        expect.soft(a.small, "tap targets under 44px").toEqual([]);
        expect.soft(a.clipped, "text cut off without an ellipsis").toEqual([]);
        if (name.startsWith("sec-") || name.startsWith("ins-") || name === "edit") expect.soft(a.head, "back arrow position").toEqual({ x: 8, y: 6, w: 44, h: 44 });
        if (name.startsWith("sheet-") || name === "edit-pick-sheet") expect.soft(a.head && { x: a.head.x + a.head.w, w: a.head.w }, "sheet X position").toEqual({ x: w - 12, w: 44 });
        expect(guard.consoleErrors).toEqual([]);
      });
    }
  });
}

test.afterAll(() => {
  if (process.env.FP_AUDIT) writeFileSync(`/tmp/fp-mobile-audit-${process.pid}.json`, JSON.stringify(report, null, 1));
});
