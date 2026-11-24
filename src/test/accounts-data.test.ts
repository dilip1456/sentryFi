/**
 * Accounts redesign, PR B (data): card limits, per-bank sync health, update
 * mode for reconnect, hidden accounts everywhere, new inference kinds.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { plaidAccountRows, upsertPlaidAccounts } from "../../supabase/functions/_shared/plaid-accounts.ts";
import { recordItemHealth, syncItemTransactions } from "../../supabase/functions/_shared/plaid-sync.ts";
import * as serverHidden from "../../supabase/functions/_shared/hidden-accounts.ts";
import { hiddenAccountIds, netWorthExcludedIds, withoutAccounts } from "@/lib/accounts/hidden";
import { INFERENCE_KINDS } from "@/lib/infer";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MIG = "supabase/migrations/20261118100000_accounts_data.sql";

describe("migration 20261118100000_accounts_data", () => {
  const sql = read(MIG);
  it("adds credit_limit and the plaid_items health columns idempotently", () => {
    expect(sql).toMatch(/alter table public\.plaid_accounts add column if not exists credit_limit numeric;/);
    for (const c of ["error_code text", "error_at timestamptz", "last_synced_at timestamptz"])
      expect(sql).toContain(`alter table public.plaid_items add column if not exists ${c};`);
  });
  it("grants column-level SELECT on only the new plaid_items columns (never access_token)", () => {
    expect(sql).toMatch(/grant select \(error_code, error_at, last_synced_at\) on public\.plaid_items to authenticated;/);
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/access_token/);
    expect(code).not.toMatch(/grant (insert|update|delete|all)/i);
  });
  it("adds account_dormant / account_duplicate to inferences.kind", () => {
    expect(INFERENCE_KINDS).toContain("account_dormant");
    expect(INFERENCE_KINDS).toContain("account_duplicate");
    expect(sql).toMatch(/'account_dormant', 'account_duplicate'/);
  });
  it("version is in the 20261118100000+ block (not the salary-fix slot)", () => {
    expect(MIG).toMatch(/\/2026111810\d{4}_/);
  });
});

describe("plaid_accounts.credit_limit", () => {
  it("maps balances.limit, null when missing", () => {
    const rows = plaidAccountRows("u", "item", [
      { account_id: "c", type: "credit", balances: { current: 100, available: 900, limit: 1000 } },
      { account_id: "d", type: "depository", balances: { current: 5, limit: null } },
    ]);
    expect(rows.map(r => r.credit_limit)).toEqual([1000, null]);
  });
  it("retries without credit_limit (and persistent_account_id) before the migrations", async () => {
    const rows = plaidAccountRows("u", "item", [{ account_id: "c", type: "credit", persistent_account_id: "P", balances: { current: 1, limit: 10 } }]);
    const seen: Record<string, unknown>[][] = [];
    const admin = { from: () => ({ upsert: async (r: Record<string, unknown>[]) => {
      seen.push(r);
      if ("credit_limit" in r[0]) return { error: { code: "PGRST204", message: "Could not find the 'credit_limit' column of 'plaid_accounts'" } };
      if ("persistent_account_id" in r[0]) return { error: { code: "PGRST204", message: "Could not find the 'persistent_account_id' column" } };
      return { error: null };
    } }) };
    await expect(upsertPlaidAccounts(admin, rows)).resolves.toBe(1);
    expect(seen).toHaveLength(3);
    expect(seen[2][0]).not.toHaveProperty("credit_limit");
    expect(seen[2][0]).not.toHaveProperty("persistent_account_id");
  });
});

type Upd = { values: Record<string, unknown>; eq?: [string, unknown]; is?: [string, unknown] };
const healthAdmin = (err: { code?: string; message?: string } | null = null) => {
  const updates: Upd[] = [];
  const admin = { from: (table: string) => ({
    update: (values: Record<string, unknown>) => {
      const u: Upd = { values }; if (table === "plaid_items") updates.push(u);
      const q = { eq: (c: string, v: unknown) => { u.eq = [c, v]; return Object.assign(Promise.resolve({ error: err }), { is: async (c2: string, v2: unknown) => { u.is = [c2, v2]; return { error: err }; } }); } };
      return q;
    },
  }) };
  return { admin, updates };
};

describe("plaid_items sync health", () => {
  const now = new Date("2026-10-20T14:00:00Z");
  it("success stamps last_synced_at and clears the error", async () => {
    const a = healthAdmin();
    await recordItemHealth(a.admin, "pi-1", { ok: true }, now);
    expect(a.updates).toEqual([{ values: { last_synced_at: now.toISOString(), error_code: null, error_at: null }, eq: ["id", "pi-1"] }]);
  });
  it("a Plaid error sets error_code, and error_at only when it was empty", async () => {
    const a = healthAdmin();
    await recordItemHealth(a.admin, "pi-1", { ok: false, errorCode: "ITEM_LOGIN_REQUIRED" }, now);
    expect(a.updates[0]).toEqual({ values: { error_code: "ITEM_LOGIN_REQUIRED" }, eq: ["id", "pi-1"] });
    expect(a.updates[1]).toEqual({ values: { error_at: now.toISOString() }, eq: ["id", "pi-1"], is: ["error_at", null] });
  });
  it("our own failure (no Plaid code) leaves health alone", async () => {
    const a = healthAdmin();
    await recordItemHealth(a.admin, "pi-1", { ok: false, errorCode: null }, now);
    expect(a.updates).toEqual([]);
  });
  it("never throws when the columns don't exist yet", async () => {
    const a = healthAdmin({ code: "PGRST204", message: "Could not find the 'error_code' column" });
    await expect(recordItemHealth(a.admin, "pi-1", { ok: false, errorCode: "ITEM_LOGIN_REQUIRED" }, now)).resolves.toBeUndefined();
    expect(a.updates).toHaveLength(1);
  });
  it("syncItemTransactions reports Plaid's error_code", async () => {
    const fetchFn = (async () => ({ ok: false, status: 400, json: async () => ({ error_code: "ITEM_LOGIN_REQUIRED" }) })) as unknown as typeof fetch;
    const r = await syncItemTransactions({ from: () => ({}) }, { plaidBase: "x", clientId: "c", secret: "s", fetchFn }, { itemRowId: "i", userId: "u", accessToken: "t", cursor: "c0" });
    expect(r).toMatchObject({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED", cursor: "c0" });
  });
  it("both sync entry points record health", () => {
    expect(read("supabase/functions/plaid-sync-transactions/index.ts")).toMatch(/recordItemHealth\(admin, item\.id, r\)/);
    expect(read("supabase/functions/plaid-exchange-token/index.ts")).toMatch(/recordItemHealth\(admin, itemRow\.id, first\)/);
  });
});

describe("reconnect = Plaid update mode without products", () => {
  const src = read("supabase/functions/plaid-create-link-token/index.ts");
  it("mode reconnect omits products; default still asks for liabilities consent", () => {
    expect(src).toMatch(/body\?\.mode === "reconnect" \? "reconnect" : "consent"/);
    expect(src).toMatch(/if \(mode === "consent"\) params\.products = \["liabilities"\];/);
  });
  it("the app sends mode: reconnect", () => {
    expect(read("src/components/finance/accounts/usePlaidUpdate.ts")).toMatch(/invoke\("plaid-create-link-token", \{ body: \{ itemId: target, mode \} \}\)/);
  });
});

describe("hidden accounts", () => {
  const accounts = [{ id: "r1", account_id: "a1" }, { id: "r2", account_id: "a2" }, { id: "r3", account_id: "a3" }];
  const meta = { r1: { hidden: true }, r2: { hidden: true, excludeFromNetWorth: true }, r3: { nickname: "x" } } as Record<string, { hidden?: boolean; excludeFromNetWorth?: boolean }>;
  it("hidden set is by Plaid account_id; net worth only drops hidden + excluded", () => {
    expect([...hiddenAccountIds(accounts, meta)].sort()).toEqual(["a1", "a2"]);
    expect([...netWorthExcludedIds(accounts, meta)]).toEqual(["a2"]);
    expect(hiddenAccountIds(accounts, null).size).toBe(0);
  });
  it("withoutAccounts drops their rows, keeps rows without an account, same array when none hidden", () => {
    const txns = [{ account_id: "a1" }, { account_id: "a3" }, { account_id: null }];
    expect(withoutAccounts(txns, hiddenAccountIds(accounts, meta))).toEqual([{ account_id: "a3" }, { account_id: null }]);
    expect(withoutAccounts(txns, new Set())).toBe(txns);
  });
  it("the server copy matches the app copy (below the header)", () => {
    const body = (p: string) => read(p).replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
    expect(body("supabase/functions/_shared/hidden-accounts.ts")).toBe(body("src/lib/accounts/hidden.ts"));
    expect(serverHidden.hiddenAccountIds(accounts, meta)).toEqual(hiddenAccountIds(accounts, meta));
  });
  it("send-alerts reads account_meta and skips hidden accounts for every alert", () => {
    const src = read("supabase/functions/send-alerts/index.ts");
    expect(src).toMatch(/account_roles,account_meta"/);
    expect(src).toMatch(/select\("id,account_id,/);
    // budget totals, low balance, payment due, large charge, price change, credits
    expect((src.match(/isHidden\(/g) ?? []).length).toBe(6);
    expect(src).toMatch(/if \(isHidden\(c\.accountId\)\) continue;/);
  });
});
