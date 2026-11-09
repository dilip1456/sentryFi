import type { Page } from "@playwright/test";
import { test, expect, openDemo } from "./fixtures";

/**
 * Timeline cash-flow rundown (demo data, no backend). Screenshots go to
 * RUNDOWN_SHOTS (default: test-results/rundown) for design review.
 */
const SHOTS = process.env.RUNDOWN_SHOTS ?? "test-results/rundown";
const panel = (p: Page) => p.getByTestId("tl-panel");
const rd = (p: Page) => p.getByTestId("rundown");

async function openTimeline(p: Page, mobile: boolean) {
  if (mobile) await p.locator("header").getByRole("button", { name: "Timeline" }).click();
  else await p.locator("aside").getByRole("button", { name: "Timeline" }).click();
  await expect(panel(p)).toBeVisible();
  await expect(rd(p).getByTestId("rd-low")).toBeVisible();
  await p.waitForTimeout(400);
}

for (const w of [360, 390, 430, 1440]) {
  const mobile = w < 768;
  test.describe(`rundown @${w}`, () => {
    test.use({ viewport: { width: w, height: mobile ? 844 : 900 } });

    test("default view, flags, groups, detail, settings, 7/14", async ({ page, guard }) => {
      await openDemo(page);
      await openTimeline(page, mobile);
      await expect(page.getByTestId("tl-tab-rundown")).toHaveAttribute("aria-selected", "true");
      // demo: start $2,260 across checking; shortfall flagged
      await expect(rd(page).locator(".rd-pill")).toHaveText("Shortfall");
      await expect(rd(page).getByTestId("rd-flags").getByRole("button")).not.toHaveCount(0);
      await expect(rd(page).getByText("Planned recurring items only. Everyday spending isn't included.")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-summary.png` });

      // no horizontal overflow
      const over = await panel(page).evaluate(el => el.scrollWidth - el.clientWidth);
      expect(over).toBeLessThanOrEqual(1);

      // tap targets ≥44px on phones
      if (mobile) {
        for (const t of ["tl-tab-rundown", "tl-tab-history", "rd-settings"]) {
          const b = (await page.getByTestId(t).boundingBox())!;
          expect(b.height).toBeGreaterThanOrEqual(44);
        }
      }

      // flag jumps to the item
      await rd(page).getByTestId("rd-flags").getByRole("button").first().click();
      await page.waitForTimeout(700);
      await expect(rd(page).locator(".rd-hl")).toHaveCount(1);
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-jump.png` });

      // small items group
      const group = rd(page).locator(".rd-group").first();
      await group.scrollIntoViewIfNeeded();
      await group.click();
      if (mobile) {
        const sheet = page.getByTestId("rd-group-sheet");
        await expect(sheet).toBeVisible(); await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/rundown-${w}-group.png` });
        await page.goBack(); // Back closes the sheet only
        await expect(sheet).toBeHidden();
        await expect(panel(page)).toBeVisible();
      } else {
        await expect(rd(page).locator(".rd-grpl")).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/rundown-${w}-group.png` });
      }

      // detail + edit preview
      const row = rd(page).locator(".rd-ev.risk").first();
      await row.scrollIntoViewIfNeeded(); await row.click();
      const det = page.getByTestId("rd-detail");
      await expect(det).toBeVisible(); await page.waitForTimeout(400);
      await expect(det.getByText("At risk.")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-detail.png` });
      await det.getByRole("button", { name: "Edit date or amount" }).click();
      await expect(det.getByText(/Lowest balance becomes/)).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-edit.png` });
      await page.keyboard.press("Escape"); // closes the layer, not the panel
      await expect(det).toBeHidden();
      await expect(panel(page)).toBeVisible();

      // mark received (demo: in memory); income is never grouped, so the row stays put
      const inc = rd(page).locator(".rd-ev").filter({ has: page.locator(".a.text-positive") }).filter({ has: page.locator(".st", { hasText: /^Expected$/ }) }).first();
      const id = (await inc.getAttribute("data-rd-row"))!;
      await inc.scrollIntoViewIfNeeded(); await inc.click();
      await page.getByTestId("rd-detail").getByRole("button", { name: "Mark received" }).click();
      await expect(page.getByTestId("rd-detail")).toBeHidden();
      await expect(rd(page).locator(`[data-rd-row="${id}"]`)).toContainText("Received");

      // settings: buffer + account toggles
      await page.getByTestId("rd-settings").click();
      const st = page.getByTestId("rd-settings-dlg");
      await expect(st).toBeVisible(); await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-settings.png` });
      await st.getByTestId("rd-buffer").fill("100");
      await st.getByRole("button", { name: "Save" }).click();
      await expect(st).toBeHidden();
      await expect(rd(page).locator(".rd-chart")).toContainText("Buffer $100");

      // 7 days
      await rd(page).getByRole("button", { name: "7 days" }).click();
      await expect(rd(page).getByText("End of the 7-day rundown")).toBeVisible();
      await rd(page).getByText("End of the 7-day rundown").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-7days-end.png` });

      // History tab still works
      await page.getByTestId("tl-tab-history").click();
      await expect(page.getByTestId("tl-body")).toBeVisible();
      await expect(panel(page).locator("[data-tl-ev]").first()).toBeAttached();

      expect(guard.backendCalls).toEqual([]);
      expect(guard.consoleErrors).toEqual([]);
    });

    test("full-page scroll capture", async ({ page }) => {
      await openDemo(page);
      await openTimeline(page, mobile);
      const body = rd(page).locator(".rd-body");
      const h = await body.evaluate(el => el.scrollHeight);
      await body.evaluate(el => { el.style.maxHeight = "none"; el.style.overflow = "visible"; });
      await page.setViewportSize({ width: w, height: Math.min(h + 260, 4000) });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/rundown-${w}-full.png` });
    });
  });
}
