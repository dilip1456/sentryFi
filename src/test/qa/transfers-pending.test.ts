/**
 * QA — internal-transfer pairing and pending handling
 * (detectInternalTransfers in LivePlaidDashboard.tsx).
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
import { dash, need } from "./internals";
import { txn } from "./fixtures";

const detect = need<(t: ReturnType<typeof txn>[]) => Set<string>>(dash, "detectInternalTransfers");
const leg = (id: string, account_id: string, amount: number, date: string, name = "Online Transfer", category: string[] | null = ["Transfer"]) =>
  txn({ id, account_id, amount, date, name, category });

describe("QA detectInternalTransfers", () => {
  it("pairs opposite, equal amounts on two different own accounts within 3 days", () => {
    const ids = detect([leg("a", "chk", 500, "2026-10-09"), leg("b", "sav", -500, "2026-10-11")]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
  it("does not pair more than 3 days apart", () => {
    expect(detect([leg("a", "chk", 500, "2026-10-01"), leg("b", "sav", -500, "2026-10-05")]).size).toBe(0);
  });
  it("does not pair legs on the same account", () => {
    expect(detect([leg("a", "chk", 500, "2026-10-09"), leg("b", "chk", -500, "2026-10-09")]).size).toBe(0);
  });
  it("does not pair same-sign amounts", () => {
    expect(detect([leg("a", "chk", 500, "2026-10-09"), leg("b", "sav", 500, "2026-10-09")]).size).toBe(0);
  });
  it("requires BOTH legs to look transfer-flavored (a coincidental $200 bill + $200 deposit are not internal)", () => {
    const ids = detect([
      txn({ id: "bill", account_id: "chk", amount: 200, date: "2026-10-09", merchant_name: "Con Edison", category: ["Bills & Utilities"] }),
      leg("zelle", "sav", -200, "2026-10-09", "Zelle from Mom", ["Transfer", "Third Party", "Zelle"]),
    ]);
    expect(ids.size).toBe(0);
  });
  it("recognizes transfer-flavored names even with no category (Venmo/Zelle/Cash App)", () => {
    const ids = detect([
      txn({ id: "a", account_id: "chk", amount: 60, date: "2026-10-09", name: "VENMO CASHOUT", category: null }),
      txn({ id: "b", account_id: "sav", amount: -60, date: "2026-10-09", name: "Venmo deposit", category: null }),
    ]);
    expect(ids.size).toBe(2);
  });
  // KNOWN BUG: the uniqueness check is one-sided. "out" sees two candidates
  // and is skipped, but then "in1" sees only "out" and pairs with it anyway,
  // so the result depends on row order — contrary to the doc comment.
  it.fails("KNOWN BUG leaves ambiguous matches unpaired (two candidates in the window)", () => {
    const ids = detect([leg("out", "chk", 300, "2026-10-09"), leg("in1", "sav", -300, "2026-10-09"), leg("in2", "brk", -300, "2026-10-10")]);
    expect(ids.has("out")).toBe(false);
  });
  it("skips pending transactions and zero amounts", () => {
    expect(detect([{ ...leg("a", "chk", 500, "2026-10-09"), pending: true }, leg("b", "sav", -500, "2026-10-09")]).size).toBe(0);
    expect(detect([leg("a", "chk", 0, "2026-10-09"), leg("b", "sav", -0, "2026-10-09")]).size).toBe(0);
  });
  it("handles string amounts from PostgREST numeric columns", () => {
    const a = { ...leg("a", "chk", 0, "2026-10-09"), amount: "125.50" as unknown as number };
    const b = { ...leg("b", "sav", 0, "2026-10-09"), amount: "-125.5" as unknown as number };
    expect(detect([a, b]).size).toBe(2);
  });
  it("credit-card payment from checking pairs with the card-side credit", () => {
    const ids = detect([
      leg("p1", "chk", 300, "2026-10-10", "Payment Thank You", ["Payment", "Credit Card"]),
      leg("p2", "card", -300, "2026-10-11", "Payment Received", ["Payment", "Credit Card"]),
    ]);
    // Category text "Payment|Credit Card" doesn't match the transfer regex
    // (it tests category[0] = "Payment"), nor do these names.
    expect(ids.size).toBe(0);
  });
});
