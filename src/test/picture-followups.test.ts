/**
 * PR #28 follow-ups: bank history + "Extend history" flow (src/lib/relink
 * history / flow / client), paycheck anomaly alerts (src/lib/paycheck-anomaly,
 * src/lib/derived-alerts) and the inbox merge.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { bankHistory, historyHintBanks, historyHintKey, historyLabel } from "@/lib/relink/history";
import { runExtendHistory, extendSummary, ExtendHistoryError, sameBank } from "@/lib/relink/flow";
import { retryPendingCarryovers, type RelinkDb } from "@/lib/relink/client";
import { detectIncomeAnomaly, detectMisclassifiedPaycheck, monthIncome, paycheckAlerts, paycheckStats, type AnomalyTxn } from "@/lib/paycheck-anomaly";
import { setDerivedAlerts, getDerivedAlerts, derivedInboxRows, derivedUnreadCount, markDerivedRead, isDerivedId } from "@/lib/derived-alerts";
import { prepareInbox } from "@/lib/notifications";
import type { UserSettings } from "@/hooks/useUserSettings";
import type { TxnType } from "@/lib/classify";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const TODAY = new Date(2026, 9, 20, 12); // Oct 20 2026

// ── Fake Supabase (just the builder calls the relink client makes) ──────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, fns: Record<string, (body: Row) => unknown> = {}) {
  const calls: string[] = [];
  const db: RelinkDb = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "update" | "delete" | "upsert" = "select";
      let payload: Row | Row[] | null = null;
      let lim: [number, number] | null = null;
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filters.push(r => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { filters.push(r => vs.includes(r[c])); return q; },
        order() { return q; },
        range(a: number, b: number) { lim = [a, b]; return q; },
        limit(n: number) { lim = [0, n - 1]; return q; },
        update(p: Row) { op = "update"; payload = p; return q; },
        delete() { op = "delete"; return q; },
        upsert(p: Row | Row[]) { op = "upsert"; payload = p; return q; },
        maybeSingle() { return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown) {
          const t = (tables[table] ??= []);
          calls.push(`${op} ${table}`);
          const match = t.filter(r => filters.every(f => f(r)));
          if (op === "update") match.forEach(r => Object.assign(r, payload));
          if (op === "delete") tables[table] = t.filter(r => !match.includes(r));
          if (op === "upsert") (Array.isArray(payload) ? payload : [payload!]).forEach(r => t.push({ ...r }));
          const data = op === "select" ? (lim ? match.slice(lim[0], lim[1] + 1) : match) : null;
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return q;
    },
    functions: {
      async invoke(name: string, opts: { body: unknown }) {
        calls.push(`fn ${name}`);
        const f = fns[name];
        if (!f) return { data: null, error: { message: `no ${name}` } };
        try { return { data: f(opts.body as Row), error: null }; } catch (e) { return { data: { error: (e as Error).message }, error: null }; }
      },
    },
  };
  return { db, calls, tables };
}

const baseSettings = () => ({
  catOverrides: {}, nameOverrides: {}, txnTags: {}, txnNotes: {}, recurringOverrides: {}, txnSplits: {},
  manualInternal: [], manualExternal: [], accountRoles: {}, accountMeta: {}, cardAutopayFrom: {},
}) as unknown as UserSettings;

describe("bank history", () => {
  const items = [
    { id: "old", institution_name: "Chase", created_at: "2025-01-01T00:00:00Z" },
    { id: "full", institution_name: "Ally", created_at: "2024-01-01T00:00:00Z" },
    { id: "new", institution_name: "Amex", created_at: "2026-10-19T20:00:00Z" },
    { id: "empty", institution_name: null, created_at: "2025-01-01T00:00:00Z" },
  ];
  const accounts = [
    { account_id: "a1", item_id: "old" }, { account_id: "a2", item_id: "full" }, { account_id: "a3", item_id: "new" },
  ];
  const txns = [
    { account_id: "a1", date: "2026-07-22" }, { account_id: "a1", date: "2026-10-01" },
    { account_id: "a2", date: "2024-11-05" }, { account_id: "a3", date: "2026-10-18" }, { account_id: "zz", date: "2020-01-01" },
  ];
  const list = bankHistory(items, accounts, txns, TODAY);
  const by = Object.fromEntries(list.map(b => [b.itemId, b]));

  it("measures from each bank's oldest transaction", () => {
    expect(by.old.days).toBe(90);
    expect(by.old.oldest).toBe("2026-07-22");
    expect(by.full.days).toBeGreaterThanOrEqual(700);
  });
  it("flags only banks below ~730 days, not ones still settling or with no transactions", () => {
    expect(by.old.short).toBe(true);
    expect(by.full.short).toBe(false);
    expect(by.new.settling).toBe(true);
    expect(by.new.short).toBe(false);
    expect(by.empty.days).toBeNull();
    expect(by.empty.short).toBe(false);
    expect(by.empty.institution).toBe("Connected bank");
  });
  it("hint lists short banks until each is dismissed (per bank key)", () => {
    expect(historyHintBanks(list, []).map(b => b.itemId)).toEqual(["old"]);
    expect(historyHintBanks(list, [historyHintKey("old")])).toEqual([]);
    expect(historyHintKey("old")).toBe("fp-history:old");
  });
  it("labels", () => {
    expect(historyLabel(90)).toBe("About 3 months of history");
    expect(historyLabel(20)).toBe("20 days of history");
    expect(historyLabel(400)).toBe("About 1 year of history");
    expect(historyLabel(720)).toBe("2 years of history");
    expect(historyLabel(null)).toBe("No transactions yet");
  });
});

describe("Extend history flow", () => {
  const target = { id: "old", institution_id: "ins_3", institution_name: "Chase" };
  const io = (db: RelinkDb) => ({ db, userId: "u", target, publicToken: "public-x", loadSettings: async () => baseSettings(), saveSettings: async () => {} });

  it("refuses a different bank before creating anything", async () => {
    const { db, calls } = fakeDb({});
    await expect(runExtendHistory({ ...io(db), institution: { institution_id: "ins_9", name: "Citi" } })).rejects.toThrow(/Citi, not Chase\. Nothing changed/);
    expect(calls).toEqual([]);
    expect(sameBank(target, null)).toBe(true);
  });

  it("exchanges, carries over and removes the old Item", async () => {
    const { db, calls } = fakeDb({ plaid_transactions: [] }, {
      "plaid-exchange-token": () => ({ ok: true, item_id: "new" }),
      "plaid-relink": b => { expect(b).toEqual({ oldItemId: "old", newItemId: "new" }); return { ok: true, accountMap: { a: "A" }, unmatchedOld: [], unmatchedNew: [] }; },
      "plaid-remove-item": b => { expect(b).toEqual({ itemId: "old" }); return { ok: true }; },
    });
    const r = await runExtendHistory({ ...io(db), institution: { institution_id: "ins_3", name: "Chase" } });
    expect(r).toMatchObject({ newItemId: "new", accountsMoved: 1, oldItemRemoved: true });
    expect(calls.filter(c => c.startsWith("fn"))).toEqual(["fn plaid-exchange-token", "fn plaid-relink", "fn plaid-remove-item"]);
    expect(extendSummary(r, "Chase")).toMatch(/^Chase is linked again with up to 2 years/);
  });

  it("removes the NEW Item again when plaid-relink fails (nothing changed)", async () => {
    const removed: unknown[] = [];
    const { db } = fakeDb({}, {
      "plaid-exchange-token": () => ({ ok: true, item_id: "new" }),
      "plaid-relink": () => { throw new Error("Carry-over failed"); },
      "plaid-remove-item": b => { removed.push(b); return { ok: true }; },
    });
    const err = await runExtendHistory({ ...io(db), institution: { institution_id: "ins_3" } }).catch(e => e);
    expect(err).toBeInstanceOf(ExtendHistoryError);
    expect(err.nothingChanged).toBe(true);
    expect(removed).toEqual([{ itemId: "new" }]);
  });

  it("summary names unmatched accounts and pending edits", () => {
    const s = extendSummary({ accountsMoved: 2, accountsUnmatched: [{ account_id: "x", name: "Old Savings", mask: "5555" }], editsMoved: 3, editsPending: 1, editsLost: 2, oldItemRemoved: false }, "Chase");
    expect(s).toContain("1 edit is waiting");
    expect(s).toContain("Old Savings ••5555");
    expect(s).toContain("2 edits lost");
    expect(s).toContain("disconnect it below");
  });

  it("retries pending edits once the transaction arrives, and drops expired rows", async () => {
    const pending = [{ oldRowId: "r-old", oldTransactionId: "t-old", accountId: "A", date: "2025-03-01", amount: 42, name: "Gym", merchant_name: null, settings: { maps: { catOverrides: "Fitness" }, lists: [], groups: [] }, override: null }];
    const { db, tables } = fakeDb({
      relink_carryovers: [
        { id: "c1", user_id: "u", created_at: "2026-10-10T00:00:00Z", pending },
        { id: "c2", user_id: "u", created_at: "2026-01-01T00:00:00Z", pending },
      ],
      plaid_transactions: [{ id: "r-new", transaction_id: "t-new", account_id: "A", user_id: "u", date: "2025-03-01", amount: 42, name: "Gym", merchant_name: null }],
    });
    let applied: UserSettings | null = null;
    const r = await retryPendingCarryovers(db, "u", baseSettings(), s => { applied = s; }, TODAY);
    expect(r).toEqual({ resolved: 1, remaining: 0, expired: 1 });
    expect(tables.relink_carryovers).toEqual([]);
    expect((applied as unknown as UserSettings).catOverrides).toEqual({ "r-new": "Fitness" });
  });
});

// ── Paycheck anomalies ──────────────────────────────────────────────────────
const T = (id: string, date: string, amount: number, type: TxnType): AnomalyTxn & { type: TxnType } => ({ id, date, amount, type });
const classOf = (t: AnomalyTxn) => ({ type: (t as AnomalyTxn & { type: TxnType }).type });
const biweekly = [
  T("p1", "2026-05-08", -2500, "income_salary"), T("p2", "2026-05-22", -2500, "income_salary"),
  T("p3", "2026-06-05", -2500, "income_salary"), T("p4", "2026-06-19", -2500, "income_salary"),
  T("p5", "2026-07-03", -2500, "income_salary"), T("p6", "2026-07-17", -2500, "income_salary"),
  T("p7", "2026-08-14", -2500, "income_salary"), T("p8", "2026-08-28", -2500, "income_salary"),
  T("p9", "2026-09-11", -2500, "income_salary"), T("p10", "2026-09-25", -2500, "income_salary"),
  T("p11", "2026-10-09", -2500, "income_salary"),
];

describe("paycheck anomalies (restored from main)", () => {
  it("reuses main's detection code (same rules, same wording)", () => {
    const main = read("src/lib/paycheck-anomaly.ts");
    expect(main).toContain("if (now.getDate() < 20) return null; // too early in the month to call it a shortfall");
    expect(main).toContain("if (ratio > 0.8 && ratio < 1.25) return { amount: income.other.amount };");
  });

  it("missing paycheck: flags after the 20th only", () => {
    expect(paycheckStats(biweekly, classOf, TODAY)).toEqual({ found: 1, typical: 2 });
    expect(detectIncomeAnomaly(biweekly, classOf, TODAY)).toMatch(/Usually ~2 paychecks land per month .* only 1 found so far this month/);
    expect(detectIncomeAnomaly(biweekly, classOf, new Date(2026, 9, 12))).toBeNull();
    expect(detectIncomeAnomaly([...biweekly, T("p12", "2026-10-19", -2500, "income_salary")], classOf, TODAY)).toBeNull();
  });

  it("misclassified paycheck: other income ≈ one paycheck", () => {
    const txns = [...biweekly, T("o1", "2026-10-16", -2400, "income_other")];
    expect(monthIncome(txns, classOf, TODAY)).toMatchObject({ salary: { amount: 2500 }, other: { amount: 2400 } });
    expect(detectMisclassifiedPaycheck(monthIncome(txns, classOf, TODAY))).toEqual({ amount: 2400 });
    const alerts = paycheckAlerts(txns, classOf, TODAY);
    expect(alerts).toHaveLength(1); // misclassified wins over "missing", as on main
    expect(alerts[0]).toMatchObject({ id: "derived:paycheck:misclassified:2026-10", alert_type: "paycheck_anomaly" });
    expect(alerts[0].body).toContain("this might be a second paycheck filed under the wrong category");
    expect(alerts[0].payload.transaction_ids).toEqual(["o1"]);
  });

  it("no alert for a normal month or thin history", () => {
    expect(paycheckAlerts([...biweekly, T("p12", "2026-10-19", -2500, "income_salary")], classOf, TODAY)).toEqual([]);
    expect(paycheckAlerts(biweekly.slice(-2), classOf, TODAY)).toEqual([]);
    expect(paycheckAlerts(biweekly, classOf, TODAY)[0].id).toBe("derived:paycheck:missing:2026-10");
  });
});

describe("derived alerts in the inbox", () => {
  beforeEach(() => { localStorage.clear(); setDerivedAlerts([]); });
  const alert = () => paycheckAlerts(biweekly, classOf, TODAY);

  it("unread until opened; read state per user, local", () => {
    setDerivedAlerts(alert());
    expect(derivedUnreadCount("u")).toBe(1);
    expect(derivedInboxRows("u")[0].read_at).toBeNull();
    markDerivedRead("u", [getDerivedAlerts()[0].id]);
    expect(derivedUnreadCount("u")).toBe(0);
    expect(derivedUnreadCount("other")).toBe(1);
    expect(isDerivedId(getDerivedAlerts()[0].id)).toBe(true);
  });

  it("sorts in with alert_log rows", () => {
    setDerivedAlerts(alert());
    const db = [{ id: "x", alert_type: "deposit", title: "Deposit", body: "b", payload: {}, read_at: null, created_at: "2026-10-01T00:00:00Z" }];
    const inbox = prepareInbox([...db, ...derivedInboxRows("u")], TODAY);
    expect(inbox.map(a => a.id)).toEqual(["derived:paycheck:missing:2026-10", "x"]);
  });

  it("never pushed and not written to alert_log; Timeline untouched", () => {
    const store = read("src/lib/derived-alerts.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(store).not.toMatch(/alert_log|push_tokens|functions\.invoke/);
    expect(read("supabase/functions/send-alerts/index.ts")).not.toMatch(/paycheck_anomaly/);
    const inbox = read("src/components/finance/NotificationInbox.tsx");
    expect(inbox).toContain("useDerivedAlerts");
    expect(inbox).toContain('selected.alert_type === "paycheck_anomaly"');
    expect(read("src/hooks/useUnreadAlerts.ts")).toContain("derivedUnreadCount");
  });
});

describe("wiring", () => {
  it("Settings → Banks has Extend history + the warning per bank; Index opens Settings on a tab", () => {
    const pd = read("src/components/finance/ProfileDialog.tsx");
    expect(pd).toContain("ext.start(item)");
    expect(pd).toContain("Re-linking resets per-account settings");
    expect(pd).toContain("setActiveTab(initialTab)");
    expect(read("src/pages/Index.tsx")).toMatch(/OPEN_SETTINGS_EVENT[\s\S]*initialTab=\{profileTab\}/);
    expect(read("src/components/finance/ExtendHistory.tsx")).toContain('invoke("plaid-create-link-token")');
  });
  it("tax cards say state tax isn't included", () => {
    const ins = read("src/components/finance/picture/insights.tsx");
    expect(ins.match(/State tax not included/g)?.length).toBe(4); // desktop + mobile, both cards
  });
});
