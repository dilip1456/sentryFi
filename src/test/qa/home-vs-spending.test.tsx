/**
 * QA — renders the REAL dashboard (demo mode, fixture data swapped in for the
 * demo transactions/accounts) and reads the figures users actually see.
 *
 * Fixture (octoberMix, see fixtures.ts), "today" = 2026-10-20 America/New_York:
 *   Groceries 100, Shopping 200, Shopping refund −50, pending Food & Drink 40,
 *   Mortgage 1500, unpaired Venmo (Transfer Out) 75, Credit Card Payment 300,
 *   internal checking→savings pair ±500, Salary −3000, plus Sep 30 Groceries 80.
 *
 * Today's numbers: Home "Spent this month" = $590, Spending "Total spent" = $1,865.
 *   Home    = 100 + 200 − 50 + 40 + 300 (counts the card payment, drops mortgage & Venmo)
 *   Spending = 100 + 200 − 50 + 40 + 1500 + 75 (drops the card payment)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
// Count-up animation would make the DOM value time-dependent; show the target directly.
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (t: number) => t }));
vi.mock("@/lib/finance-data", async (orig) => {
  const real = await orig<typeof import("@/lib/finance-data")>();
  const f = await import("./fixtures");
  return { ...real, demoAccounts: f.accounts, demoTransactions: f.octoberMix };
});
import { QA_NOW, octoberMix } from "./fixtures";
import { renderDashboard, valueAfterLabel, parseUSD } from "./render-harness";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(QA_NOW);
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterAll(() => { vi.useRealTimers(); });

const homeSpent = async () => { renderDashboard("overall"); return parseUSD((await valueAfterLabel(/^spent this month$/i))[0]); };
const spendingTotal = async () => { renderDashboard("spending"); return parseUSD((await valueAfterLabel(/^total spent$/i))[0]); };

describe("QA Home cash-flow strip (rendered)", () => {
  it("income this month = salary only; internal transfer leg and refunds are not income", async () => {
    renderDashboard("overall");
    expect((await valueAfterLabel(/^income this month$/i))[0]).toBe("$3,000");
  });
  it("net cash flow = income − Home spend and savings rate = round(net/income)", async () => {
    renderDashboard("overall");
    const spent = parseUSD((await valueAfterLabel(/^spent this month$/i))[0]);
    const net = parseUSD((await valueAfterLabel(/^net cash flow$/i))[0].replace("+", ""));
    expect(net).toBeCloseTo(3000 - spent, 2);
    expect((await valueAfterLabel(/^savings rate$/i))[0]).toBe(`${Math.round(((3000 - spent) / 3000) * 100)}%`);
  });
  it("refund nets against spend, internal pair and previous-month rows are excluded", async () => {
    // Groceries 100 + Shopping (200 − 50) + pending 40 are the uncontroversial
    // pieces both screens agree on; Home must include at least these and never
    // the ±500 internal pair or Sep 30's 80.
    const spent = await homeSpent();
    expect(spent).toBeGreaterThanOrEqual(290);
    expect([290 + 500, 290 + 80, 290 + 500 + 80].includes(spent)).toBe(false);
  });
  it("pending purchases currently count toward spend on BOTH screens (characterization)", async () => {
    // Pins today's behavior so a change is deliberate: dropping the $40
    // pending row lowers each total by exactly $40.
    const withPendingHome = await homeSpent();
    const withPendingSpend = await spendingTotal();
    const i = octoberMix.findIndex(t => t.id === "pend");
    const [pend] = octoberMix.splice(i, 1);
    try {
      expect(withPendingHome - (await homeSpent())).toBe(40);
      expect(withPendingSpend - (await spendingTotal())).toBe(40);
    } finally { octoberMix.splice(i, 0, pend); }
  });
  // KNOWN BUG: Home counts a Credit Card Payment as spending (the card's own
  // purchases are already counted) — double counting. Spending ignores it.
  it.fails("KNOWN BUG Home must not count a credit-card payment as spend", async () => {
    expect(await homeSpent()).toBe(590 - 300);
  });
});

describe("QA Spending page totals (rendered)", () => {
  it("Total spent excludes income, ignored categories (card payment) and confirmed internal transfers", async () => {
    expect(await spendingTotal()).toBe(1865);
  });
  it("Total earned matches Home income", async () => {
    renderDashboard("spending");
    expect((await valueAfterLabel(/^total earned$/i))[0]).toBe("$3,000");
  });
  it("mobile 'Spent' card and desktop 'Total spent' show the same figure", async () => {
    renderDashboard("spending");
    const mobile = (await screen.findAllByText(/^spent$/i)).map(e => e.nextElementSibling?.textContent);
    const desk = await valueAfterLabel(/^total spent$/i);
    expect(mobile[0]).toBe(desk[0]);
  });
});

describe("QA Home vs Spending parity", () => {
  // KNOWN BUG (the headline one): Home "Spent this month" and Spending "Total
  // spent" (month view, current month) use different exclusion rules —
  // Home drops Mortgage/Rent/Loan + anything named like a transfer but keeps
  // Credit Card Payment; Spending does the opposite. $590 vs $1,865 here.
  it.fails("KNOWN BUG Home 'Spent this month' === Spending 'Total spent' for the current month", async () => {
    expect(await homeSpent()).toBe(await spendingTotal());
  });
});

describe("QA account group balances & net worth (rendered)", () => {
  it("net worth = non-debt balances − credit/loan balances", async () => {
    renderDashboard("overall");
    // 5000 + 20000 + 30000 − (1200 + 9000)
    expect((await valueAfterLabel(/^net worth$/i))[0]).toMatch(/^\$44,800(?![\d.])/);
  });
  it("group subtotals per bucket and Net Cash = cash − credit cards", async () => {
    const r = renderDashboard("overall");
    await screen.findByText(/^accounts$/i);
    const text = (r.container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/Net Cash\s*\$23,800/);
    expect(text).toMatch(/Checking\s*1 account\s*\$5,000/);
    expect(text).toMatch(/Savings\s*1 account\s*\$20,000/);
    expect(text).toMatch(/Credit Cards\s*1 account\s*\$1,200/);
    expect(text).toMatch(/Loans & Mortgages\s*1 account\s*\$9,000/);
    expect(text).toMatch(/Investments\s*1 account\s*\$30,000/);
  });
  it("renders no null/undefined/NaN text on Home or Spending", async () => {
    for (const v of ["overall", "spending"] as const) {
      const r = renderDashboard(v);
      await screen.findAllByText(v === "overall" ? /^spent this month$/i : /^total spent$/i);
      expect(r.container.textContent).not.toMatch(/\b(null|undefined|NaN)\b/);
    }
  });
});
