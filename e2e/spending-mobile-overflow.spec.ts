import { test, expect, openDemo } from "./fixtures";

/**
 * Layout contract for the Spending page on the phone widths Dilip reported
 * (360 / 390 / 412), plus 430 and 1440 as regression checks:
 *  - the document and page shell must not scroll sideways
 *  - the month-bar card stays inside the viewport (bars may scroll inside it)
 *  - In / Out totals in the period strip must not overlap
 *  - a stuck day header must not overlap the transaction rows beneath it
 *  - transaction amounts stay on one line
 */
const VIEWPORTS: [number, number][] = [
  [360, 780],
  [390, 844],
  [412, 915],
  [430, 932],
  [1440, 900],
];

const SHOTS = process.env.SPENDING_SHOTS_DIR;

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, slop = 0.5) {
  return !(a.x + a.width <= b.x + slop || b.x + b.width <= a.x + slop || a.y + a.height <= b.y + slop || b.y + b.height <= a.y + slop);
}

async function loadSpending(page: import("@playwright/test").Page, mobile: boolean) {
  if (mobile) await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "spending"));
  await openDemo(page);
  if (!mobile) {
    await page.locator("aside").getByRole("button", { name: "Spending", exact: true }).click();
  }
  await expect(page.getByRole("region", { name: "Spending by period" })).toBeVisible();
}

for (const [w, h] of VIEWPORTS) {
  const mobile = w < 800;
  test.describe(`Spending ${w}px`, () => {
    test.use({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });

    test("no overflow, sticky header clear, amounts unwrapped", async ({ page }) => {
      await loadSpending(page, mobile);

      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        const body = document.body;
        const shell = document.querySelector("main") ?? body;
        return {
          doc: de.scrollWidth - de.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          main: shell.scrollWidth - shell.clientWidth,
        };
      });
      expect(overflow.doc, "document horizontal overflow").toBeLessThanOrEqual(1);
      expect(overflow.body, "body horizontal overflow").toBeLessThanOrEqual(1);
      expect(overflow.main, "main horizontal overflow").toBeLessThanOrEqual(1);

      const strip = page.getByTestId("spending-period-strip");
      await expect(strip).toBeVisible();
      const sb = (await strip.boundingBox())!;
      expect(sb.x, "period strip left edge").toBeGreaterThanOrEqual(-1);
      expect(sb.x + sb.width, "period strip right edge").toBeLessThanOrEqual(w + 1);

      const inn = page.getByTestId("period-in");
      const out = page.getByTestId("period-out");
      await expect(inn).toBeVisible();
      await expect(out).toBeVisible();
      const ib = (await inn.boundingBox())!;
      const ob = (await out.boundingBox())!;
      expect(boxesOverlap(ib, ob), "In and Out values overlap").toBe(false);

      if (mobile) {
        const scroller = page.getByTestId("spending-txn-scroll");
        await expect(scroller).toBeVisible();
        const headers = page.locator("[data-day-header]");
        await expect(headers.first()).toBeVisible();
        // Scroll far enough that a later day header sticks to the top of the list.
        await scroller.evaluate(el => { el.scrollTop = Math.min(220, el.scrollHeight); });
        await page.waitForTimeout(150);

        const stuck = await page.evaluate(() => {
          const scroller = document.querySelector("[data-testid='spending-txn-scroll']") as HTMLElement | null;
          if (!scroller) return { ok: false, reason: "no scroller" };
          const sr = scroller.getBoundingClientRect();
          const headers = [...document.querySelectorAll("[data-day-header]")] as HTMLElement[];
          const header = headers.find(h => {
            const r = h.getBoundingClientRect();
            return Math.abs(r.top - sr.top) <= 2 && r.bottom > sr.top;
          }) ?? headers.find(h => {
            const r = h.getBoundingClientRect();
            return r.top < sr.top + 8 && r.bottom > sr.top;
          });
          if (!header) return { ok: false, reason: "no stuck header", scrollTop: scroller.scrollTop, headerCount: headers.length };
          const hr = header.getBoundingClientRect();
          // Empty band: a stuck header should sit at the scroller's top, not
          // be offset downward (the old toolbarH bug).
          const gap = hr.top - sr.top;
          const rows = [...document.querySelectorAll("[data-txn-row]")] as HTMLElement[];
          const overlapping = rows.filter(row => {
            const rr = row.getBoundingClientRect();
            if (rr.bottom <= sr.top || rr.top >= sr.bottom) return false;
            return !(hr.right <= rr.left || rr.right <= hr.left || hr.bottom <= rr.top + 0.5 || rr.bottom <= hr.top + 0.5);
          }).map(row => (row.getAttribute("aria-label") ?? row.textContent ?? "").slice(0, 80));
          return { ok: overlapping.length === 0 && gap <= 2, gap, overlapping, headerTop: hr.top, scrollerTop: sr.top };
        });
        expect(stuck.ok, `sticky header overlap or offset: ${JSON.stringify(stuck)}`).toBe(true);

        const wrapped = await page.locator("[data-txn-amount]").evaluateAll(els =>
          els.filter(e => {
            const lh = parseFloat(getComputedStyle(e).lineHeight) || 20;
            return e.clientHeight > lh * 1.6 + 1;
          }).map(e => e.textContent)
        );
        expect(wrapped, "transaction amount wrapped to two lines").toEqual([]);
      }

      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/after-${w}.png` });
      }
    });
  });
}
