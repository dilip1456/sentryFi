import type { Page, Locator } from "@playwright/test";
import { test, expect, openDemo, QA_NOW } from "./fixtures";

/**
 * Timeline sidebar (demo data). Mirrors the approved prototype's interaction
 * checklist (review/financial-picture/timeline/interaction-test-results.txt):
 * D* = desktop 1440x900 sidebar, M* = phone 390x844 full-screen + sheets.
 */

const panel = (p: Page) => p.getByTestId("tl-panel");
const events = (p: Page) => panel(p).locator("[data-tl-ev]");
const history = (p: Page) => panel(p).locator(".tl-ev:not(.ghost)");
const ghosts = (p: Page) => panel(p).locator(".tl-ev.ghost");
const cats = async (p: Page) => [...new Set(await history(p).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.cat)))];

async function waitLoaded(p: Page) {
  await expect(p.getByTestId("tl-skeleton")).toHaveCount(0);
}

async function scrollToEnd(p: Page) {
  const body = p.getByTestId("tl-body");
  for (let i = 0; i < 60; i++) {
    if (await p.getByTestId("tl-end").or(p.getByTestId("tl-empty")).count()) return;
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await p.waitForTimeout(150);
  }
  throw new Error("never reached the end of history");
}

/** Real touch swipe through CDP (vaul listens to pointer events of type touch). */
// The fixtures pin Date (page.clock.setFixedTime); vaul times drags with Date
// (ignores drags <500ms after opening, uses velocity), so advance it by hand.
let fakeNow = QA_NOW.getTime();
async function swipeDown(p: Page, el: Locator, dy: number) {
  fakeNow += 5_000;
  await p.clock.setFixedTime(new Date(fakeNow));
  const box = (await el.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 10;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    fakeNow += 40; // ~320ms gesture
    await p.clock.setFixedTime(new Date(fakeNow));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / steps }] });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("Timeline · desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const navBtn = (p: Page) => p.locator("aside").getByRole("button", { name: "Timeline" });

  test.beforeEach(async ({ page }) => { await openDemo(page); });

  test("D1-D7 open, first page, upcoming + Today, transfers hidden, infinite scroll, sticky month", async ({ page, guard }) => {
    await expect(panel(page)).toBeHidden(); // D1
    // the demo "fetch" takes 250ms, too short to poll for reliably: record it in-page
    await page.evaluate(() => {
      const w = window as unknown as { __tlSkel?: boolean };
      new MutationObserver(() => { if (document.querySelector('[data-testid="tl-skeleton"]')) w.__tlSkel = true; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await navBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tlSkel?: boolean }).__tlSkel)).toBe(true); // D2 skeletons first
    expect((await panel(page).boundingBox())!.width).toBe(400);
    await expect(navBtn(page)).toHaveAttribute("aria-expanded", "true"); // D3
    await waitLoaded(page);
    expect(await history(page).count()).toBe(25); // D4
    expect(await ghosts(page).count()).toBeGreaterThan(0);
    const order = await panel(page).evaluate(el => {
      const lastGhost = [...el.querySelectorAll(".tl-ev.ghost")].pop()!;
      const today = el.querySelector("[data-testid=tl-today]")!;
      const firstPast = el.querySelector(".tl-ev:not(.ghost)")!;
      return [lastGhost.compareDocumentPosition(today) & 4, today.compareDocumentPosition(firstPast) & 4];
    });
    expect(order).toEqual([4, 4]); // ghosts above Today, history below
    await expect(panel(page).locator("[data-internal]")).toHaveCount(0); // D5 internal transfers hidden
    await expect(panel(page).locator('[data-tl-ev^="txn:demo-int"]')).toHaveCount(0);
    // D7 sticky month header
    const body = page.getByTestId("tl-body");
    await body.evaluate(el => { el.scrollTop = 900; });
    const mh = panel(page).locator(".tl-mh").first();
    const [bt, mt] = [(await body.boundingBox())!.y, (await mh.boundingBox())!.y];
    expect(Math.abs(mt - bt)).toBeLessThan(2);
    // D6 IntersectionObserver paging to the end
    await scrollToEnd(page);
    expect(await history(page).count()).toBeGreaterThan(50);
    await expect(panel(page).locator("[data-internal]")).toHaveCount(0);
    await expect(page.getByTestId("tl-end")).toContainText("You've reached the beginning");
    const ids = await history(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.tlEv));
    expect(new Set(ids).size).toBe(ids.length); // no duplicates across page boundaries
    expect(guard.consoleErrors).toEqual([]);
    expect(guard.backendCalls).toEqual([]); // demo mode never calls Supabase
  });

  test("D8-D15 filters popover: Escape, chips, Upcoming-only, transfers toggle, Reset, click outside", async ({ page }) => {
    await navBtn(page).click(); await waitLoaded(page);
    const filtersBtn = panel(page).getByRole("button", { name: "Filters" });
    await filtersBtn.click();
    const pop = page.getByTestId("tl-pop-filters");
    await expect(pop).toBeVisible(); // D8
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden(); // D9
    await expect(panel(page)).toBeVisible();
    await expect(filtersBtn).toBeFocused();

    const chips = panel(page).locator(".tl-chips");
    await chips.getByRole("button", { name: "Bills" }).click(); await waitLoaded(page);
    expect(await cats(page)).toEqual(["bills"]); // D10
    await expect(ghosts(page)).toHaveCount(0); // upcoming hidden unless chosen
    await chips.getByRole("button", { name: "Cards" }).click(); await waitLoaded(page);
    expect((await cats(page)).sort()).toEqual(["bills", "cards"]); // D11
    await chips.getByRole("button", { name: "All" }).click();
    await chips.getByRole("button", { name: "Upcoming" }).click();
    await expect(history(page)).toHaveCount(0); // D12
    expect(await ghosts(page).count()).toBeGreaterThan(0);
    await chips.getByRole("button", { name: "All" }).click(); await waitLoaded(page);

    await filtersBtn.click();
    await pop.getByRole("switch", { name: /Show internal transfers/ }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-badge")).toHaveText("1");
    await scrollToEnd(page);
    expect(await panel(page).locator('[data-internal][data-tl-ev^="txn:demo-int"]').count()).toBe(6); // D13 (3 pairs)
    await panel(page).getByRole("button", { name: "Filters" }).click().catch(() => {});
    if (!(await pop.isVisible())) await filtersBtn.click();
    await pop.getByRole("button", { name: "Reset" }).click(); await waitLoaded(page); // D14
    await expect(pop.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("tl-badge")).toHaveCount(0);
    await expect(panel(page).locator('[data-tl-ev^="txn:demo-int"]')).toHaveCount(0);
    await page.mouse.click(400, 450); // D15 outside
    await expect(pop).toBeHidden();
    await expect(panel(page)).toBeVisible(); // non-modal sidebar stays
  });

  test("D16-D18 jump to date: Jan 1, date picker + Go, Today", async ({ page }) => {
    await navBtn(page).click(); await waitLoaded(page);
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Jan 1" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-jumped")).toContainText("Thu, Jan 1, 2026"); // D16
    await expect(ghosts(page)).toHaveCount(0);
    await expect(page.getByTestId("tl-today")).toHaveCount(0);
    const first = await history(page).first().evaluate(el => (el.closest(".tl-month") as HTMLElement).getAttribute("aria-label"));
    expect(first === "January 2026" || first === "December 2025").toBeTruthy();
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.locator("#tl-date").fill("2026-05-20");
    await page.getByTestId("tl-jump").getByRole("button", { name: "Go" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-jumped")).toContainText("Wed, May 20, 2026"); // D17
    const days = await panel(page).locator(".tl-dh").allInnerTexts();
    expect(days[0]).toMatch(/may (20|19|18|1\d)/i);
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Today" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-jumped")).toHaveCount(0); // D18
    await expect(page.getByTestId("tl-today")).toBeVisible();
  });

  test("D19-D24 detail dialog: X, Escape, backdrop; sidebar Escape + X, focus return", async ({ page, guard }) => {
    await navBtn(page).click(); await waitLoaded(page);
    const dlg = page.getByTestId("tl-detail-dialog");
    const ev = history(page).first();
    await ev.click();
    await expect(dlg).toBeVisible(); // D19
    const box = (await dlg.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1440 - 400); // left of the sidebar
    await expect(dlg.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(dlg.getByTestId("tl-detail")).toContainText("Status");
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toBeHidden(); // D20 X
    await expect(panel(page)).toBeVisible();
    await expect(ev).toBeFocused();

    await ev.click(); await expect(dlg).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden(); // D21 Escape closes the dialog only
    await expect(panel(page)).toBeVisible();

    await ghosts(page).first().click(); await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("expected");
    await page.mouse.click(200, 450); // D22 backdrop
    await expect(dlg).toBeHidden();
    await expect(panel(page)).toBeVisible();

    await ev.click(); await expect(dlg).toBeVisible();
    await page.goBack(); // browser back closes the dialog only
    await expect(dlg).toBeHidden();
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press("Escape"); // D23
    await expect(panel(page)).toBeHidden();
    await expect(navBtn(page)).toBeFocused();
    await expect(navBtn(page)).toHaveAttribute("aria-expanded", "false");
    await navBtn(page).click(); await waitLoaded(page);
    await panel(page).getByRole("button", { name: "Close timeline" }).click(); // D24
    await expect(panel(page)).toBeHidden();
    expect(guard.consoleErrors).toEqual([]); // D25
  });

  test("empty filter state + Clear filters", async ({ page }) => {
    await navBtn(page).click(); await waitLoaded(page);
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await page.getByTestId("tl-pop-jump").getByRole("button", { name: "Start of history" }).click(); await waitLoaded(page);
    await panel(page).locator(".tl-chips").getByRole("button", { name: "Taxes" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-empty")).toContainText("Nothing on or before");
    await page.getByTestId("tl-empty").getByRole("button", { name: "Clear filters" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-today")).toBeVisible();
  });
});

test.describe("Timeline · phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => { await openDemo(page); });

  async function openFromMore(page: Page) {
    await page.getByRole("button", { name: "More", exact: true }).click();
    const item = page.getByRole("button", { name: "Timeline", exact: true }).last();
    await expect(item).toBeVisible(); // M1
    await item.click();
    await expect(panel(page)).toBeVisible();
    await waitLoaded(page);
  }

  test("M1-M4 More menu + header icon open the full-screen timeline; back closes it", async ({ page, guard }) => {
    await openFromMore(page);
    const box = (await panel(page).boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 390, 844]); // M2 full screen
    await page.goBack(); // M3
    await expect(panel(page)).toBeHidden();
    await expect(page.getByText("You're viewing demo data.")).toBeVisible(); // still on /demo
    await page.locator("header").getByRole("button", { name: "Timeline" }).click(); // M4
    await expect(panel(page)).toBeVisible();
    await waitLoaded(page);
    await page.getByTestId("tl-back").click(); // M21
    await expect(panel(page)).toBeHidden();
    expect(guard.consoleErrors).toEqual([]);
  });

  test("M5-M9 filter + jump sheets: chip, Done, transfers, Last month, Back to today; every close method", async ({ page }) => {
    await openFromMore(page);
    const filtersBtn = panel(page).getByRole("button", { name: "Filters" });
    const sheet = page.getByTestId("tl-sheet-filters");
    await filtersBtn.click();
    await expect(sheet).toBeVisible(); // M5
    await page.waitForTimeout(500);
    const sb = (await sheet.boundingBox())!;
    expect(Math.round(sb.y + sb.height)).toBe(844); // anchored to the bottom
    await sheet.getByRole("button", { name: "Income" }).click(); await waitLoaded(page);
    expect(await cats(page)).toEqual(["income"]); // M6
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden(); // M7
    await expect(page.getByTestId("tl-badge")).toHaveText("1");
    // close methods on the filter sheet: X, Escape, backdrop, back, swipe
    for (const how of ["x", "escape", "backdrop", "back", "swipe"] as const) {
      await filtersBtn.click(); await expect(sheet).toBeVisible();
      await page.waitForTimeout(350);
      if (how === "x") await sheet.getByRole("button", { name: "Close" }).click();
      if (how === "escape") await page.keyboard.press("Escape");
      if (how === "backdrop") await page.mouse.click(195, 60);
      if (how === "back") await page.goBack();
      if (how === "swipe") await swipeDown(page, sheet.getByTestId("tl-grab"), 400);
      await expect(sheet, `filters sheet closes by ${how}`).toBeHidden();
      await expect(panel(page), `timeline stays after ${how}`).toBeVisible();
    }
    await filtersBtn.click();
    await sheet.getByRole("button", { name: "Reset" }).click();
    await sheet.getByRole("switch", { name: /Show internal transfers/ }).click();
    await expect(sheet.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("button", { name: "Done" }).click(); await waitLoaded(page);

    const jumpSheet = page.getByTestId("tl-sheet-jump");
    await panel(page).getByRole("button", { name: "Jump to date" }).click();
    await expect(jumpSheet).toBeVisible();
    await jumpSheet.getByRole("button", { name: "Last month" }).click(); await waitLoaded(page);
    await expect(jumpSheet).toBeHidden(); // M8
    await expect(page.getByTestId("tl-jumped")).toContainText("Wed, Sep 30, 2026");
    for (const how of ["x", "escape", "backdrop", "back", "swipe"] as const) {
      await panel(page).getByRole("button", { name: "Jump to date" }).click(); await expect(jumpSheet).toBeVisible();
      await page.waitForTimeout(350);
      if (how === "x") await jumpSheet.getByRole("button", { name: "Close" }).click();
      if (how === "escape") await page.keyboard.press("Escape");
      if (how === "backdrop") await page.mouse.click(195, 60);
      if (how === "back") await page.goBack();
      if (how === "swipe") await swipeDown(page, jumpSheet.getByTestId("tl-grab"), 400);
      await expect(jumpSheet, `jump sheet closes by ${how}`).toBeHidden();
      await expect(panel(page)).toBeVisible();
    }
    await page.getByTestId("tl-jumped").getByRole("button", { name: "Back to today" }).click(); await waitLoaded(page);
    await expect(page.getByTestId("tl-jumped")).toHaveCount(0); // M9
    await expect(page.getByTestId("tl-today")).toBeVisible();
  });

  test("M10-M17 detail sheet: X >= 44px, X, backdrop, Escape, back, swipe-down, short drag snaps back", async ({ page, guard }) => {
    await openFromMore(page);
    const sheet = page.getByTestId("tl-detail-sheet");
    const open = async () => { await history(page).first().click(); await expect(sheet).toBeVisible(); await page.waitForTimeout(350); };
    await open(); // M10
    await expect(panel(page).locator(".tl-ev[aria-expanded]")).toHaveCount(0); // no inline expand
    const x = sheet.getByRole("button", { name: "Close" });
    const xb = (await x.boundingBox())!;
    expect(xb.width).toBeGreaterThanOrEqual(44); expect(xb.height).toBeGreaterThanOrEqual(44); // M11
    await x.click(); await expect(sheet).toBeHidden(); await expect(panel(page)).toBeVisible(); // M12
    await open(); await page.mouse.click(195, 60); await expect(sheet).toBeHidden(); // M13
    await open(); await page.keyboard.press("Escape"); await expect(sheet).toBeHidden(); // M14
    await expect(panel(page)).toBeVisible();
    await open(); await page.goBack(); await expect(sheet).toBeHidden(); await expect(panel(page)).toBeVisible(); // M15
    await open(); await swipeDown(page, sheet.getByTestId("tl-grab"), 450); await expect(sheet).toBeHidden(); // M16
    await open(); await swipeDown(page, sheet.getByTestId("tl-grab"), 30); // M17
    await page.waitForTimeout(600);
    await expect(sheet).toBeVisible();
    await x.click(); await expect(sheet).toBeHidden();
    // upcoming ghost detail shows Covered by / Repeats
    await ghosts(page).first().click(); await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("expected");
    await x.click();
    await page.goBack(); // back now closes the timeline itself
    await expect(panel(page)).toBeHidden();
    expect(guard.consoleErrors).toEqual([]); // M22
  });

  test("M18-M20 next-page skeletons, append 25, tap targets >= 44px", async ({ page }) => {
    await openFromMore(page);
    expect(await history(page).count()).toBe(25);
    await page.getByTestId("tl-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId("tl-skeleton")).toBeVisible(); // M18
    await waitLoaded(page);
    await expect.poll(() => history(page).count()).toBeGreaterThanOrEqual(50); // M19
    const small = await panel(page).evaluate(el => [...el.querySelectorAll("button")]
      .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && (r.width < 44 || r.height < 44); })
      .map(b => b.getAttribute("aria-label") ?? b.textContent?.trim()));
    expect(small).toEqual([]); // M20
  });
});
