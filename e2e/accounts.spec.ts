import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures";
import { signIn, QA_USER } from "./signed-in";

/**
 * Accounts redesign (review/accounts-redesign/RATIONALE.md §5) on the
 * signed-in live path: canned banks, cards with limits and due dates, a
 * manual loan, and (optionally) a bank that needs sign-in. Screenshots go to
 * ../sentryfi-review/accounts when ACCOUNTS_SHOTS is set.
 */
type Row = Record<string, unknown>;
const SHOTS = process.env.ACCOUNTS_SHOTS;
const u = (r: Row) => ({ user_id: QA_USER.id, iso_currency_code: "USD", available_balance: null, official_name: null, ...r });

const ITEMS = [
  { id: "pi-chase", item_id: "it-chase", institution_id: "ins_3", institution_name: "Chase", created_at: "2024-01-05T00:00:00Z" },
  { id: "pi-ally", item_id: "it-ally", institution_id: "ins_25", institution_name: "Ally Bank", created_at: "2024-02-05T00:00:00Z" },
  { id: "pi-amex", item_id: "it-amex", institution_id: "ins_10", institution_name: "American Express", created_at: "2024-03-05T00:00:00Z" },
  { id: "pi-fid", item_id: "it-fid", institution_id: "ins_12", institution_name: "Fidelity", created_at: "2024-04-05T00:00:00Z" },
  { id: "pi-toy", item_id: "it-toy", institution_id: "ins_99", institution_name: "Toyota Financial", created_at: "2024-05-05T00:00:00Z" },
];
const ACCOUNTS = [
  u({ id: "acc-chk", account_id: "chk", name: "TOTAL CHECKING", mask: "4410", type: "depository", subtype: "checking", current_balance: 8420.55, available_balance: 8420.55, item_id: "pi-chase" }),
  u({ id: "acc-csav", account_id: "csav", name: "Chase Savings", mask: "0087", type: "depository", subtype: "savings", current_balance: 0.41, item_id: "pi-chase" }),
  u({ id: "acc-sapph", account_id: "sapph", name: "Sapphire Reserve", mask: "9921", type: "credit", subtype: "credit card", current_balance: 2840.22, available_balance: 22159.78, credit_limit: 25000, item_id: "pi-chase" }),
  u({ id: "acc-ally", account_id: "ally", name: "Online Savings", mask: "7731", type: "depository", subtype: "savings", current_balance: 41300, item_id: "pi-ally" }),
  u({ id: "acc-ef", account_id: "ef", name: "Emergency fund", mask: "7748", type: "depository", subtype: "savings", current_balance: 20000, item_id: "pi-ally" }),
  u({ id: "acc-amex", account_id: "amex", name: "Blue Cash Preferred", mask: "1004", type: "credit", subtype: "credit card", current_balance: 1120.4, credit_limit: 3000, item_id: "pi-amex" }),
  u({ id: "acc-401k", account_id: "k401", name: "401(k) Plan", mask: "2201", type: "investment", subtype: "401k", current_balance: 168420.5, item_id: "pi-fid" }),
  u({ id: "acc-brk", account_id: "brk", name: "Individual Brokerage", mask: "2290", type: "investment", subtype: "brokerage", current_balance: 54320, item_id: "pi-fid" }),
  u({ id: "acc-auto", account_id: "auto", name: "Auto Loan", mask: "5512", type: "loan", subtype: "auto", current_balance: 9200, item_id: "pi-toy" }),
];
const CREDIT = [
  { user_id: QA_USER.id, account_id: "sapph", last_statement_balance: 2612.4, minimum_payment_amount: 40, next_payment_due_date: "2026-10-24", last_payment_amount: 2318.77, last_payment_date: "2026-09-24", is_overdue: false },
  { user_id: QA_USER.id, account_id: "amex", last_statement_balance: 1120.4, minimum_payment_amount: 35, next_payment_due_date: "2026-10-22", last_payment_amount: 980, last_payment_date: "2026-09-22", is_overdue: false },
];
const LOANS = [{ user_id: QA_USER.id, account_id: "auto", kind: "auto", next_payment_due_date: "2026-11-02", next_monthly_payment: 412, interest_rate: 5.9 }];
const MANUAL = [{ id: "man-1", user_id: QA_USER.id, name: "Student loan (Nelnet)", institution_name: "Nelnet", type: "student_loan", role: "debt", role_label: null, current_balance: 12400,
  original_loan_amount: null, interest_rate: 4.5, monthly_payment: 180, loan_start_date: null, loan_term_years: null, property_address: null, property_value: null, notes: null,
  created_at: "2025-01-01T00:00:00Z", updated_at: "2026-09-30T12:00:00Z" }];
const tx = (n: number, account_id: string, date: string, amount: number, name: string, category: string[] | null = null) =>
  ({ id: `ac-row-${n}`, transaction_id: `ac-plaid-${n}`, user_id: QA_USER.id, account_id, amount, date, name, merchant_name: null, category, pending: false, payment_channel: "other", pfc_primary: null, pfc_detailed: null });
const TXNS = [
  tx(1, "sapph", "2026-10-17", 86.42, "Whole Foods"),
  tx(2, "sapph", "2026-10-15", 128, "Con Edison"),
  tx(3, "sapph", "2026-09-24", -2318.77, "Payment, thank you"),
  tx(4, "chk", "2026-10-15", -3100, "PAYROLL"),
  tx(5, "ally", "2026-09-30", -142.18, "Interest", ["Interest", "Interest Earned"]),
  tx(6, "ally", "2026-08-31", -139.5, "Interest", ["Interest", "Interest Earned"]),
  tx(7, "ally", "2026-07-31", -138.2, "Interest", ["Interest", "Interest Earned"]),
  tx(8, "csav", "2026-03-02", 25, "TRANSFER"),
];

async function serveAccounts(page: Page, opts: { broken?: boolean; meta?: Record<string, unknown> } = {}) {
  const fx = await signIn(page, { settings: { account_meta: { "acc-chk": { nickname: "Everyday checking" }, ...opts.meta }, card_autopay_from: { sapph: "chk" } } });
  void fx;
  const health = ITEMS.map(i => ({ id: i.id, status: "active", updated_at: "2026-10-20T13:58:00Z", last_synced_at: "2026-10-20T14:00:00Z",
    error_code: opts.broken && i.id === "pi-fid" ? "ITEM_LOGIN_REQUIRED" : null, error_at: opts.broken && i.id === "pi-fid" ? "2026-10-15T09:00:00Z" : null,
    ...(opts.broken && i.id === "pi-fid" ? { last_synced_at: "2026-10-15T08:00:00Z" } : {}) }));
  await page.route(/127\.0\.0\.1:54399\/rest\/v1\/(plaid_items|plaid_accounts|plaid_credit_details|plaid_loan_details|manual_accounts|plaid_transactions)/, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split("/").pop();
    const cors = { "access-control-allow-origin": req.headers()["origin"] ?? "*", "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" });
    if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { ...cors, "content-range": "0-0/1" }, body: "" });
    if (req.method() !== "GET") return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "[]" });
    const select = url.searchParams.get("select") ?? "";
    let rows: unknown[] = [];
    if (table === "plaid_items") rows = select.includes("error_code") || select.includes("updated_at") ? health : ITEMS.map(i => ({ ...i, user_id: QA_USER.id }));
    if (table === "plaid_accounts") rows = ACCOUNTS;
    if (table === "plaid_credit_details") rows = CREDIT;
    if (table === "plaid_loan_details") rows = LOANS;
    if (table === "manual_accounts") rows = MANUAL;
    if (table === "plaid_transactions") rows = Number(url.searchParams.get("offset") ?? 0) ? [] : TXNS;
    return route.fulfill({ status: 200, headers: { ...cors, "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return;
  await page.waitForTimeout(700); // let sheets finish sliding in
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
/** Real full-length shot: the app scrolls inside its own container, so grow
 *  the viewport to the content height, shoot, and restore. */
const fullShot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  const vp = page.viewportSize()!;
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight,
    ...Array.from(document.querySelectorAll<HTMLElement>("*")).filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map(e => e.scrollHeight + e.getBoundingClientRect().top)));
  await page.setViewportSize({ width: vp.width, height: Math.ceil(h) + 80 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
};
/** No "N things" / "N accounts" counts anywhere on the Accounts page. */
const countTexts = (page: Page) => page.evaluate(() => {
  const t = (document.querySelector(".ac") as HTMLElement | null)?.innerText ?? "";
  return t.match(/\b\d+ (things?|accounts?|accts?|banks?|hidden)\b/gi) ?? [];
});
const click = async (page: Page, loc: import("@playwright/test").Locator) => {
  await loc.scrollIntoViewIfNeeded();
  // Sheets slide in; wait until the target stops moving before a real click.
  let box = (await loc.boundingBox())!;
  let stable = 0;
  for (let i = 0; i < 30 && stable < 2; i++) {
    await page.waitForTimeout(150);
    const next = (await loc.boundingBox())!;
    stable = Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5 ? stable + 1 : 0;
    box = next;
  }
  await loc.scrollIntoViewIfNeeded();
  box = (await loc.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("accounts-page")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ac-networth")).toContainText("$");
}
const overflowProblems = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  const w = window.innerWidth;
  if (document.documentElement.scrollWidth > w) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${w}`);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".ac *"))) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > w + 0.5 && getComputedStyle(el).position !== "fixed") out.push(`${el.tagName}.${el.className} right ${Math.round(r.right)}`);
  }
  return out.slice(0, 10);
});
const smallTaps = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".ac button, .ac a, .ac input, .ac [role=switch]"))
  .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; })
  .filter(el => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; })
  .map(el => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));

test.describe.configure({ timeout: 150_000 });

test.describe("Accounts, desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sidebar entry, net worth matches Home, rows, Coming due, details sheet, By bank", async ({ page }) => {
    await serveAccounts(page);
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "overall"));
    await page.goto("/");
    // Home's net worth first.
    await expect(page.locator("main")).toContainText("Net Worth", { ignoreCase: true, timeout: 60_000 });
    await click(page, page.locator("aside nav button", { hasText: "Accounts" }));
    await expect(page.getByTestId("accounts-page")).toBeVisible();
    // assets 8420.55+0.41+41300+20000+168420.5+54320 = 292461.46; debts 2840.22+1120.4+9200+12400 = 25560.62
    await expect(page.getByTestId("ac-networth")).toHaveText("$266,900.84");
    await expect(page.getByTestId("ac-hero")).toContainText("Checking");
    await expect(page.locator("[data-ac-group=credit]")).toContainText("14% of $28K limit used");
    await expect(page.locator("[data-account-row=acc-sapph]")).toContainText("Due Oct 24");
    await expect(page.locator("[data-account-row=acc-sapph]")).toContainText("11%");
    await expect(page.locator("[data-account-row=acc-chk]")).toContainText("Everyday checking");
    await expect(page.getByTestId("ac-coming-due").first()).toContainText("Blue Cash Preferred");
    await expect(page.getByTestId("ac-things")).toContainText("Worth a look");
    expect(await countTexts(page)).toEqual([]);
    await shot(page, "desktop-1440-overview");
    await fullShot(page, "desktop-1440-overview-full");

    await click(page, page.locator("[data-account-row=acc-sapph]"));
    const sheet = page.getByTestId("ac-detail-sheet");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(700);
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.width)).toBe(440);
    expect(Math.round(box.x + box.width)).toBe(1440);
    await expect(sheet).toContainText("You owe");
    await expect(sheet).toContainText("Autopay on");
    await expect(sheet).toContainText("Statement balance");
    await expect(page.locator("[data-ac-close]")).toBeFocused();
    await shot(page, "desktop-1440-details-card");
    // Esc closes it (retried: under heavy load a keypress can land mid-animation).
    await expect(async () => { await page.keyboard.press("Escape"); await expect(sheet).toBeHidden({ timeout: 2_000 }); }).toPass({ timeout: 15_000 });

    await click(page, page.getByRole("button", { name: "By bank" }));
    await expect(page.locator("[data-ac-group=pi-chase]")).toContainText("Chase");
    await shot(page, "desktop-1440-bybank");
  });

  test("bank needs sign-in: red strip, Reconnect sheet, Connections", async ({ page }) => {
    await serveAccounts(page, { broken: true });
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "accounts"));
    await open(page);
    await expect(page.getByTestId("ac-sync-alert")).toContainText("Fidelity stopped syncing");
    await expect(page.locator("[data-account-row=acc-401k]")).toContainText("Needs sign-in · as of Oct 15");
    await shot(page, "desktop-1440-relink");
    await click(page, page.getByRole("button", { name: "Why?" }));
    await expect(page.getByTestId("ac-reconnect-sheet")).toContainText("Your nicknames, hidden settings");
    await shot(page, "desktop-1440-relink-sheet");
  });
});

test.describe("Accounts, phone 412", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test("rows, bottom sheet closes (X, Back, Esc), rename or hide, hidden list", async ({ page }) => {
    await serveAccounts(page);
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "accounts"));
    await open(page);
    expect(await overflowProblems(page)).toEqual([]);
    expect(await smallTaps(page)).toEqual([]);
    const rows = page.locator("[data-account-row]");
    for (const h of await rows.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(60);
    expect(await countTexts(page)).toEqual([]);
    await expect(page.locator("[data-ac-group=credit]")).not.toContainText(/\d+ accounts?/);
    await shot(page, "mobile-412-overview");
    await fullShot(page, "mobile-412-overview-full");

    // Details: bottom sheet, X closes
    await click(page, page.locator("[data-account-row=acc-sapph]"));
    const sheet = page.getByTestId("ac-detail-sheet");
    await expect(sheet).toBeVisible();
    // Bottom sheet: anchored to the bottom edge once it has slid in.
    await expect.poll(async () => { const b = (await sheet.boundingBox())!; return Math.round(b.y + b.height); }, { timeout: 5_000 }).toBe(915);
    await shot(page, "mobile-412-details-card");
    await click(page, sheet.getByRole("button", { name: "Close" }));
    await expect(sheet).toBeHidden();

    // Android back closes it
    await click(page, page.locator("[data-account-row=acc-sapph]"));
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("accounts-page")).toBeVisible();

    // Esc closes it
    await click(page, page.locator("[data-account-row=acc-sapph]"));
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Rename or hide pushes inside; Back returns to details
    await click(page, page.locator("[data-account-row=acc-ef]"));
    await click(page, page.getByTestId("ac-rename-hide"));
    await expect(page.getByTestId("ac-edit")).toBeVisible();
    // "Still count it in net worth" only exists while Hide is on.
    await expect(page.getByTestId("ac-nw-toggle")).toHaveCount(0);
    await shot(page, "mobile-412-rename-hide");
    expect(await smallTaps(page)).toEqual([]);
    await page.goBack();
    await expect(page.getByTestId("ac-details")).toBeVisible();
    await click(page, page.getByTestId("ac-rename-hide"));
    await click(page, page.getByTestId("ac-hide-toggle"));
    await expect(page.getByTestId("ac-nw-toggle")).toBeEnabled();
    await shot(page, "mobile-412-rename-hide-on");
    // Disconnect sits 24px+ below Cancel / Save.
    { const save = (await page.getByTestId("ac-edit-save").boundingBox())!;
      const dis = (await page.getByRole("button", { name: /^Disconnect / }).boundingBox())!;
      expect(dis.y - (save.y + save.height)).toBeGreaterThanOrEqual(24); }
    await click(page, page.getByTestId("ac-edit-save"));
    await expect(sheet).toBeHidden();
    await expect(page.locator("[data-account-row=acc-ef]")).toHaveCount(0);
    await expect(page.getByTestId("ac-hidden-row")).toContainText("Hidden accounts");
    // Still counts in net worth by default
    await expect(page.getByTestId("ac-networth")).toHaveText("$266,900.84");
    // Opening the list clears the "Hidden …" toast, which would sit over its rows.
    await click(page, page.getByTestId("ac-hidden-row"));
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(page.getByTestId("ac-hidden-sheet")).toContainText("Emergency fund");
    await expect(page.getByTestId("ac-hidden-sheet")).toContainText("Ally Bank ··7748 · $20,000.00");
    await expect(page.getByTestId("ac-hidden-sheet")).toContainText("Still counted in net worth");
    { const show = (await page.getByTestId("ac-hidden-sheet").getByRole("button", { name: "Show" }).boundingBox())!;
      expect(show.height).toBeGreaterThanOrEqual(44); }
    await shot(page, "mobile-412-hidden");
    await click(page, page.getByTestId("ac-hidden-sheet").getByRole("button", { name: "Show" }));
    await expect(page.locator("[data-account-row=acc-ef]")).toHaveCount(1);
  });

  test("By bank, things to confirm, reconnect state", async ({ page }) => {
    await serveAccounts(page, { broken: true });
    await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "accounts"));
    await open(page);
    await expect(page.getByTestId("ac-sync-alert")).toBeVisible();
    await shot(page, "mobile-412-relink");
    // The Fidelity rows themselves: "Needs sign-in · as of Oct 15".
    await page.locator("[data-account-row=acc-401k]").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector("[data-ac-group=investment]")?.scrollIntoView({ block: "center" }));
    await expect(page.locator("[data-account-row=acc-401k]")).toContainText("Needs sign-in · as of Oct 15");
    await expect(page.locator("[data-account-row=acc-brk]")).toContainText("Needs sign-in · as of Oct 15");
    for (const k of ["acc-401k", "acc-brk"]) {
      const clipped = await page.locator(`[data-account-row=${k}] .st-bad`).evaluate(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > (e.closest(".ac-row")!.querySelector(".rt") as HTMLElement).getBoundingClientRect().left);
      expect(clipped, `${k} sign-in fact is clipped`).toBe(false);
    }
    await shot(page, "mobile-412-relink-rows");
    await click(page, page.getByRole("button", { name: "By bank" }));
    await expect(page.locator("[data-ac-group=pi-fid]")).toContainText("Reconnect");
    expect(await overflowProblems(page)).toEqual([]);
    await shot(page, "mobile-412-bybank-relink");
    await click(page, page.getByTestId("ac-sync-line"));
    await expect(page.getByTestId("ac-connections-sheet")).toContainText("Needs sign-in");
    await shot(page, "mobile-412-connections");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ac-connections-sheet")).toBeHidden();
    await page.waitForTimeout(500);
    // "Worth a look": each inference is its own one-tap row, no count.
    const things = page.getByTestId("ac-things");
    await expect(things).toContainText("Worth a look");
    await expect(things).toContainText("looks unused");
    await expect(things).toContainText("APY");
    expect(await countTexts(page)).toEqual([]);
    await page.evaluate(() => document.querySelector("[data-testid=ac-things]")?.scrollIntoView({ block: "center" }));
    await shot(page, "mobile-412-worth-a-look");
    await click(page, things.getByRole("button", { name: /^Use / }));
    await expect(things).not.toContainText("earns about");
  });

  for (const w of [360, 390, 430]) {
    test(`no overflow and 44px taps at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 860 });
      await serveAccounts(page, { broken: true });
      await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "accounts"));
      await open(page);
      expect(await overflowProblems(page)).toEqual([]);
      expect(await smallTaps(page)).toEqual([]);
      if (w === 360) { await shot(page, "mobile-360-overview"); await fullShot(page, "mobile-360-overview-full"); }
      await click(page, page.locator("[data-account-row=acc-sapph]"));
      await expect(page.getByTestId("ac-detail-sheet")).toBeVisible();
      await page.waitForTimeout(400);
      expect(await overflowProblems(page)).toEqual([]);
      expect(await smallTaps(page)).toEqual([]);
    });
  }
});

test.describe("Hidden accounts elsewhere (PR B)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const hidden of [false, true]) {
    test(`Spending ${hidden ? "drops" : "shows"} a ${hidden ? "hidden" : "visible"} card's transactions`, async ({ page }) => {
      await serveAccounts(page, { meta: hidden ? { "acc-sapph": { hidden: true } } : {} });
      await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "spending"));
      await page.goto("/");
      const main = page.locator("main");
      await expect(main).toContainText("Manage budgets", { timeout: 20_000 });
      // Sapphire (Whole Foods $86.42 + Con Edison $128) is the only spending.
      await expect(main).toContainText(hidden ? "Out $0" : "Out $214.42");
      if (hidden) await expect(main).not.toContainText("Whole Foods");
      else await expect(main).toContainText("Whole Foods");
    });
  }
});
