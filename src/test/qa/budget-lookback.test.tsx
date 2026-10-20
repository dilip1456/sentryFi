/**
 * QA — Budget's 12-month lookback, exercised through the real BudgetPage
 * (rendered inside LivePlaidDashboard in demo mode with fixture data).
 *
 * Fixture: one paycheck on the 15th of each of the last 12 months
 * (Nov 2025 … Oct 2026), alternating $2,000 / $3,000. "Today" is Oct 31 — the day the old
 * `setMonth(getMonth() - i)` loop broke (Oct 31 − 1 month = "Sep 31" = Oct 1,
 * so October was visited twice and September never). Correct behavior: the
 * detected paycheck reads "12 of last 12 months".
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (t: number) => t }));
vi.mock("@/lib/finance-data", async (orig) => {
  const real = await orig<typeof import("@/lib/finance-data")>();
  const f = await import("./fixtures");
  const paychecks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2025, 10 + i, 15); // Nov 2025 … Oct 2026
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
    // Alternating $2,000 / $3,000 (commission-style) keeps it under review in
    // the Detected column instead of being auto-tracked (auto-track needs
    // amounts within 20% of each other), so its "N of last 12 months" shows.
    return f.txn({ id: `pay-${date}`, amount: i % 2 ? -3000 : -2000, date, account_id: "acc_chk", name: "Initech Payroll", merchant_name: "Initech", category: ["Salary"] });
  });
  return { ...real, demoAccounts: f.accounts, demoTransactions: paychecks };
});
import { renderDashboard } from "./render-harness";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00-04:00"));
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterAll(() => { vi.useRealTimers(); });

describe("QA Budget 12-month lookback (rendered)", () => {
  it("visits 12 distinct months on the 31st: a monthly paycheck reads '12 of last 12 months'", async () => {
    const r = renderDashboard("budget");
    await screen.findAllByText(/of last 12 months/);
    const counts = [...(r.container.textContent ?? "").matchAll(/(\d+) of last 12 months/g)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts).toContain(12);
    expect(Math.max(...counts)).toBeLessThanOrEqual(12);
  });
});
