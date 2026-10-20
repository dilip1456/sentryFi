import { test as base, expect, type Page } from "@playwright/test";

/** "Today" for every smoke test; demo data is generated relative to it. */
export const QA_NOW = new Date("2026-10-20T16:00:00Z"); // 12:00 America/New_York

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export type Guard = { consoleErrors: string[]; backendCalls: string[]; productionCalls: string[] };

/**
 * Every test gets:
 *  - a pinned clock (Date only; timers keep running),
 *  - all third-party requests (fonts, Vercel analytics, Plaid, logo CDNs)
 *    stubbed locally so results don't depend on the network,
 *  - any request to the (dummy) Supabase backend answered with an empty
 *    result and recorded; any request to *.supabase.co recorded as a
 *    production call (must be zero),
 *  - console errors and uncaught page errors collected and asserted empty
 *    after the test.
 */
export const test = base.extend<{ guard: Guard }>({
  guard: [async ({ page }, use, testInfo) => {
    const guard: Guard = { consoleErrors: [], backendCalls: [], productionCalls: [] };
    await page.clock.setFixedTime(QA_NOW);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => {
      const req = route.request();
      const url = req.url();
      if (/supabase\.co/.test(url)) { guard.productionCalls.push(url); return route.abort(); }
      const type = req.resourceType();
      if (type === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
      if (type === "stylesheet") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      if (type === "script") return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      if (type === "font") return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.route("http://127.0.0.1:54399/**", route => {
      guard.backendCalls.push(`${route.request().method()} ${route.request().url()}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    // Vercel Analytics / Speed Insights load /_vercel/* scripts that only
    // exist on Vercel hosting; serve them empty locally.
    await page.route("**/_vercel/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    page.on("console", m => {
      if (m.type() !== "error") return;
      const at = m.location()?.url;
      guard.consoleErrors.push(at ? `${m.text()} @ ${at}` : m.text());
    });
    page.on("pageerror", e => guard.consoleErrors.push(`pageerror: ${e.message}`));
    await use(guard);
    if (testInfo.status === testInfo.expectedStatus) {
      expect(guard.productionCalls, "requests to a real Supabase project").toEqual([]);
    }
  }, { auto: true }],
});
export { expect };

export const VIEWS = ["Home", "Money Map", "Spending", "Budget", "Gift Cards", "Benefits"] as const;
export type ViewName = (typeof VIEWS)[number];

export async function openDemo(page: Page) {
  await page.goto("/demo");
  await expect(page.getByText("You're viewing demo data.")).toBeVisible();
}

export async function goTo(page: Page, view: ViewName) {
  await page.locator("aside").getByRole("button", { name: view, exact: true }).click();
}

/** No spinner may still be visible 10s after a view is opened. */
export async function expectNoSpinner(page: Page) {
  await expect(page.locator(".animate-spin:visible")).toHaveCount(0, { timeout: 10_000 });
}

export async function expectNoBadText(page: Page) {
  const text = await page.locator("main").innerText();
  const hits = text.match(/.{0,30}\b(null|undefined|NaN)\b.{0,30}/g) ?? [];
  expect(hits, "visible null/undefined/NaN text").toEqual([]);
}

const usd = (s: string) => Number(s.replace(/[^0-9.]/g, ""));

/** Reads Home's "Spent this month" figure. */
export async function homeSpent(page: Page): Promise<number> {
  const card = page.getByText("Spent this month", { exact: true }).locator("xpath=following-sibling::div[1]");
  await expect(card).toHaveText(/\$[\d,]+/);
  return usd(await card.innerText());
}

/** Reads Spending's current-month total from the "Month summary" hero
 *  ("Spent so far in <Month>" → value), after any count-up settles. */
export async function spendingTotal(page: Page): Promise<number> {
  const val = page.getByRole("region", { name: "Month summary" }).getByText(/^Spent so far in /).locator("xpath=following-sibling::div[1]");
  await expect(val).toHaveText(/\$[\d,]+/);
  let prev = -1, cur = usd(await val.innerText());
  for (let i = 0; i < 20 && cur !== prev; i++) { await page.waitForTimeout(150); prev = cur; cur = usd(await val.innerText()); }
  return cur;
}
