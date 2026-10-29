import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  editedRowIds,
  isExpired,
  matchAccounts,
  matchTransactions,
  rekeyOverrides,
  remapAccountColumns,
  remapInferences,
  remapSettings,
  resolvePending,
  runCarryover,
  type CarryoverDeps,
  type PendingEdit,
  type RelinkTxn,
  type TxnOverrideRow,
} from "@/lib/relink";
import type { UserSettings } from "@/hooks/useUserSettings";
import type { InferenceRow } from "@/lib/infer";
import { plaidAccountRows, upsertPlaidAccounts } from "../../supabase/functions/_shared/plaid-accounts.ts";
import { rekeyCreditStatements, relinkMatch, withPersistentIds } from "../../supabase/functions/_shared/plaid-relink.ts";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const settings = (patch: Partial<UserSettings> = {}): UserSettings => ({
  budgets: {}, accountRoles: {}, catOverrides: {}, catRules: [], smartRules: [], customCats: [], nameOverrides: {}, nameRules: {},
  manualIncome: [], manualInternal: [], manualExternal: [], dismissedInsights: [], dismissedActions: [], dismissedRecurring: [],
  recurringDismissals: [], overageFundingPrefs: {}, plannedTransfers: [], savingsGoals: [], panelOrder: [], accountMeta: {},
  benefitsUsed: {}, moneyMapFeedback: {}, txnTags: {}, txnNotes: {}, recurringOverrides: {}, txnSplits: {}, recurringGroups: [],
  cardAutopayFrom: {}, financialPicture: { overrides: {}, fundingAccounts: {} }, ...patch,
});

describe("matchAccounts", () => {
  it("persistent_account_id first, then unique mask + type + subtype", () => {
    const m = matchAccounts(
      [
        { account_id: "o-chk", persistent_account_id: "P1", mask: "0042", type: "depository", subtype: "checking" },
        { account_id: "o-sav", mask: "7781", type: "depository", subtype: "savings" },
        { account_id: "o-visa", mask: "4821", type: "credit", subtype: "credit card" },
      ],
      [
        { account_id: "n-chk", persistent_account_id: "P1", mask: "9999", type: "depository", subtype: "checking" }, // tokenized: mask changed
        { account_id: "n-sav", mask: "7781", type: "depository", subtype: "savings" },
        { account_id: "n-visa", mask: "4821", type: "credit", subtype: "credit card" },
      ],
    );
    expect(m.map).toEqual({ "o-chk": "n-chk", "o-sav": "n-sav", "o-visa": "n-visa" });
    expect(m.method).toEqual({ "o-chk": "persistent", "o-sav": "mask", "o-visa": "mask" });
    expect(m.unmatchedOld).toEqual([]);
  });

  it("never guesses: duplicate masks, a type change or a missing mask stay unmatched", () => {
    const m = matchAccounts(
      [
        { account_id: "o1", mask: "1111", type: "depository", subtype: "checking" },
        { account_id: "o2", mask: "1111", type: "depository", subtype: "checking" },
        { account_id: "o3", mask: "2222", type: "depository", subtype: "savings" },
        { account_id: "o4", mask: null, type: "credit", subtype: "credit card" },
      ],
      [
        { account_id: "n1", mask: "1111", type: "depository", subtype: "checking" },
        { account_id: "n3", mask: "2222", type: "depository", subtype: "money market" },
        { account_id: "n4", mask: null, type: "credit", subtype: "credit card" },
      ],
    );
    expect(m.map).toEqual({});
    expect(m.unmatchedOld).toEqual(["o1", "o2", "o3", "o4"]);
    expect(m.unmatchedNew).toEqual(["n1", "n3", "n4"]);
  });

  it("the edge function's copy is identical to src/lib/relink/match.ts", () => {
    expect(read("supabase/functions/_shared/relink-match.ts")).toBe(read("src/lib/relink/match.ts"));
  });
});

const tx = (id: string, account: string, date: string, amount: number, name = "Coffee Shop", extra: Partial<RelinkTxn> = {}): RelinkTxn =>
  ({ id: `row-${id}`, transaction_id: id, account_id: account, date, amount, name, merchant_name: null, ...extra });

describe("matchTransactions", () => {
  const amap = { a: "A" };
  it("matches on account + date + cents + name, pairs same-day duplicates in order", () => {
    const m = matchTransactions(
      [tx("o1", "a", "2026-10-01", 4.5), tx("o2", "a", "2026-10-01", 4.5), tx("o3", "a", "2026-10-02", 12)],
      [tx("n2", "A", "2026-10-01", 4.5), tx("n1", "A", "2026-10-01", 4.5), tx("n3", "A", "2026-10-02", 12.0)],
      amap,
    );
    expect(m.map).toEqual({ o1: "n1", o2: "n2", o3: "n3" });
    expect(m.rowMap).toEqual({ "row-o1": "row-n1", "row-o2": "row-n2", "row-o3": "row-n3" });
    expect(m.unmatched).toEqual([]);
  });
  it("allows ±2 days only when there's exactly one candidate", () => {
    const one = matchTransactions([tx("o", "a", "2026-10-01", 30, "Gym")], [tx("n", "A", "2026-10-03", 30, "GYM")], amap);
    expect(one.map).toEqual({ o: "n" });
    const two = matchTransactions([tx("o", "a", "2026-10-02", 30, "Gym")], [tx("n1", "A", "2026-10-01", 30, "Gym"), tx("n2", "A", "2026-10-03", 30, "Gym")], amap);
    expect(two.unmatched).toEqual(["o"]);
  });
  it("different amount, name, unmapped account or pending → no match", () => {
    const m = matchTransactions(
      [tx("o1", "a", "2026-10-01", 4.5), tx("o2", "a", "2026-10-01", 9, "Other"), tx("o3", "zz", "2026-10-01", 4.5), tx("o4", "a", "2026-10-05", 1, "P", { pending: true })],
      [tx("n1", "A", "2026-10-01", 4.51), tx("n2", "A", "2026-10-01", 9, "Different"), tx("n4", "A", "2026-10-05", 1, "P")],
      amap,
    );
    expect(m.map).toEqual({});
  });
});

describe("remapSettings", () => {
  const maps = { accounts: { a: "A", card: "CARD" }, rows: { r1: "R1" }, txns: {} };
  const s = settings({
    accountRoles: { a: { role: "spending" } },
    accountMeta: { card: { apr: 24 } },
    cardAutopayFrom: { card: "a" },
    overageFundingPrefs: { Dining: "a" },
    plannedTransfers: [{ id: "p", category: "x", month: "2026-10", amount: 1, fromAccountId: "a", fromAccountName: "Chk", createdAt: "", done: false }],
    savingsGoals: [{ id: "g", name: "Tax", monthlyTarget: 400, accountId: "a", createdAt: "" }],
    catOverrides: { r1: "Dining", r2: "Travel" },
    txnNotes: { r1: "birthday" },
    manualInternal: ["r1", "r2"],
    recurringGroups: [{ id: "grp", name: "Gym", frequency: "monthly", expectedAmount: 30, txnIds: ["r1", "r2"], createdAt: "", accountId: "a" }],
  });
  it("moves account keys / values and transaction row keys", () => {
    const n = remapSettings(s, maps);
    expect(n.accountRoles).toEqual({ A: { role: "spending" } });
    expect(n.accountMeta).toEqual({ CARD: { apr: 24 } });
    expect(n.cardAutopayFrom).toEqual({ CARD: "A" });
    expect(n.overageFundingPrefs).toEqual({ Dining: "A" });
    expect(n.plannedTransfers[0].fromAccountId).toBe("A");
    expect(n.savingsGoals[0].accountId).toBe("A");
    expect(n.catOverrides).toEqual({ R1: "Dining", r2: "Travel" });
    expect(n.txnNotes).toEqual({ R1: "birthday" });
    expect(n.manualInternal).toEqual(["R1", "r2"]);
    expect(n.recurringGroups[0]).toMatchObject({ accountId: "A", txnIds: ["R1", "r2"] });
  });
  it("drops edits that were snapshotted for a later retry", () => {
    const n = remapSettings(s, maps, new Set(["r2"]));
    expect(n.catOverrides).toEqual({ R1: "Dining" });
    expect(n.manualInternal).toEqual(["R1"]);
    expect(n.recurringGroups[0].txnIds).toEqual(["R1"]);
  });
  it("editedRowIds lists every transaction with an edit", () => {
    expect([...editedRowIds(s)].sort()).toEqual(["r1", "r2"]);
  });
});

describe("table re-keying", () => {
  it("txn_overrides: new rows under the new transaction_id, only for matched ones", () => {
    const rows: TxnOverrideRow[] = [
      { id: "x", user_id: "u", transaction_id: "o1", txn_type: "transfer_internal", subtype: null, created_at: "t" },
      { user_id: "u", transaction_id: "o2", txn_type: "spend" },
    ];
    expect(rekeyOverrides(rows, { o1: "n1" })).toEqual([{ user_id: "u", transaction_id: "n1", txn_type: "transfer_internal", subtype: null }]);
  });

  const inf = (patch: Partial<InferenceRow>): InferenceRow => ({
    id: "i1", user_id: "u", kind: "card_autopay", subject_type: "account", subject_ref: "card", payload: { fromAccountId: "a", evidence: [{ transactionId: "o1", accountId: "a" }] },
    confidence: 0.9, evidence_txn_ids: ["o1"], fingerprint: null, status: "confirmed", reason: null, suppressed_until: null, expires_at: null,
    detector_version: 1, last_detected_at: "", ...patch,
  });
  const maps = { accounts: { a: "A", card: "CARD" }, rows: {}, txns: { o1: "n1" } };
  it("inferences: subject, payload accounts and evidence", () => {
    const { updates, deletes } = remapInferences([inf({})], maps);
    expect(deletes).toEqual([]);
    expect(updates[0]).toMatchObject({ subject_ref: "CARD", evidence_txn_ids: ["n1"], payload: { fromAccountId: "A", evidence: [{ transactionId: "n1", accountId: "A" }] } });
  });
  it("inferences: a decided old row beats a fresh suggestion for the new account; otherwise the old one goes", () => {
    const fresh = inf({ id: "i2", subject_ref: "CARD", status: "suggested", payload: {}, evidence_txn_ids: [] });
    expect(remapInferences([inf({}), fresh], maps).deletes).toEqual(["i2"]);
    const oldSuggested = inf({ status: "suggested" });
    const newConfirmed = inf({ id: "i2", subject_ref: "CARD", status: "confirmed", payload: {}, evidence_txn_ids: [] });
    const r = remapInferences([oldSuggested, newConfirmed], maps);
    expect(r.deletes).toEqual(["i1"]);
    expect(r.updates.map(u => u.id)).not.toContain("i1");
  });
  it("recurring streams / obligations: only changed account columns", () => {
    expect(remapAccountColumns({ id: "s", account_id: "a", counterpart_account_id: "zz", pay_from_account_id: null }, ["account_id", "counterpart_account_id", "pay_from_account_id"], { a: "A" }))
      .toEqual({ account_id: "A" });
    expect(remapAccountColumns({ id: "o", funding_account_id: "q" }, ["funding_account_id"], { a: "A" })).toBeNull();
  });
});

describe("pending edits (history still arriving)", () => {
  const p: PendingEdit = {
    oldRowId: "r9", oldTransactionId: "o9", accountId: "A", date: "2025-01-15", amount: 120, name: "Car Insurance", merchant_name: null,
    settings: { maps: { txnNotes: "6-month premium", catOverrides: "Insurance" }, lists: ["manualExternal"], groups: [] },
    override: { user_id: "u", txn_type: "obligation_bill" },
  };
  it("stay pending until the transaction arrives, then restore settings and overrides", () => {
    const none = resolvePending([p], settings(), [tx("n1", "A", "2026-10-01", 4.5)]);
    expect(none.remaining).toEqual([p]);
    expect(none.resolved).toBe(0);
    const later = resolvePending([p], settings(), [{ id: "R9", transaction_id: "n9", account_id: "A", date: "2025-01-15", amount: 120, name: "CAR INSURANCE", merchant_name: null }]);
    expect(later.resolved).toBe(1);
    expect(later.remaining).toEqual([]);
    expect(later.settings.txnNotes).toEqual({ R9: "6-month premium" });
    expect(later.settings.catOverrides).toEqual({ R9: "Insurance" });
    expect(later.settings.manualExternal).toEqual(["R9"]);
    expect(later.overrides).toEqual([{ user_id: "u", txn_type: "obligation_bill", transaction_id: "n9" }]);
  });
  it("expire after 60 days", () => {
    expect(isExpired("2026-08-01T00:00:00Z", new Date("2026-10-20T00:00:00Z"))).toBe(true);
    expect(isExpired("2026-09-01T00:00:00Z", new Date("2026-10-20T00:00:00Z"))).toBe(false);
  });
});

describe("runCarryover (end to end with fakes)", () => {
  function deps(over: Partial<CarryoverDeps> = {}) {
    let s = settings({
      accountRoles: { a: { role: "spending" }, gone: { role: "reserve" } },
      cardAutopayFrom: { card: "a" },
      txnNotes: { "row-o1": "matched note", "row-old": "older note", "row-g": "note on unmatched account" },
    });
    const calls: Record<string, unknown[]> = { insertOverrides: [], saveInferences: [], patchStream: [], patchObligation: [], savePending: [], removeItem: [] };
    const d: CarryoverDeps = {
      relink: async () => ({ accountMap: { a: "A", card: "CARD" }, unmatchedOld: [{ account_id: "gone", name: "Old Savings", mask: "5555" }], unmatchedNew: [] }),
      loadTxns: async ids => ids.includes("a")
        ? [tx("o1", "a", "2026-10-01", 4.5), tx("old", "a", "2025-02-01", 99, "Insurance"), tx("g", "gone", "2026-09-01", 10), tx("plain", "a", "2026-10-02", 3)]
        : [tx("n1", "A", "2026-10-01", 4.5), tx("nplain", "A", "2026-10-02", 3)],
      loadOverrides: async () => [{ user_id: "u", transaction_id: "o1", txn_type: "spend" }, { user_id: "u", transaction_id: "old", txn_type: "obligation_bill" }],
      insertOverrides: async rows => { calls.insertOverrides.push(rows); },
      loadInferences: async () => [],
      saveInferences: async (rows, del) => { calls.saveInferences.push([rows, del]); },
      loadStreams: async () => [{ id: "s1", account_id: "a", counterpart_account_id: null, pay_from_account_id: "a" }],
      patchStream: async (id, patch) => { calls.patchStream.push([id, patch]); },
      loadObligations: async () => [{ id: "ob", funding_account_id: "a" }],
      patchObligation: async (id, patch) => { calls.patchObligation.push([id, patch]); },
      getSettings: () => s,
      setSettings: async n => { s = n; },
      savePending: async (o, n, map, pending) => { calls.savePending.push({ o, n, map, pending }); },
      removeItem: async id => { calls.removeItem.push(id); },
      ...over,
    };
    return { d, calls, current: () => s };
  }

  it("moves what matches, keeps older edits pending, reports what's lost, then removes the old Item", async () => {
    const { d, calls, current } = deps();
    const r = await runCarryover(d, "old-item", "new-item");
    expect(r).toEqual({
      accountsMoved: 2,
      accountsUnmatched: [{ account_id: "gone", name: "Old Savings", mask: "5555" }],
      editsMoved: 1,
      editsPending: 1,
      editsLost: 1,
      oldItemRemoved: true,
    });
    const s = current();
    expect(s.accountRoles).toEqual({ A: { role: "spending" }, gone: { role: "reserve" } });
    expect(s.cardAutopayFrom).toEqual({ CARD: "A" });
    expect(s.txnNotes).toEqual({ "row-n1": "matched note" });
    expect(calls.insertOverrides).toEqual([[{ user_id: "u", transaction_id: "n1", txn_type: "spend" }]]);
    expect(calls.patchStream).toEqual([["s1", { account_id: "A", pay_from_account_id: "A" }]]);
    expect(calls.patchObligation).toEqual([["ob", { funding_account_id: "A" }]]);
    const saved = calls.savePending[0] as { pending: PendingEdit[]; map: Record<string, string> };
    expect(saved.map).toEqual({ a: "A", card: "CARD" });
    expect(saved.pending).toHaveLength(1);
    expect(saved.pending[0]).toMatchObject({ oldTransactionId: "old", accountId: "A", settings: { maps: { txnNotes: "older note" } }, override: { txn_type: "obligation_bill" } });
    expect(calls.removeItem).toEqual(["old-item"]);

    // the retry path: the older transaction arrives on a later sync
    const later = resolvePending(saved.pending, s, [{ id: "row-n-old", transaction_id: "n-old", account_id: "A", date: "2025-02-01", amount: 99, name: "Insurance", merchant_name: null }]);
    expect(later.settings.txnNotes).toEqual({ "row-n1": "matched note", "row-n-old": "older note" });
    expect(later.overrides).toEqual([{ user_id: "u", txn_type: "obligation_bill", transaction_id: "n-old" }]);
  });

  it("a failing old-Item removal is reported, the moved data stays", async () => {
    const { d } = deps({ removeItem: async () => { throw new Error("plaid down"); } });
    const r = await runCarryover(d, "old-item", "new-item");
    expect(r.oldItemRemoved).toBe(false);
    expect(r.accountsMoved).toBe(2);
  });
});

describe("edge helpers", () => {
  it("plaidAccountRows keeps persistent_account_id; upsert retries without it before the migration", async () => {
    const rows = plaidAccountRows("u", "item", [{ account_id: "a", mask: "0042", type: "depository", subtype: "checking", persistent_account_id: "P1", balances: { current: 1 } }, { account_id: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].persistent_account_id).toBe("P1");
    const seen: Record<string, unknown>[][] = [];
    const admin = { from: () => ({ upsert: async (r: Record<string, unknown>[]) => { seen.push(r); return { error: "persistent_account_id" in r[0] ? { code: "PGRST204", message: "Could not find the 'persistent_account_id' column" } : null }; } }) };
    await expect(upsertPlaidAccounts(admin, rows)).resolves.toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1][0]).not.toHaveProperty("persistent_account_id");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = { from: () => { throw new Error("boom"); } };
    await expect(upsertPlaidAccounts(throwing, rows)).resolves.toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/0042|P1/);
    warn.mockRestore();
  });

  it("relinkMatch uses the live persistent ids and reports unmatched accounts by name and mask", () => {
    const old = withPersistentIds([{ account_id: "o1", mask: "0042", type: "depository", subtype: "checking", name: "Checking" }, { account_id: "o2", mask: "1", type: "x", subtype: "y", name: "Odd" }], [{ account_id: "o1", persistent_account_id: "P" }]);
    const r = relinkMatch(old, [{ account_id: "n1", mask: "8888", type: "depository", subtype: "checking", persistent_account_id: "P" }]);
    expect(r.accountMap).toEqual({ o1: "n1" });
    expect(r.unmatchedOld).toEqual([{ account_id: "o2", name: "Odd", mask: "1" }]);
  });

  it("rekeyCreditStatements moves rows (new Item's own statement wins) and deletes the old ones", async () => {
    const ops: string[] = [];
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: [{ user_id: "u", account_id: "o", statement_issue_date: "2026-09-20", statement_balance: 10, created_at: "x" }], error: null }) }) }),
        upsert: async (rows: Record<string, unknown>[], o: { onConflict: string; ignoreDuplicates: boolean }) => { ops.push(`upsert ${rows[0].account_id} ${o.ignoreDuplicates}`); expect(rows[0]).not.toHaveProperty("created_at"); return { error: null }; },
        delete: () => ({ eq: () => ({ eq: async (_c: string, v: string) => { ops.push(`delete ${v}`); return { error: null }; } }) }),
      }),
    };
    await expect(rekeyCreditStatements(admin, "u", { o: "n" })).resolves.toBe(1);
    expect(ops).toEqual(["upsert n true", "delete o"]);
  });

  it("functions store persistent ids and plaid-relink logs no Plaid bodies", () => {
    for (const f of ["plaid-exchange-token", "plaid-sync-transactions", "plaid-relink"]) {
      expect(read(`supabase/functions/${f}/index.ts`), f).toMatch(/upsertPlaidAccounts\(admin, plaidAccountRows\(/);
    }
    const src = read("supabase/functions/plaid-relink/index.ts");
    expect(src).toMatch(/plaidErrorSummary\(data, res\.status\)/);
    expect(src).not.toMatch(/console\.\w+\([^)]*\bdata\b(?!,)/);
  });
});

describe("migrations", () => {
  it("persistent_account_id column + relink_carryovers with owner-only RLS", () => {
    expect(read("supabase/migrations/20261029000100_plaid_accounts_persistent_id.sql")).toMatch(/add column if not exists persistent_account_id text/);
    const sql = read("supabase/migrations/20261029000200_relink_carryovers.sql");
    expect(sql).toMatch(/revoke all on public\.relink_carryovers from anon/);
    expect(sql).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/);
  });
});
