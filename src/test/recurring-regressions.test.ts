/**
 * Regressions from QA on PR #6 (a431aab), adapted from Tester's throwaway
 * edge-case suite. One block per reported bug, plus the edge cases that
 * already passed (kept so they stay passing).
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  amountModel,
  buildOccurrences,
  detectRecurringSeries,
  fitSchedule,
  nextOutstanding,
  obligationKindFor,
  OBLIGATION_KINDS,
  CADENCES,
  readObligationSchedule,
  scheduleDates,
  SERIES_KINDS,
  toObligationLink,
  type ClassifierAccount,
  type ClassifierTxn,
  type Schedule,
} from "@/lib/recurring/index";
import { loanDetailRows, plaidErrorSummary, upsertLoanDetails } from "../../supabase/functions/_shared/plaid-liabilities.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf-8");
const MIG_STREAMS = "supabase/migrations/20261020130000_recurring_streams.sql";
const MIG_OBLIGATIONS = "supabase/migrations/20261020130100_obligations_cadence.sql";
const MIG_LOANS = "supabase/migrations/20261020130200_plaid_loan_details.sql";
const FN_SYNC = "supabase/functions/plaid-sync-transactions/index.ts";
const FN_EXCHANGE = "supabase/functions/plaid-exchange-token/index.ts";
const FN_CONSENT = "supabase/functions/plaid-grant-consent/index.ts";

const ACC: ClassifierAccount[] = [{ account_id: "chk", type: "depository", subtype: "checking", name: "Chk", mask: "1" }];
let n = 0;
const tx = (date: string, amount: number, name: string): ClassifierTxn => ({ transaction_id: `r${++n}`, account_id: "chk", amount, date, name, merchant_name: null });
const monthly = (anchorDay: number): Schedule => ({ cadence: "monthly", kind: "day-of-month", anchorDay, monthStep: 1, anchorMonth: 1, shift: "none" });
const mk = (ds: string[]) => ds.map((d, i) => ({ id: `m${i}`, date: d, amount: 100 }));
const fixed100 = amountModel([100, 100, 100]);

// ── Bug 1: next expected date skipped an unpaid bill due today / in grace ────
describe("bug 1: next expected stays on the current unpaid occurrence", () => {
  it("a bill due TODAY and unpaid is the next expected", () => {
    const r = buildOccurrences(monthly(20), mk(["2026-07-20", "2026-08-20", "2026-09-21"]), fixed100, "2026-10-20");
    expect(r.occurrences.find(o => o.period === "2026-10-20")?.status).toBe("expected");
    expect(r.next?.expected).toBe("2026-10-20"); // was 2026-11-20
  });

  it("a bill due 3 days ago (inside the 5-day grace) is still next", () => {
    const r = buildOccurrences(monthly(17), mk(["2026-07-17", "2026-08-17", "2026-09-17"]), fixed100, "2026-10-20");
    expect(r.next?.expected).toBe("2026-10-17");
  });

  it("once grace passes it turns late and next moves to the following period", () => {
    const r = buildOccurrences(monthly(10), mk(["2026-07-10", "2026-08-10", "2026-09-10"]), fixed100, "2026-10-20");
    expect(r.occurrences.find(o => o.period === "2026-10-10")?.status).toBe("late");
    expect(r.next?.expected).toBe("2026-11-10");
  });

  it("paid → next moves on; paid early also counts", () => {
    const r = buildOccurrences(monthly(20), mk(["2026-08-20", "2026-09-21", "2026-10-18"]), fixed100, "2026-10-20");
    expect(r.occurrences.find(o => o.period === "2026-10-20")?.status).toBe("paid");
    expect(r.next?.expected).toBe("2026-11-20");
  });

  it("end to end: must-pay bill due today keeps nextExpectedDate until paid or marked", () => {
    const txns = ["2026-06-20", "2026-07-20", "2026-08-20", "2026-09-21"].map(d => tx(d, 89.99, "VERIZON WIRELESS"));
    const s = detectRecurringSeries(txns, ACC, { today: "2026-10-20" });
    expect(s).toHaveLength(1);
    expect(s[0].mustPay).toBe(true);
    expect(s[0].nextExpectedDate).toBe("2026-10-20");
    expect(s[0].nextExpectedAmount).toBe(89.99);
    const marked = detectRecurringSeries(txns, ACC, {
      today: "2026-10-20",
      occurrenceOverrides: [{ seriesKey: s[0].seriesKey, period: "2026-10-20", status: "paid" }],
    });
    expect(marked[0].nextExpectedDate).toBe("2026-11-20");
  });

  it("nextOutstanding ignores paid/late/skipped and inactive series", () => {
    const occ = buildOccurrences(monthly(20), mk(["2026-07-20", "2026-08-20", "2026-09-21"]), fixed100, "2026-10-20").occurrences;
    expect(nextOutstanding(occ)?.expectedDate).toBe("2026-10-20");
    expect(nextOutstanding(occ, false)).toBeNull();
  });

  it("two misses in a row end the series; one miss keeps it active", () => {
    const r1 = buildOccurrences(monthly(1), mk(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]), fixed100, "2026-10-20");
    expect(r1.active).toBe(false);
    expect(r1.next).toBeNull();
    const r2 = buildOccurrences(monthly(1), mk(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]), fixed100, "2026-10-20");
    expect(r2.active).toBe(true);
    expect(r2.next?.expected).toBe("2026-11-01");
  });
});

// ── Bug 3: priceChanged on variable bills ────────────────────────────────────
describe("bug 3: priceChanged only for fixed-amount series", () => {
  it("does not flag a variable utility moving around its median", () => {
    const m = amountModel([95, 102.5, 88, 120, 102.5, 110]); // latest 110 vs median 102.5
    expect(m.isFixed).toBe(false);
    expect(m.priceChanged).toBe(false);
    expect(amountModel([80, 120, 95, 140, 60, 110]).priceChanged).toBe(false);
  });

  it("still flags a real price change on a fixed subscription", () => {
    const m = amountModel([15.49, 15.49, 15.49, 17.99, 17.99]);
    expect(m.isFixed).toBe(true);
    expect(m.priceChanged).toBe(true);
    expect(m.expected).toBe(17.99);
  });

  it("single amount is well-defined", () => {
    const one = amountModel([17.99]);
    expect(Number.isNaN(one.cv)).toBe(false);
    expect(one.priceChanged).toBe(false);
  });

  it("detected variable bill series has priceChanged = false", () => {
    const amounts = [95, 102.5, 88, 120, 102.5, 110];
    const dates = ["2026-05-05", "2026-06-05", "2026-07-06", "2026-08-05", "2026-09-08", "2026-10-05"];
    const s = detectRecurringSeries(dates.map((d, i) => tx(d, amounts[i], "CON EDISON ELECTRIC")), ACC, { today: "2026-10-20" });
    expect(s).toHaveLength(1);
    expect(s[0].amount.priceChanged).toBe(false);
  });
});

// ── Bug 4: obligations.kind vs stream kinds ──────────────────────────────────
function sqlList(sql: string, constraintCol: string): string[] {
  const m = new RegExp(`${constraintCol}\\s+(?:is null or ${constraintCol}\\s+)?in\\s*\\(([^)]*)\\)`, "i").exec(sql);
  if (!m) throw new Error(`no check list for ${constraintCol}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
}

describe("bug 4: obligation kinds are aligned with stream kinds", () => {
  it("recurring_streams.kind check == SERIES_KINDS", () => {
    expect(sqlList(read(MIG_STREAMS), "kind")).toEqual([...SERIES_KINDS].sort());
  });

  it("obligations.kind check == OBLIGATION_KINDS, a subset of SERIES_KINDS", () => {
    expect(sqlList(read(MIG_OBLIGATIONS), "kind")).toEqual([...OBLIGATION_KINDS].sort());
    for (const k of OBLIGATION_KINDS) expect(SERIES_KINDS).toContain(k);
  });

  it("maps every stream kind explicitly (inflows are never obligations)", () => {
    expect(obligationKindFor("subscription")).toBe("subscription");
    expect(obligationKindFor("card_payment")).toBe("card_payment");
    expect(obligationKindFor("loan")).toBe("loan");
    expect(obligationKindFor("salary")).toBeNull();
    expect(obligationKindFor("income")).toBeNull();
    expect(obligationKindFor("interest")).toBeNull();
    for (const k of SERIES_KINDS) {
      const o = obligationKindFor(k);
      if (o) expect(OBLIGATION_KINDS).toContain(o);
    }
  });

  it("toObligationLink fills cadence/due_day/next_due and skips income streams", () => {
    const bill = detectRecurringSeries(["2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"].map(d => tx(d, 15.49, "NETFLIX.COM")), ACC, { today: "2026-10-20" })[0];
    expect(toObligationLink(bill, "s1")).toMatchObject({ stream_id: "s1", kind: "subscription", cadence: "monthly", due_day: 12, next_due_date: "2026-11-12", must_pay: false });
    const salary = detectRecurringSeries(["2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09"].map(d => tx(d, -2500, "ACME PAYROLL")), ACC, { today: "2026-10-20" })[0];
    expect(salary.kind).toBe("salary");
    expect(toObligationLink(salary, "s2")).toBeNull();
  });
});

// ── Bug 5: updated_at triggers on the new tables ─────────────────────────────
describe("bug 5: updated_at triggers on new tables", () => {
  const trig = (sql: string, table: string) =>
    new RegExp(`create trigger \\w+ before update on public\\.${table}\\s+for each row execute function public\\.update_updated_at_column\\(\\)`, "i").test(sql) &&
    new RegExp(`drop trigger if exists \\w+ on public\\.${table}`, "i").test(sql);
  it("recurring_streams, stream_occurrences and plaid_loan_details use update_updated_at_column()", () => {
    expect(trig(read(MIG_STREAMS), "recurring_streams")).toBe(true);
    expect(trig(read(MIG_STREAMS), "stream_occurrences")).toBe(true);
    expect(trig(read(MIG_LOANS), "plaid_loan_details")).toBe(true);
  });
});

// ── Bug 6: upsertLoanDetails lives in _shared ────────────────────────────────
describe("bug 6: loan details helper is shared, not duplicated", () => {
  it("all three Plaid functions import it from ../_shared and none defines it", () => {
    for (const f of [FN_SYNC, FN_EXCHANGE, FN_CONSENT]) {
      const src = read(f);
      expect(src).toMatch(/from ['"]\.\.\/_shared\/plaid-liabilities\.ts['"]/);
      expect(src).not.toMatch(/function upsertLoanDetails|function loanDetailRows/);
    }
  });

  it("maps mortgage and student liabilities to plaid_loan_details rows", () => {
    const rows = loanDetailRows("u1", {
      mortgage: [{ account_id: "mtg", next_payment_due_date: "2026-11-01", next_monthly_payment: 2163.4, interest_rate: { percentage: 6.1 }, past_due_amount: 0 }],
      student: [{ account_id: "stu", minimum_payment_amount: 312.44, is_overdue: true }, { minimum_payment_amount: 1 }],
    }, "2026-10-20T06:00:00.000Z");
    expect(rows).toHaveLength(2); // the row without account_id is dropped
    expect(rows[0]).toMatchObject({ user_id: "u1", account_id: "mtg", kind: "mortgage", next_monthly_payment: 2163.4, interest_rate: 6.1, is_overdue: false });
    expect(rows[1]).toMatchObject({ account_id: "stu", kind: "student", next_monthly_payment: 312.44, minimum_payment_amount: 312.44, is_overdue: true });
  });

  it("never throws and never logs row data when the upsert fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = { from: () => ({ upsert: async () => ({ error: { code: "42P01", message: 'relation "plaid_loan_details" does not exist' } }) }) };
    await expect(upsertLoanDetails(admin, "u1", { mortgage: [{ account_id: "mtg-secret-123" }] })).resolves.toBe(0);
    const throwing = { from: () => { throw new Error("boom"); } };
    await expect(upsertLoanDetails(throwing, "u1", { mortgage: [{ account_id: "x" }] })).resolves.toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("mtg-secret-123");
    warn.mockRestore();
  });
});

// ── Bug 7: liabilities/get error logging ─────────────────────────────────────
describe("bug 7: liabilities/get errors log only code/type/request_id", () => {
  it("plaidErrorSummary drops everything else", () => {
    const body = {
      error_code: "PRODUCTS_NOT_SUPPORTED", error_type: "ITEM_ERROR", request_id: "req-1",
      error_message: "the following products are not supported for user Dilip K.",
      accounts: [{ account_id: "acc-1", mask: "1234", name: "Dilip Checking", balances: { current: 123 } }],
    };
    expect(plaidErrorSummary(body)).toEqual({ error_code: "PRODUCTS_NOT_SUPPORTED", error_type: "ITEM_ERROR", request_id: "req-1" });
    expect(JSON.stringify(plaidErrorSummary(body))).not.toMatch(/Dilip|1234|acc-1/);
    expect(plaidErrorSummary(null)).toEqual({ error_code: null, error_type: null, request_id: null });
  });

  it("no Plaid function logs the raw liabilities/get body", () => {
    for (const f of [FN_SYNC, FN_EXCHANGE, FN_CONSENT]) {
      const src = read(f);
      const lines = src.split("\n").filter((l: string) => l.includes("liabilities/get error"));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l).toMatch(/plaidErrorSummary\(\w+\)\);?\s*(return;\s*\})?\s*$/);
        expect(l).not.toMatch(/,\s*(data|credData)\)/);
      }
    }
  });
});

// ── Bug 8 + round 2 (A)/(B): 130100 must survive any legacy obligations ──────
// The behaviour itself is exercised against throwaway local Postgres
// (fresh / text legacy / non-text legacy / unmappable values, 2 runs each);
// these assertions pin the parts that make it safe.
describe("bug 8 / A / B: obligations migration never aborts and leaves valid constraints", () => {
  const sql = read(MIG_OBLIGATIONS);
  const body = sql.slice(sql.indexOf("do $$"));

  it("drops its own constraints before touching any data (re-runnable)", () => {
    const firstDrop = body.search(/drop constraint if exists obligations_cadence_check/i);
    expect(firstDrop).toBeGreaterThan(-1);
    expect(firstDrop).toBeLessThan(body.search(/update public\.obligations/i));
    expect(firstDrop).toBeLessThan(body.search(/alter column \w+ type/i));
  });

  it("A: reads the real column type and converts mismatched columns instead of failing", () => {
    expect(body).toMatch(/format_type\(a\.atttypid, a\.atttypmod\)[\s\S]*?a\.attname = 'cadence'/);
    expect(body).toMatch(/alter column cadence type text using cadence::text/);
    expect(body).toMatch(/alter column kind type text using kind::text/);
    expect(body).toMatch(/alter column due_day type integer using %s/);
    expect(body).toMatch(/alter column stream_id type uuid using %s/);
    // due_day conversion: digits only (CASE-guarded), out of range -> NULL
    expect(sql).toMatch(/case when btrim\(%1\$s::text\) ~ '\^\[0-9\]\{1,6\}\(\\\.0\+\)\?\$'\s+then case when [^]*?between 1 and 31/);
    // a conversion that can't happen is a NOTICE that skips only that column
    for (const c of ["cadence", "due_day", "kind", "stream_id"]) {
      expect(body).toMatch(new RegExp(`raise notice 'obligations\\.${c} is % and could not be converted[^']*'`));
    }
    expect(body.match(/exception when others then/g)?.length).toBe(4);
  });

  it("B: preserves originals in legacy_values (first original wins) before changing or nulling", () => {
    expect(sql).toMatch(/add column if not exists legacy_values jsonb/);
    const sets = [...body.matchAll(/set legacy_values = jsonb_build_object\('(\w+)', (?:to_jsonb\()?(?:o\.)?\w+\)?\) \|\| coalesce\((?:o\.)?legacy_values, '\{\}'::jsonb\)/g)].map(m => m[1]);
    for (const c of ["cadence", "due_day", "kind", "stream_id"]) expect(sets).toContain(c);
    // every UPDATE in the block also writes legacy_values
    const updates = body.match(/update public\.obligations[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toMatch(/legacy_values = jsonb_build_object/);
  });

  it("B: unmappable values map to NULL; dangling stream_id is cleared; then constraints are VALIDATEd", () => {
    expect(sql).toMatch(/cadence_map[\s\S]*?else null end\)/);
    expect(sql).toMatch(/kind_map[\s\S]*?else null end\)/);
    expect(body).toMatch(/due_day = null\s+where due_day is not null and due_day not between 1 and 31/);
    expect(body).toMatch(/stream_id = null[\s\S]*?not exists \(select 1 from public\.recurring_streams/);
    for (const c of ["obligations_cadence_check", "obligations_due_day_check", "obligations_kind_check", "obligations_stream_id_fkey"]) {
      expect(body).toMatch(new RegExp(`validate constraint ${c};`));
    }
    // cleaning happens before the constraints are added
    expect(body.search(/update public\.obligations o/)).toBeLessThan(body.search(/add constraint obligations_cadence_check/));
  });

  it("cadence check == CADENCES; legacy synonyms (incl. day counts) are mapped", () => {
    expect(sqlList(sql, "cadence")).toEqual([...CADENCES].sort());
    for (const [from, to] of [["annual", "yearly"], ["fortnightly", "biweekly"], ["30", "monthly"], ["365", "yearly"], ["semimonthly", "semimonthly"]]) {
      expect(sql).toMatch(new RegExp(`when '${from}' then '${to}'`));
    }
    expect(sql).toMatch(/when 'utilities' then 'bill'/);
    expect(sql).toMatch(/when 'credit_card' then 'card_payment'/);
  });
});

describe("B: app code tolerates NULL / unknown obligation schedule fields", () => {
  it("readObligationSchedule returns nulls for missing, NULL, legacy or junk values", () => {
    const none = { cadence: null, dueDay: null, kind: null, nextDueDate: null, streamId: null, mustPay: false };
    expect(readObligationSchedule(null)).toEqual(none);
    expect(readObligationSchedule({})).toEqual(none);
    expect(readObligationSchedule({ cadence: null, due_day: null, kind: null, next_due_date: null, stream_id: null, must_pay: null })).toEqual(none);
    expect(readObligationSchedule({ cadence: 30, due_day: "the 5th", kind: "weird", next_due_date: "soon", must_pay: "true" })).toEqual(none);
    expect(readObligationSchedule({ cadence: "every 3 weeks", due_day: 45 })).toMatchObject({ cadence: null, dueDay: null });
    expect(readObligationSchedule({ due_day: 0 }).dueDay).toBeNull();
    expect(readObligationSchedule({ due_day: 15.5 }).dueDay).toBeNull();
  });

  it("reads valid rows", () => {
    expect(readObligationSchedule({ cadence: "monthly", due_day: 12, kind: "subscription", next_due_date: "2026-11-12", stream_id: "s1", must_pay: true }))
      .toEqual({ cadence: "monthly", dueDay: 12, kind: "subscription", nextDueDate: "2026-11-12", streamId: "s1", mustPay: true });
    expect(readObligationSchedule({ due_day: " 7 " }).dueDay).toBe(7);
  });

  it("what we write always satisfies the DB checks (cadence in CADENCES, due_day 1-31 or null)", () => {
    const series = [
      detectRecurringSeries(["2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"].map(d => tx(d, 15.49, "NETFLIX.COM")), ACC, { today: "2026-10-20" })[0],
      detectRecurringSeries(["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"].map(d => tx(d, 40, "PLANET FITNESS")), ACC, { today: "2026-10-20" })[0],
    ];
    for (const s of series) {
      const link = toObligationLink(s, "s")!;
      expect(link).not.toBeNull();
      expect(CADENCES).toContain(link.cadence);
      expect(link.due_day === null || (link.due_day >= 1 && link.due_day <= 31)).toBe(true);
      const back = readObligationSchedule(link);
      expect(back.cadence).toBe(link.cadence);
      expect(back.kind).toBe(link.kind);
    }
  });
});

// ── Round 2 (C): plaid_loan_details RLS mirrors plaid_credit_details (PR #10) ─
describe("C: plaid_loan_details is SELECT-own for users, written by service_role only", () => {
  const sql = read(MIG_LOANS);
  it("grants: none to anon, SELECT only to authenticated, ALL to service_role", () => {
    expect(sql).toMatch(/revoke all on public\.plaid_loan_details from anon;/);
    expect(sql).toMatch(/revoke all on public\.plaid_loan_details from authenticated;/);
    expect(sql).toMatch(/grant select on public\.plaid_loan_details to authenticated;/);
    expect(sql).toMatch(/grant all on public\.plaid_loan_details to service_role;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i);
  });

  it("one SELECT policy for authenticated owners; the old FOR ALL policy is dropped", () => {
    const creates = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.plaid_loan_details\s+for (\w+)\s+to (\w+)\s+using \(([^;]*)\);/g)];
    expect(creates.map(m => [m[1], m[2], m[3]])).toEqual([["Users view own loan details", "select", "authenticated"]]);
    expect(creates[0][4]).toBe("(select auth.uid()) = user_id");
    expect(sql).toMatch(/drop policy if exists "Users can manage own loan details" on public\.plaid_loan_details;/);
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/for (all|insert|update|delete)\b/i);
    expect(code).not.toMatch(/with check/i);
  });
});

// ── Round 2 (D): plaid-grant-consent also stores loan details ────────────────
describe("D: plaid-grant-consent upserts loan details via the shared helper", () => {
  const src = read(FN_CONSENT);
  it("calls upsertLoanDetails with the liabilities it already fetched, before the credit upsert", () => {
    expect(src).toMatch(/await upsertLoanDetails\(admin, user\.id, credData\.liabilities\)/);
    expect(src.indexOf("upsertLoanDetails(admin")).toBeLessThan(src.indexOf('from("plaid_credit_details")'));
  });
  it("the backfill is best effort: wrapped in try/catch that logs no response data", () => {
    const backfill = src.slice(src.indexOf("/liabilities/get") - 200, src.indexOf("return json({ ok: true })"));
    expect(backfill).toMatch(/try \{[\s\S]*\} catch \(e\) \{\s*console\.warn\([^)]*e instanceof Error \? e\.name : "error"\);\s*\}/);
    for (const l of src.split("\n").filter((x: string) => /console\.\w+\(/.test(x) && x.includes("credData"))) {
      expect(l.replace("plaidErrorSummary(credData)", "")).not.toContain("credData");
    }
  });
});

// ── Edge cases from QA that already passed (kept as guards) ──────────────────
describe("QA edge cases (guards)", () => {
  it("month-end clamping", () => {
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    const s: Schedule = { cadence: "monthly", kind: "day-of-month", anchorDay: 31, monthStep: 1, anchorMonth: 1, shift: "none" };
    expect(scheduleDates(s, "2028-01-01", "2028-04-30").map(d => d.expected)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });

  it("Feb 29 yearly", () => {
    const s: Schedule = { cadence: "yearly", kind: "day-of-month", anchorDay: 29, monthStep: 12, anchorMonth: 2, shift: "none" };
    expect(scheduleDates(s, "2027-01-01", "2029-03-31").map(d => d.expected)).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });

  it("semimonthly 15/last with before-shift", () => {
    const s: Schedule = { cadence: "semimonthly", kind: "semimonthly", anchorDays: [15, 31], shift: "before" };
    const got = scheduleDates(s, "2026-02-01", "2026-05-31").map(d => `${d.nominal}->${d.expected}`);
    expect(got).toContain("2026-02-28->2026-02-27");
    expect(got).toContain("2026-02-15->2026-02-13");
    expect(got).toContain("2026-05-31->2026-05-29");
  });

  it("last-day monthly bill shifted after weekends across short months", () => {
    const dates = ["2025-10-31", "2025-12-01", "2025-12-31", "2026-02-02", "2026-03-02", "2026-03-31", "2026-04-30", "2026-06-01", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"];
    const s = detectRecurringSeries(dates.map(d => tx(d, 50, "CON ED ELECTRIC")), ACC, { today: "2026-10-20" });
    expect(s).toHaveLength(1);
    expect(s[0].cadence).toBe("monthly");
    expect(s[0].nextExpectedDate).toBe("2026-11-02"); // Oct 31 2026 is a Saturday
  });

  it("biweekly Fridays are not fit as semimonthly", () => {
    const ds: string[] = [];
    for (let i = 0, d = "2026-01-02"; i < 20; i++, d = addDays(d, 14)) ds.push(d);
    expect(fitSchedule(ds, { defaultShift: "before" })?.schedule.cadence).toBe("biweekly");
  });
});
