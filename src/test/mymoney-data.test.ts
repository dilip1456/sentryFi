/**
 * My Money PR A: data layer (migrations, Plaid history depth, statement history).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { INFERENCE_KINDS, INFERENCE_STATUSES, SUBJECT_TYPES } from "@/lib/infer";
import { newItemLinkProducts, TRANSACTIONS_DAYS_REQUESTED } from "../../supabase/functions/_shared/plaid-link.ts";
import { creditStatementRows, upsertCreditStatements } from "../../supabase/functions/_shared/plaid-liabilities.ts";
import { syncItemTransactions } from "../../supabase/functions/_shared/plaid-sync.ts";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MIG_INF = "supabase/migrations/20261020210000_inferences.sql";
const MIG_AUTOPAY = "supabase/migrations/20261020210100_recurring_streams_autopay.sql";
const MIG_STMT = "supabase/migrations/20261020210200_credit_statements.sql";

/** Values of `check (<col> in ('a', 'b', ...))`, sorted. */
function checkList(sql: string, col: string): string[] {
  const m = sql.match(new RegExp(`check \\(${col} in \\(([^)]*)\\)\\)`, "s"));
  if (!m) throw new Error(`no check list for ${col}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
}

describe("migrations", () => {
  const inf = read(MIG_INF);
  it("inferences checks match the TS lists", () => {
    expect(checkList(inf, "kind")).toEqual([...INFERENCE_KINDS].sort());
    expect(checkList(inf, "subject_type")).toEqual([...SUBJECT_TYPES].sort());
    expect(checkList(inf, "status")).toEqual([...INFERENCE_STATUSES].sort());
  });
  it("inferences: owner-only RLS, no anon, updated_at trigger", () => {
    expect(inf).toMatch(/enable row level security/);
    expect(inf).toMatch(/revoke all on public\.inferences from anon/);
    expect(inf).toMatch(/to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/);
    expect(inf).toMatch(/update_updated_at_column/);
    expect(inf).toMatch(/unique \(user_id, kind, subject_ref\)/);
  });
  it("credit_statements is service-written, user read-only", () => {
    const sql = read(MIG_STMT);
    expect(sql).toMatch(/grant select on public\.credit_statements to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(sql).toMatch(/for select\s+to authenticated/);
  });
  it("recurring_streams autopay columns are idempotent and checked", () => {
    const sql = read(MIG_AUTOPAY);
    expect((sql.match(/add column if not exists/g) ?? []).length).toBe(7);
    expect(checkList(sql, "autopay")).toEqual(["auto", "manual", "unknown"]);
  });
  it("versions are in the 2026102021xxxx range", () => {
    for (const m of [MIG_INF, MIG_AUTOPAY, MIG_STMT]) expect(m).toMatch(/\/2026102021\d{4}_/);
  });
});

describe("Plaid history depth (730 days)", () => {
  it("new Items request transactions.days_requested = 730 at Link", () => {
    expect(TRANSACTIONS_DAYS_REQUESTED).toBe(730);
    const p = newItemLinkProducts();
    expect(p.products).toContain("transactions");
    expect(p.transactions.days_requested).toBe(730);
  });
  it("both link-token functions use it for new Items; update mode does not", () => {
    const create = read("supabase/functions/plaid-create-link-token/index.ts");
    expect(create).toMatch(/Object\.assign\(params, newItemLinkProducts\(\)\)/);
    const updateBranch = create.slice(create.indexOf("if (itemId)"), create.indexOf("} else {"));
    expect(updateBranch).toMatch(/params\.products = \["liabilities"\]/);
    expect(updateBranch).not.toMatch(/newItemLinkProducts\(\)/);
    expect(read("supabase/functions/plaid-link-token/index.ts")).toMatch(/\.\.\.newItemLinkProducts\(\)/);
  });
  it("/transactions/sync also passes days_requested (only used if Transactions wasn't initialised at Link)", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchFn = vi.fn(async (_u: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ added: [], modified: [], removed: [], next_cursor: "c1", has_more: false }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const admin = { from: () => ({ upsert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) }) };
    await syncItemTransactions(admin as never, { plaidBase: "https://x", clientId: "c", secret: "s", fetchFn }, { itemRowId: "i", userId: "u", accessToken: "t", cursor: null });
    expect(calls[0].options).toMatchObject({ include_personal_finance_category: true, days_requested: 730 });
  });
});

describe("credit statement history", () => {
  const liabilities = {
    credit: [
      { account_id: "visa", last_statement_issue_date: "2026-09-20", last_statement_balance: 1104.2, minimum_payment_amount: 35, next_payment_due_date: "2026-10-15", last_payment_amount: 940, last_payment_date: "2026-09-15", is_overdue: false },
      { account_id: "nostatement", last_statement_issue_date: null },
      { account_id: null, last_statement_issue_date: "2026-09-20" },
    ],
  };
  it("one row per card statement, keyed by issue date; cards without one are skipped", () => {
    const rows = creditStatementRows("u1", liabilities as never, "2026-10-20T00:00:00Z");
    expect(rows).toEqual([
      expect.objectContaining({ user_id: "u1", account_id: "visa", statement_issue_date: "2026-09-20", statement_balance: 1104.2, minimum_payment_amount: 35, due_date: "2026-10-15", is_overdue: false }),
    ]);
  });
  it("never throws and never logs row data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { from: () => ({ upsert: async () => ({ error: { code: "42P01", message: "relation does not exist" } }) }) };
    await expect(upsertCreditStatements(failing as never, "u1", liabilities as never)).resolves.toBe(0);
    const throwing = { from: () => { throw new Error("boom"); } };
    await expect(upsertCreditStatements(throwing as never, "u1", liabilities as never)).resolves.toBe(0);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toMatch(/visa|1104|2026-09-20/);
    warn.mockRestore();
    const ok: { rows?: unknown[]; conflict?: string } = {};
    const good = { from: () => ({ upsert: async (rows: unknown[], o: { onConflict: string }) => { ok.rows = rows; ok.conflict = o.onConflict; return { error: null }; } }) };
    await expect(upsertCreditStatements(good as never, "u1", liabilities as never)).resolves.toBe(1);
    expect(ok.conflict).toBe("user_id,account_id,statement_issue_date");
  });
  it("every function that fetches liabilities snapshots statements right after loans", () => {
    for (const fn of ["plaid-sync-transactions", "plaid-exchange-token", "plaid-grant-consent"]) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src, fn).toMatch(/await upsertCreditStatements\(admin, /);
      expect(src.indexOf("upsertCreditStatements(admin"), fn).toBeGreaterThan(src.indexOf("upsertLoanDetails(admin"));
    }
  });
  it("plaid-remove-item also clears loan details and statement history for the item's accounts", () => {
    const src = read("supabase/functions/plaid-remove-item/index.ts");
    expect(src).toMatch(/\["plaid_loan_details", "credit_statements"\]/);
  });
});
