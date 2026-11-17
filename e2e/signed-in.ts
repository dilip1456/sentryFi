import type { Page, Route } from "@playwright/test";
import { QA_NOW } from "./fixtures";

/**
 * A signed-in session against the dummy backend (127.0.0.1:54399): a stored
 * Supabase session plus canned rows for the tables the dashboard reads, so
 * the live (non-demo) Picture path runs end to end: linked-account check,
 * settings load, transactions load, then the saved review decisions.
 * Nothing leaves the machine (fixtures.ts still blocks every other host).
 */
export const QA_USER = { id: "00000000-0000-4000-8000-00000000qa01", email: "qa@example.test" };

type Row = Record<string, unknown>;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Realistic year of data relative to QA_NOW (Oct 20, 2026). */
export function liveFixture() {
  const today = ymd(QA_NOW);
  const accounts: Row[] = [
    { id: "acc-chk", account_id: "chk", name: "Everyday Checking", official_name: null, type: "depository", subtype: "checking", mask: "1111", current_balance: 9200, available_balance: 9200, item_id: "item-qa" },
    { id: "acc-sav", account_id: "sav", name: "Online Savings", official_name: null, type: "depository", subtype: "savings", mask: "2222", current_balance: 21000, available_balance: 21000, item_id: "item-qa" },
    { id: "acc-card", account_id: "card", name: "Sapphire Card", official_name: null, type: "credit", subtype: "credit card", mask: "3333", current_balance: 1400, available_balance: null, item_id: "item-qa" },
    { id: "acc-mtg", account_id: "mtg", name: "Home Mortgage", official_name: null, type: "loan", subtype: "mortgage", mask: "4444", current_balance: 305000, available_balance: null, item_id: "item-qa" },
  ].map(a => ({ ...a, user_id: QA_USER.id, iso_currency_code: "USD" }));
  const txns: Row[] = [];
  let n = 0;
  const tx = (account: string, date: string, amount: number, name: string, extra: Row = {}) => {
    if (date > today) return;
    n += 1;
    txns.push({ id: `row-${n}`, transaction_id: `plaid-${n}`, user_id: QA_USER.id, account_id: account, amount, date, name, merchant_name: null, category: null, pending: false, payment_channel: "other", pfc_primary: null, pfc_detailed: null, ...extra });
    return `row-${n}`;
  };
  const mortgageIds: string[] = [];
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, "0");
    // Semi-monthly pay on the 15th and the last day.
    tx("chk", `2026-${mm}-15`, -3100, "GLOBEX INC PAYROLL", { pfc_primary: "INCOME", pfc_detailed: "INCOME_WAGES" });
    tx("chk", `2026-${mm}-${lastDay(2026, m)}`, -3100, "GLOBEX INC PAYROLL", { pfc_primary: "INCOME", pfc_detailed: "INCOME_WAGES" });
    // Mortgage on the 1st (Jan–Sep from checking under the servicer's name).
    if (m <= 9) mortgageIds.push(tx("chk", `2026-${mm}-01`, 2150, "ROCKET MORTGAGE", { merchant_name: "Rocket Mortgage", pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" })!);
    tx("chk", `2026-${mm}-12`, 89.99, "COMCAST XFINITY", { merchant_name: "Xfinity", pfc_primary: "RENT_AND_UTILITIES", pfc_detailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE" });
    tx("card", `2026-${mm}-07`, 15.49, "NETFLIX.COM", { merchant_name: "Netflix", pfc_primary: "ENTERTAINMENT", pfc_detailed: "ENTERTAINMENT_TV_AND_MOVIES" });
  }
  // October's mortgage: paid as a transfer that only names the account, and
  // seen on the loan itself as "PAYMENT RECEIVED" (the liability side).
  tx("chk", "2026-10-01", 2150, "ONLINE TRANSFER TO MTG XXXX4444", { pfc_primary: "TRANSFER_OUT", pfc_detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
  tx("mtg", "2026-10-01", -2150, "PAYMENT RECEIVED", { pfc_primary: "LOAN_PAYMENTS", pfc_detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" });
  // Car insurance twice a year.
  for (const d of ["2025-10-05", "2026-04-05"]) tx("chk", d, 612, "STATE FARM INSURANCE", { merchant_name: "State Farm", pfc_primary: "GENERAL_SERVICES", pfc_detailed: "GENERAL_SERVICES_INSURANCE" });
  // Some everyday spending.
  for (let i = 0; i < 40; i++) tx("card", day(today, -i * 5), 20 + (i % 7) * 9, i % 2 ? "TRADER JOE'S" : "SHELL OIL", { pfc_primary: i % 2 ? "FOOD_AND_DRINK" : "TRANSPORTATION", pfc_detailed: i % 2 ? "FOOD_AND_DRINK_GROCERIES" : "TRANSPORTATION_GAS" });
  txns.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // Dilip already confirmed the mortgage (key carried over by its transactions).
  const decisions: Row[] = [{
    user_id: QA_USER.id, series_key: "picture:outflow|rocket mortgage", source: "picture", merchant_key: "rocket mortgage", display_name: "Rocket Mortgage",
    direction: "outflow", txn_type: "obligation_loan", kind: "loan", cadence: "monthly", status: "confirmed", review_group: "payments", account_id: "chk",
    amount_median: 2150, last_seen: "2026-09-01", next_expected_date: "2026-10-01", matched_transaction_ids: mortgageIds, decided_at: "2026-09-10T12:00:00Z",
  }];
  return { accounts, txns, decisions };
}

export interface SignInOptions {
  /** Delay before the saved review decisions arrive (ms). */
  decisionsDelay?: number;
  /** Extra recurring_streams rows (e.g. confirm everything). */
  decisions?: Row[];
  settings?: Row;
}

/** Sign in (stored session) and serve the fixture; call before page.goto. */
export async function signIn(page: Page, opts: SignInOptions = {}) {
  const fx = liveFixture();
  const decisions = opts.decisions ?? fx.decisions;
  const session = {
    access_token: "qa-access-token", token_type: "bearer", expires_in: 3600, expires_at: 1924992000, refresh_token: "qa-refresh",
    user: { id: QA_USER.id, aud: "authenticated", role: "authenticated", email: QA_USER.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
  await page.addInitScript(s => { localStorage.setItem("sb-127-auth-token", s); }, JSON.stringify(session));
  const settings = { user_id: QA_USER.id, financial_picture: { overrides: {}, fundingAccounts: {} }, ...(opts.settings ?? {}) };
  await page.route("http://127.0.0.1:54399/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      "access-control-allow-origin": req.headers()["origin"] ?? "*", "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
      "access-control-expose-headers": "content-range",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" });
    const json = (body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status: 200, contentType: "application/json", headers: { ...cors, ...headers }, body: JSON.stringify(body) });
    if (url.pathname.startsWith("/auth/v1/user")) return json(session.user);
    if (url.pathname.startsWith("/auth/v1/")) return json({});
    const table = url.pathname.match(/\/rest\/v1\/([a-z_]+)/)?.[1];
    if (!table) return json([]);
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const rows = (list: Row[]) => (single ? json(list[0] ?? null) : json(list, { "content-range": `0-${Math.max(0, list.length - 1)}/${list.length}` }));
    if (req.method() === "HEAD" && table === "plaid_items") return route.fulfill({ status: 200, headers: { ...cors, "content-range": "0-0/1" }, body: "" });
    if (req.method() !== "GET" && req.method() !== "HEAD") return json([]);
    switch (table) {
      case "plaid_items": return rows([{ id: "pi-1", item_id: "item-qa", institution_id: "ins_qa", institution_name: "QA Bank", created_at: "2025-09-01T00:00:00Z", status: "active", user_id: QA_USER.id }]);
      case "plaid_accounts": return rows(fx.accounts);
      case "plaid_transactions": {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return rows(offset ? [] : fx.txns);
      }
      case "user_settings": return rows([settings]);
      case "recurring_streams": {
        if (url.searchParams.get("source") === "eq.picture" && opts.decisionsDelay) await new Promise(r => setTimeout(r, opts.decisionsDelay));
        return rows(url.searchParams.get("source") === "eq.picture" ? decisions : []);
      }
      default: return rows([]);
    }
  });
  return fx;
}
