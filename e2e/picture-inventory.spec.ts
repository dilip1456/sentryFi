import { test, expect, openDemo } from "./fixtures";
import { signIn } from "./signed-in";

/**
 * My Financial Picture is a full inventory (income, obligations, savings,
 * accounts); summaries, tax estimates and recommendations live on Insights.
 * The signed-in tests run the live path against canned backend rows
 * (e2e/signed-in.ts), which the /demo tests can't reach.
 */

const watchFirstPaint = () => {
  const seen: Record<string, boolean> = {};
  const check = () => {
    const mark = (k: string, hit: unknown) => { if (hit) seen[k] = true; };
    mark("spendingSkeleton", document.querySelector('[aria-label="Loading spending"]'));
    mark("settingsSpinner", document.body?.innerText.includes("Loading your settings"));
    // The previous Picture (the plan + "Your Data" monthly breakdown on one page).
    mark("oldPicture", document.querySelector('[data-testid="financial-picture"] [aria-labelledby="yd-h"]') || /Monthly plan & insights|Everything you pay or plan for/.test(document.body?.innerText ?? ""));
    mark("insightsOnPicture", document.querySelector('[data-testid="financial-picture"] [data-testid="plan-taxes"], [data-testid="financial-picture"] [data-testid="plan-recs"]'));
    mark("pictureSkeleton", document.querySelector('[data-testid="picture-skeleton"]'));
    mark("picture", document.querySelector('[data-testid="picture-page"]'));
    mark("mortgageInReview", /Rocket/i.test(document.querySelector('[data-testid="rcv-card"]')?.textContent ?? ""));
    mark("skeletonAfterPicture", seen.picture && document.querySelector('[data-testid="picture-skeleton"]'));
    (window as unknown as { __paint: typeof seen }).__paint = seen;
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", check);
};
const paint = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __paint: Record<string, boolean> }).__paint ?? {});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
    await page.addInitScript(watchFirstPaint);
  });

  test("first paint is the Picture skeleton; the old screens never mount", async ({ page }) => {
    await signIn(page, { decisionsDelay: 1500 });
    await page.goto("/");
    await expect(page.getByTestId("picture-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("inv-income").first()).toBeVisible();
    const seen = await paint(page);
    expect(seen.pictureSkeleton, "Picture-shaped skeleton while loading").toBe(true);
    expect(seen.spendingSkeleton, "Spending skeleton on the Picture").toBeFalsy();
    expect(seen.settingsSpinner, "'Loading your settings…' spinner").toBeFalsy();
    expect(seen.oldPicture, "the previous Picture layout").toBeFalsy();
    expect(seen.insightsOnPicture, "tax / recommendation cards on the Picture").toBeFalsy();
    // The confirmed mortgage must never flash in To review before saved decisions arrive.
    expect(seen.mortgageInReview, "confirmed item shown in To review").toBeFalsy();
  });

  test("loan paid on the loan account counts as paid; salary comes from paychecks", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByTestId("picture-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sum-accounted")).toContainText("3 of 3");
    await expect(page.getByTestId("plan-accounted")).not.toContainText(/Rocket[^]*not seen|missing/i);
    await expect(page.getByTestId("sum-income")).toContainText("$74,400");
    await expect(page.getByTestId("inv-income").first()).toContainText("$6,200");
    // Paychecks feed income; they are never offered as bills to review.
    await expect(page.getByTestId("rcv-card")).not.toContainText(/Globex|payroll/i);
  });

  test("refresh keeps the Picture on screen", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByTestId("picture-page")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(800);
    expect((await paint(page)).skeletonAfterPicture, "skeleton after the Picture painted").toBeFalsy();
    await expect(page.getByTestId("picture-page")).toBeVisible();
  });

  test("no To review section when nothing needs review", async ({ page }) => {
    const fx = (await import("./signed-in")).liveFixture();
    const confirm = (key: string, kind: string, name: string) => ({
      user_id: "x", series_key: `picture:${key}`, source: "picture", merchant_key: name, display_name: name, direction: "outflow",
      kind, cadence: "monthly", status: "confirmed", matched_transaction_ids: fx.txns.filter(t => String(t.name).includes(name.toUpperCase())).map(t => t.id),
    });
    await signIn(page, { decisions: [...fx.decisions, confirm("outflow|xfinity", "bill", "Xfinity"), confirm("outflow|netflix", "subscription", "Netflix"), confirm("outflow|state farm", "bill", "State Farm")] });
    await page.goto("/");
    await expect(page.getByTestId("picture-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("inv-income").first()).toBeVisible();
    await expect(page.getByTestId("rcv-card")).toHaveCount(0);
    await expect(page.getByText(/all caught up/i)).toHaveCount(0);
  });
});

test.describe("demo", () => {
  test("Picture lists income, obligations, savings and accounts with yearly totals", async ({ page }) => {
    await openDemo(page);
    await page.locator("aside").getByRole("button", { name: "My Financial Picture", exact: true }).click();
    const pic = page.getByTestId("picture-page");
    await expect(pic).toBeVisible();
    for (const id of ["sum-obligations", "sum-setaside", "sum-next30", "sum-accounted", "sum-income", "sum-savings"]) await expect(page.getByTestId(id)).toBeVisible();
    for (const id of ["pic-income", "plan-upcoming", "pic-savings", "plan-networth"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("plan-row").first()).toContainText("/yr");
    await expect(page.getByTestId("inv-saving").first()).toContainText("/yr");
    // Insights-only content stays off the Picture.
    for (const id of ["plan-recs", "plan-allocation", "plan-taxes"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(pic).not.toContainText(/\bplan\b/i);
  });

  test("Insights holds recommendations, allocation and taxes; reachable from the Picture", async ({ page }) => {
    await openDemo(page);
    await page.locator("aside").getByRole("button", { name: "My Financial Picture", exact: true }).click();
    await page.getByTestId("open-insights").first().click();
    await expect(page.getByTestId("insights-page")).toBeVisible();
    for (const id of ["plan-recs", "plan-allocation", "plan-taxes"]) await expect(page.getByTestId(id)).toBeVisible();
    await page.getByRole("button", { name: /Back to Picture/i }).click();
    await expect(page.getByTestId("picture-page")).toBeVisible();
    await page.locator("aside").getByRole("button", { name: "Insights", exact: true }).click();
    await expect(page.getByTestId("insights-page")).toBeVisible();
  });

  test("manual income can be added, edited and removed", async ({ page }) => {
    await openDemo(page);
    await page.locator("aside").getByRole("button", { name: "My Financial Picture", exact: true }).click();
    await page.getByRole("button", { name: "Add income" }).click();
    const form = page.getByTestId("income-form");
    await form.getByLabel("Income name").fill("Rental income");
    await form.getByLabel("Take-home per month").fill("1200");
    await form.getByRole("button", { name: "Add income" }).click();
    const row = page.getByTestId("inv-income").filter({ hasText: "Rental income" });
    await expect(row).toContainText("$1,200");
    await expect(row).toContainText("$14,400/yr");
    await row.click();
    await page.getByTestId("income-form").getByLabel("Take-home per month").fill("1000");
    await page.getByTestId("income-form").getByRole("button", { name: /save/i }).click();
    await expect(row).toContainText("$1,000");
    await row.click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("inv-income").filter({ hasText: "Rental income" })).toHaveCount(0);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Insights sits in More; the bottom bar is unchanged", async ({ page }) => {
    await openDemo(page);
    const bar = page.locator("nav.md\\:hidden");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveText([/Home/, /Gift Cards/, /Spending/, /Picture/, /More/]);
    await bar.getByRole("button", { name: "More", exact: true }).click();
    await page.getByText("Insights", { exact: true }).last().click();
    await expect(page.getByTestId("insights-page")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
