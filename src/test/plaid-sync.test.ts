import { describe, it, expect, vi } from "vitest";
import { syncItemTransactions, resolveCategory, dedupeByTransactionId } from "../../supabase/functions/_shared/plaid-sync.ts";

type Page = { ok?: boolean; body: Record<string, unknown> };
const fakeFetch = (pages: Page[]) => {
  const calls: { cursor?: string }[] = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    const p = pages.shift()!;
    return { ok: p.ok ?? true, status: p.ok === false ? 400 : 200, json: async () => p.body } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
};
const fakeAdmin = (opts: { upsertError?: { code?: string; message: string } | ((rows: Record<string, unknown>[]) => { code?: string; message: string } | null) } = {}) => {
  const upserts: Record<string, unknown>[][] = [];
  const cursorSaves: unknown[] = [];
  const deletes: { userId?: string; ids?: string[] }[] = [];
  const admin = {
    from: (table: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        const err = typeof opts.upsertError === "function" ? opts.upsertError(rows) : opts.upsertError ?? null;
        if (!err) upserts.push(rows);
        return { error: err };
      },
      update: (v: { cursor: unknown }) => ({ eq: async () => { if (table === "plaid_items") cursorSaves.push(v.cursor); return { error: null }; } }),
      delete: () => {
        const d: { userId?: string; ids?: string[] } = {}; deletes.push(d);
        const q = { eq: (_c: string, v: string) => { d.userId = v; return q; }, in: async (_c: string, ids: string[]) => { d.ids = ids; return { error: null }; } };
        return q;
      },
    }),
  };
  return { admin, upserts, cursorSaves, deletes };
};
const cfg = (fetchFn: typeof fetch) => ({ plaidBase: "https://x", clientId: "c", secret: "s", fetchFn });
const t = (id: string, extra: Record<string, unknown> = {}) => ({ transaction_id: id, account_id: "a", amount: 1, date: "2026-10-19", name: "X", ...extra });
const base = { itemRowId: "item1", userId: "u1", accessToken: "tok", cursor: "c0" };

describe("plaid sync loop", () => {
  it("dedupes added+modified so one row can't fail the whole batch", async () => {
    const f = fakeFetch([{ body: { added: [t("1"), t("2")], modified: [t("1", { amount: 2 })], removed: [], next_cursor: "c1", has_more: false } }]);
    const a = fakeAdmin();
    const r = await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(r.ok).toBe(true);
    expect(a.upserts[0].map(x => x.transaction_id)).toEqual(["1", "2"]);
    expect(a.upserts[0][0].amount).toBe(2);
    expect(a.cursorSaves).toEqual(["c1"]);
  });
  it("does NOT advance the cursor when an upsert fails", async () => {
    const f = fakeFetch([{ body: { added: [t("1")], next_cursor: "c1", has_more: false } }]);
    const a = fakeAdmin({ upsertError: { code: "23505", message: "boom" } });
    const r = await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(r.ok).toBe(false);
    expect(a.cursorSaves).toEqual([]);
  });
  it("restarts from the original cursor on mutation during pagination", async () => {
    const f = fakeFetch([
      { body: { added: [t("1")], next_cursor: "c1", has_more: true } },
      { ok: false, body: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" } },
      { body: { added: [t("1")], next_cursor: "c1", has_more: true } },
      { body: { added: [t("2")], next_cursor: "c2", has_more: false } },
    ]);
    const a = fakeAdmin();
    const r = await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(r.ok).toBe(true);
    expect(f.calls.map(c => c.cursor)).toEqual(["c0", "c1", "c0", "c1"]);
    expect(a.cursorSaves).toEqual(["c2"]);
  });
  it("keeps the old cursor on a Plaid error", async () => {
    const f = fakeFetch([{ ok: false, body: { error_code: "ITEM_LOGIN_REQUIRED" } }]);
    const a = fakeAdmin();
    const r = await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(r.ok).toBe(false);
    expect(r.cursor).toBe("c0");
    expect(a.cursorSaves).toEqual([]);
  });
  it("stores pfc columns, and falls back when the migration isn't applied", async () => {
    const pfc = { primary: "INCOME", detailed: "INCOME_WAGES", confidence_level: "VERY_HIGH" };
    const f = fakeFetch([{ body: { added: [t("1", { personal_finance_category: pfc })], next_cursor: "c1", has_more: false } }]);
    const a = fakeAdmin({ upsertError: rows => ("pfc_detailed" in rows[0] ? { code: "PGRST204", message: "Could not find the 'pfc_detailed' column" } : null) });
    const r = await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(r.ok).toBe(true);
    expect(a.upserts[0][0]).not.toHaveProperty("pfc_detailed");
    expect(a.upserts[0][0].category).toEqual(["Salary"]);
  });
  it("scopes removals to the user", async () => {
    const f = fakeFetch([{ body: { removed: [{ transaction_id: "9" }], next_cursor: "c1", has_more: false } }]);
    const a = fakeAdmin();
    await syncItemTransactions(a.admin, cfg(f.fn), base);
    expect(a.deletes[0]).toEqual({ userId: "u1", ids: ["9"] });
  });
  it("maps the detailed PFC, not just the primary", () => {
    expect(resolveCategory({ personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" } })).toEqual(["Credit Card Payment"]);
    expect(resolveCategory({ personal_finance_category: { primary: "INCOME", detailed: "INCOME_INTEREST_EARNED" } })).toEqual(["Interest Earned"]);
    expect(resolveCategory({ category: ["Food and Drink"] })).toEqual(["Food and Drink"]);
    expect(dedupeByTransactionId([{ transaction_id: "a" }, { transaction_id: "a" }])).toHaveLength(1);
  });
});
