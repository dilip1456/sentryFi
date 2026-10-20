import { test, expect, VIEWS, openDemo, goTo, expectNoSpinner, expectNoBadText, homeSpent, spendingTotal } from "./fixtures";

test.describe("demo smoke", () => {
  for (const view of VIEWS) {
    test(`${view}: renders, no console errors, no stuck spinner, no null/undefined/NaN`, async ({ page, guard }) => {
      await openDemo(page);
      if (view !== "Home") await goTo(page, view);
      await expect(page.locator("main")).not.toBeEmpty();
      await expectNoSpinner(page);
      await expectNoBadText(page);
      expect(guard.consoleErrors, "console errors").toEqual([]);
    });
  }

  test("walking every view in one session stays clean", async ({ page, guard }) => {
    await openDemo(page);
    for (const view of [...VIEWS, "Home" as const]) {
      await goTo(page, view);
      await expectNoSpinner(page);
      await expectNoBadText(page);
    }
    expect(guard.consoleErrors, "console errors").toEqual([]);
  });

  test("demo mode never calls the backend", async ({ page, guard }) => {
    await openDemo(page);
    for (const view of VIEWS) { await goTo(page, view); await expectNoSpinner(page); }
    expect(guard.backendCalls).toEqual([]);
  });

  test("Home 'Spent this month' equals Spending 'Total spent'", async ({ page }) => {
    await openDemo(page);
    const home = await homeSpent(page);
    expect(home).toBeGreaterThan(0);
    await goTo(page, "Spending");
    expect(await spendingTotal(page)).toBe(home);
  });

  test("Home cash-flow strip is internally consistent (net = income − spend, savings rate)", async ({ page }) => {
    await openDemo(page);
    const spent = await homeSpent(page);
    const income = Number((await page.getByText("Income this month", { exact: true }).locator("xpath=following-sibling::div[1]").innerText()).replace(/[^0-9.]/g, ""));
    const netText = await page.getByText("Net cash flow", { exact: true }).locator("xpath=following-sibling::div[1]").innerText();
    const net = (netText.trim().startsWith("−") ? -1 : 1) * Number(netText.replace(/[^0-9.]/g, ""));
    expect(net).toBeCloseTo(income - spent, 2);
    const rate = await page.getByText("Savings rate", { exact: true }).locator("xpath=following-sibling::div[1]").innerText();
    expect(rate.trim()).toBe(`${Math.round(((income - spent) / income) * 100)}%`);
  });

  test("Home net worth = assets − liabilities from the Accounts groups", async ({ page }) => {
    await openDemo(page);
    // demo accounts: 292,461.05 assets − 13,160.62 liabilities
    await expect(page.getByText("$279,300.43")).toBeVisible();
  });

  // KNOWN BUG: Budget's detected-income card says "<deposits> of last 12
  // months" — it counts deposits, not months, so a biweekly paycheck reads
  // e.g. "22 of last 12 months".
  test("Budget detected items never claim more than 12 of the last 12 months", async ({ page }) => {
    test.fail(true, "KNOWN BUG: BudgetPage counts deposits, not months, in 'N of last 12 months'");
    await openDemo(page);
    await goTo(page, "Budget");
    const text = await page.locator("main").innerText();
    const counts = [...text.matchAll(/(\d+) of last 12 months/g)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThanOrEqual(12);
  });
});

test.describe("timezone: Asia/Kolkata (UTC+5:30)", () => {
  test.use({ timezoneId: "Asia/Kolkata" });
  // KNOWN BUG: SpendingBudgetView's month buckets use toISOString() on local
  // midnight, so east of UTC "this month" starts on the last day of the
  // previous month; with the pinned clock the demo's Sep 30 Exxon charge
  // ($56.20) lands in Spending's October but not Home's.
  test("Home 'Spent this month' equals Spending 'Total spent' east of UTC", async ({ page }) => {
    test.fail(true, "KNOWN BUG: month buckets shifted by toISOString() east of UTC");
    await openDemo(page);
    const home = await homeSpent(page);
    await goTo(page, "Spending");
    expect(await spendingTotal(page)).toBe(home);
  });
});
