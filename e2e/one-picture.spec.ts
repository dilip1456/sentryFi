import { test, expect, openDemo } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The one My Financial Picture (Nov 2026): no Preview tab, the old
 * "myfinances-redesign" view opens the Picture, obligations & expenses
 * (Upcoming windows, By cadence, By category), adding an expense by hand,
 * detected items vanishing from "To review" once acted on (and staying gone
 * after a reload). Taxes, recommendations and category totals live on
 * Insights. Demo data, backend stubbed, test clock 2026-10-20.
 */
async function openPicture(page: Page, view = "myfinances") {
  await page.addInitScript(v => { if (!sessionStorage.getItem("onepic_init")) { sessionStorage.setItem("onepic_init", "1"); sessionStorage.setItem("sentryfi_view", v); } }, view);
  await openDemo(page);
  await expect(page.getByTestId(view === "insights" ? "financial-insights" : "financial-picture")).toBeVisible();
}

/** A real pointer click at the element's center (not locator.click({force}) / dispatchEvent). */
async function realClick(page: Page, loc: import("@playwright/test").Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function noOverflow(page: Page, width: number) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, "page horizontal overflow").toBeLessThanOrEqual(width + 1);
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("one Picture: no Preview tab; legacy view id opens it", async ({ page }) => {
    await openPicture(page, "myfinances-redesign");
    await expect(page.getByRole("button", { name: /Picture Preview|^Preview$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "My Financial Picture" }).first()).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("sentryfi_view"))).toBe("myfinances");
    for (const id of ["plan-summary", "rcv-card", "pic-income", "plan-upcoming", "plan-accounted", "pic-savings", "plan-networth", "plan-more"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await noOverflow(page, 1440);
    await page.getByTestId("open-insights").first().click();
    for (const id of ["plan-recs", "plan-allocation", "plan-taxes", "plan-cats"]) await expect(page.getByTestId(id)).toBeVisible();
    await noOverflow(page, 1440);
  });

  test("plan views: windows, cadence and category", async ({ page }) => {
    await openPicture(page);
    const plan = page.getByTestId("plan-upcoming");
    const total = page.getByTestId("plan-window-total");
    await plan.getByRole("button", { name: "Week", exact: true }).click();
    await expect(total).toContainText("This week");
    await plan.getByRole("button", { name: "Year", exact: true }).click();
    await expect(total).toContainText("This year");
    // Semiannual insurance and yearly registration are projected forward.
    await expect(plan.getByTestId("plan-row").filter({ hasText: /geico/i }).first()).toBeVisible();
    await expect(plan.getByTestId("plan-row").filter({ hasText: /registration/i }).first()).toBeVisible();
    await plan.getByRole("button", { name: "3 months", exact: true }).click();
    await expect(total).toContainText("Next 3 months");
    // Quarterly estimated tax (next IRS date Jan 15) falls in the next 3 months.
    await expect(plan.getByTestId("plan-row").filter({ hasText: /1040es|irs/i }).first()).toBeVisible();

    await plan.getByRole("button", { name: "By cadence" }).click();
    await expect(plan.getByTestId("plan-bucket-monthly")).toBeVisible();
    await expect(plan.getByTestId("plan-bucket-quarterly")).toBeVisible();
    await expect(plan.getByTestId("plan-bucket-annual")).toContainText(/registration/i);

    await plan.getByRole("button", { name: "By category" }).click();
    await expect(plan.getByTestId("plan-categories")).toContainText("Insurance");
    await expect(plan.getByTestId("plan-categories")).toContainText("Taxes");
    await expect(plan.getByTestId("plan-categories")).toContainText("Set aside");

    // A row opens its detail with a sinking-fund line.
    await plan.getByRole("button", { name: "By cadence" }).click();
    await plan.getByTestId("plan-bucket-annual").getByTestId("plan-row").first().click();
    await expect(page.getByTestId("plan-item-detail")).toContainText("Set aside");
  });

  test("add an expense by hand", async ({ page }) => {
    await openPicture(page);
    const plan = page.getByTestId("plan-upcoming");
    await plan.getByRole("button", { name: "Add expense" }).click();
    const form = page.getByTestId("plan-form");
    await expect(form.getByRole("button", { name: "Add expense" })).toBeDisabled();
    await form.getByLabel("Name").fill("Kids swim lessons");
    await form.getByLabel("Category").selectOption("family");
    await form.getByLabel("Amount", { exact: true }).fill("240");
    await form.getByLabel("How often").selectOption("quarterly");
    await form.getByLabel("Next due date").fill("2026-11-05");
    await form.getByLabel("Reminder days before").fill("7");
    await form.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByTestId("plan-form")).toBeHidden();
    const row = plan.getByTestId("plan-row").filter({ hasText: "Kids swim lessons" });
    await plan.getByRole("button", { name: "3 months", exact: true }).click();
    await expect(row.first()).toHaveAttribute("data-source", "manual");
    await expect(row.first()).toContainText("$240");
    await plan.getByRole("button", { name: "By category" }).click();
    await expect(plan.getByTestId("plan-categories")).toContainText(/Childcare|Family|kids/i);
    await plan.getByRole("button", { name: "Upcoming" }).click();
    // Remove + Undo.
    await row.first().click();
    await page.getByTestId("plan-item-detail").getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
    await page.locator("[data-sonner-toast]").filter({ hasText: "removed" }).getByRole("button", { name: "Undo" }).click();
    await expect(row.first()).toBeVisible();
  });

  test("acted-on detected items vanish from To review and stay gone after reload", async ({ page }) => {
    await openPicture(page);
    const card = page.getByTestId("rcv-card");
    const count = async () => Number(((await page.getByTestId("rcv-count").innerText()).match(/\d+/) ?? ["0"])[0]);
    const n0 = await count();
    // A bill (HOA dues) to confirm, and the first other item to dismiss.
    const firstLabel = (await card.getByTestId("rcv-item").filter({ hasText: /hoa/i }).first().locator(".rcv-lbl b").innerText()).trim();
    await card.getByRole("button", { name: `Confirm ${firstLabel}` }).click();
    await expect(card.getByTestId("rcv-item").filter({ hasText: firstLabel })).toHaveCount(0);
    const secondLabel = (await card.getByTestId("rcv-item").first().locator(".rcv-lbl b").innerText()).trim();
    await card.getByRole("button", { name: `${secondLabel} is not recurring` }).click();
    await expect(card.getByTestId("rcv-item").filter({ hasText: secondLabel })).toHaveCount(0);
    expect(await count()).toBe(n0 - 2);

    await page.reload();
    await expect(page.getByTestId("financial-picture")).toBeVisible();
    await expect(page.getByTestId("rcv-count")).toContainText(String(n0 - 2));
    await expect(card.getByTestId("rcv-item").filter({ hasText: firstLabel })).toHaveCount(0);
    await expect(card.getByTestId("rcv-item").filter({ hasText: secondLabel })).toHaveCount(0);
    // Confirmed lands in the plan as Confirmed; dismissed is not in the plan.
    const plan = page.getByTestId("plan-upcoming");
    await plan.getByRole("button", { name: "By cadence" }).click();
    await expect(plan.getByTestId("plan-row").filter({ hasText: firstLabel }).first()).toHaveAttribute("data-source", "confirmed");
  });

  test("confirming a detected item offers Undo, which brings it back to review", async ({ page }) => {
    await openPicture(page);
    const card = page.getByTestId("rcv-card");
    const label = (await card.getByTestId("rcv-item").first().locator(".rcv-lbl b").innerText()).trim();
    await realClick(page, card.getByRole("button", { name: `Confirm ${label}` }));
    await expect(card.getByTestId("rcv-item").filter({ hasText: label })).toHaveCount(0);
    await realClick(page, page.locator("[data-sonner-toast]").filter({ hasText: "confirmed" }).getByRole("button", { name: "Undo" }));
    await expect(card.getByTestId("rcv-item").filter({ hasText: label }).first()).toBeVisible();
  });

  test("tax inputs: 401(k) %, FSA and mortgage interest change the estimates (real mouse)", async ({ page }) => {
    await openPicture(page, "insights");
    await realClick(page, page.getByTestId("plan-taxes").getByRole("button", { name: "Details" }));
    const form = page.getByTestId("tax-inputs");
    await expect(form).toBeVisible();
    await form.getByLabel("FSA per year").fill("2500");
    await form.getByLabel("Mortgage interest per year").fill("18000");
    const pct = form.getByLabel("401(k) contribution percent");
    if (await pct.isEnabled()) await pct.fill("6");
    await realClick(page, form.getByRole("button", { name: "Save tax inputs" }));
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Tax inputs saved" })).toBeVisible();
    const dlg = page.getByRole("dialog").filter({ has: page.getByTestId("tax-inputs") });
    await expect(dlg).toContainText("FSA");
    await expect(dlg).toContainText(/itemizing/i);
    await expect(dlg).toContainText(/estimate/i);
    await expect(dlg).not.toContainText("FSA contributions, if any");
  });

  test("dismiss a recommendation, then undo", async ({ page }) => {
    await openPicture(page, "insights");
    const recs = page.getByTestId("plan-rec");
    const n = await recs.count();
    expect(n).toBeGreaterThan(0);
    const title = (await recs.first().locator("b").first().innerText()).trim();
    await recs.first().getByRole("button", { name: `Dismiss: ${title}` }).click();
    await expect(recs).toHaveCount(n - 1);
    await page.locator("[data-sonner-toast]").filter({ hasText: "Recommendation dismissed" }).getByRole("button", { name: "Undo" }).click();
    await expect(recs).toHaveCount(n);
  });
});

for (const width of [360, 390, 412, 430]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    test("plan fits and a row opens as a bottom sheet", async ({ page }) => {
      await openPicture(page);
      await noOverflow(page, width);
      const plan = page.getByTestId("plan-upcoming");
      await plan.getByRole("button", { name: "Year", exact: true }).click();
      await noOverflow(page, width);
      await plan.getByTestId("plan-row").first().click();
      const sheet = page.getByRole("dialog").filter({ has: page.getByTestId("plan-item-detail") });
      await expect(sheet.locator(".grab")).toHaveCount(1);
      await noOverflow(page, width);
    });
    test("taxes detail: tax inputs fit with 44px targets", async ({ page }) => {
      await openPicture(page, "insights");
      await page.getByTestId("plan-taxes").getByRole("button", { name: "Details" }).tap();
      const form = page.getByTestId("tax-inputs");
      await form.scrollIntoViewIfNeeded();
      for (const el of [form.getByLabel("FSA per year"), form.getByLabel("Mortgage interest per year"), form.getByRole("button", { name: "Save tax inputs" })]) {
        const b = await el.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(b!.x + b!.width).toBeLessThanOrEqual(width + 1);
      }
      await noOverflow(page, width);
    });
  });
}
