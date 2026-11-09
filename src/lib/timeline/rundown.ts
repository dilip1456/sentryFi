/**
 * Timeline cash-flow RUNDOWN: pure projection logic (no React / Supabase).
 *
 * Today → today+N (N = 7 or 14) of PLANNED RECURRING items only (income,
 * bills, utilities, insurance, tax, loan and card payments, savings
 * transfers). Ad hoc spending (restaurants, groceries, shopping) is never an
 * input to the projection, so shortfalls are optimistic unless the optional
 * everyday-spending reserve is on.
 *
 * Algorithm (see review/financial-picture/timeline-rundown/RATIONALE.md):
 * 1. Start from each spendable account's balance (available, else current).
 * 2. Planned items: ACH items on a weekend/bank holiday move to the next
 *    business day; card due dates do not move.
 * 3. Each item is matched against posted/pending transactions (same account,
 *    within ±3 days, amount within max(10%, $5)). Matched = paid/received and
 *    already in the balance (pending is already in `available`).
 * 4. Unmatched past bills are "late" (1–5 days) or "missed" (more) and are
 *    assumed to leave TODAY. Unmatched past income is late/missed and is NOT
 *    counted until it arrives (the flag shows the "if it arrives" what-if).
 * 5. Within a day: income, then internal transfers, then outflows.
 * 6. Balances are tracked per account and summed for "All spendable";
 *    transfers between spendable accounts net to zero in the sum.
 */
import { addDays, diffDays, isBusinessDay, shiftToBusinessDay } from "@/lib/recurring/dates";

export type RundownKind =
  | "income" | "bill" | "utility" | "insurance" | "tax" | "loan" | "card" | "savings" | "transfer" | "subscription";

export const PLANNED_KINDS: readonly RundownKind[] = [
  "income", "bill", "utility", "insurance", "tax", "loan", "card", "savings", "transfer", "subscription",
];

export interface PlannedItem {
  id: string;
  title: string;
  kind: RundownKind | string;
  /** Signed: + money in, − money out. */
  amount: number;
  /** Nominal expected date (YYYY-MM-DD). */
  date: string;
  /** Account the money leaves (outflow) or lands in (income). */
  accountId: string | null;
  /** Transfers/savings: destination account (if one of the user's). */
  toAccountId?: string | null;
  source: "confirmed" | "detected";
  estimated?: boolean;
  repeats?: string | null;
  /** "none" for card due dates (they don't move); default next business day. */
  shift?: "next_business" | "none";
  /** User-set occurrence status ("Mark paid", "Skip this time"). */
  status?: "expected" | "paid" | "received" | "skipped";
  /** "This time only" override. */
  override?: { date?: string; amount?: number } | null;
  /** Merchant/payee text used as a tie-breaker when matching transactions. */
  matchName?: string | null;
  streamId?: string | null;
  /** Original period key for overrides (defaults to `date`). */
  period?: string;
}

export interface RundownTxn {
  id: string;
  accountId: string | null;
  /** Signed: + money in, − money out. */
  amount: number;
  date: string;
  name?: string | null;
  pending?: boolean;
}

export interface RundownAccount {
  id: string;
  name: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  /** available ?? current. */
  balance: number | null;
}

export interface RundownSettings {
  /** Warn below this projected balance. Default $500. */
  buffer: number;
  /** Reserve for everyday spending (default off). */
  reserveOn: boolean;
  /** Daily amount reserved when on. */
  reserveDaily: number;
  /** Explicit per-account toggles; missing = default (all spendable on). */
  accounts: Record<string, boolean>;
}

export const DEFAULT_RUNDOWN_SETTINGS: RundownSettings = { buffer: 500, reserveOn: false, reserveDaily: 40, accounts: {} };
export const RUNDOWN_SMALL = 25;
export const MATCH_DAYS = 3;
export const LATE_MAX_DAYS = 5;
export const LOOKBACK_DAYS = 10;
export const RECENT_DAYS = 3;

export function normalizeRundownSettings(raw: unknown): RundownSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RundownSettings>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const accounts: Record<string, boolean> = {};
  if (r.accounts && typeof r.accounts === "object") for (const [k, v] of Object.entries(r.accounts)) if (typeof v === "boolean") accounts[k] = v;
  return {
    buffer: num(r.buffer, DEFAULT_RUNDOWN_SETTINGS.buffer),
    reserveOn: r.reserveOn === true,
    reserveDaily: num(r.reserveDaily, DEFAULT_RUNDOWN_SETTINGS.reserveDaily),
    accounts,
  };
}

/** Depository checking/savings (incl. money market) can pay bills; cards, loans, investments can't. */
export function isSpendableType(a: Pick<RundownAccount, "type" | "subtype">): boolean {
  const t = (a.type ?? "").toLowerCase(), st = (a.subtype ?? "").toLowerCase();
  if (t !== "depository") return false;
  return !/^(cd|hsa)$/.test(st);
}

/** Accounts the user can toggle (depository), and which are on. */
export function spendableAccounts(accounts: RundownAccount[], s: RundownSettings): { candidates: RundownAccount[]; on: Set<string> } {
  const candidates = accounts.filter(isSpendableType);
  return { candidates, on: new Set(candidates.filter(a => s.accounts[a.id] !== false).map(a => a.id)) };
}

/** Amount tolerance for a late match: within 10% or $5, whichever is larger. */
export const amountTolerance = (amt: number) => Math.max(Math.abs(amt) * 0.1, 5);

export type RowState = "paid" | "received" | "pending" | "expected" | "late" | "missed" | "skipped";

export interface RundownRow {
  item: PlannedItem;
  /** Effective date (after override and business-day shift). */
  date: string;
  /** The day this row is shown/counted on (late bills: today). */
  day: string;
  amount: number;
  state: RowState;
  /** Days past the expected date (late/missed). */
  daysLate: number;
  matchedTxnId: string | null;
  /** Counts in the projection (future/late bill, unmatched, not skipped). */
  counts: boolean;
  /** Funding account short for this payment. */
  risk: { accountId: string; before: number; short: number } | null;
  /** Combined end-of-day balance on `day` (if within the horizon). */
  eodAfter: number | null;
  flagged: boolean;
}

export type RundownEntry =
  | { kind: "row"; row: RundownRow }
  | { kind: "group"; key: string; rows: RundownRow[]; total: number };

export interface RundownDay {
  date: string;
  eod: number;
  entries: RundownEntry[];
  /** Late income shown on today's list (not counted). */
}

export type RundownFlag =
  | { type: "short" | "buffer"; id: "short"; date: string; low: number; lowDate: string; amountShort: number; atRiskCount: number; ifIncome: { amount: number; low: number } | null }
  | { type: "risk"; id: string; row: RundownRow; accountId: string; short: number }
  | { type: "late" | "missed"; id: string; row: RundownRow }
  | { type: "income_late" | "income_missed"; id: string; row: RundownRow; lowWithout: number; lowWith: number; putsAtRisk: string[] };

export interface RecentDay { date: string; actualEod: number; entries: RundownEntry[] }

export interface RundownResult {
  today: string;
  days: number;
  start: number;
  buffer: number;
  reserve: number;
  spendable: string[];
  view: string[];
  daysOut: RundownDay[];
  eod: number[];
  low: number;
  lowDate: string;
  flags: RundownFlag[];
  incomeExpected: number;
  billsDue: number;
  /** Income received in the last RECENT_DAYS (matched planned income). */
  incomeReceived: number;
  recent: RecentDay[];
  rows: RundownRow[];
}

export interface RundownInput {
  today: string;
  days: 7 | 14;
  items: PlannedItem[];
  txns: RundownTxn[];
  accounts: RundownAccount[];
  settings: RundownSettings;
  /** "all" (default) or one spendable account id. */
  view?: string;
}

const KIND_ORDER = (r: RundownRow) => (r.amount > 0 && r.item.kind !== "transfer" ? 0 : r.item.kind === "transfer" ? 1 : 2);

function effectiveDate(it: PlannedItem): string {
  const d = it.override?.date ?? it.date;
  if (it.shift === "none") return d;
  return isBusinessDay(d) ? d : shiftToBusinessDay(d, "after");
}

const tokens = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
function nameScore(a: string | null | undefined, b: string | null | undefined): number {
  const A = tokens(a), B = tokens(b);
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n;
}

/** Match planned items to transactions (each transaction used once). Exposed for tests. */
export function matchItems(items: { item: PlannedItem; date: string; amount: number }[], txns: RundownTxn[]): Map<string, RundownTxn> {
  const used = new Set<string>();
  const out = new Map<string, RundownTxn>();
  // tightest candidates first: exact-ish amounts/dates win
  const cands: { i: string; t: RundownTxn; score: number }[] = [];
  for (const x of items) {
    for (const t of txns) {
      if (Math.sign(t.amount) !== Math.sign(x.amount) || x.amount === 0) continue;
      if (x.item.accountId && t.accountId && x.item.accountId !== t.accountId) continue;
      const dd = Math.abs(diffDays(t.date, x.date));
      if (dd > MATCH_DAYS) continue;
      const da = Math.abs(Math.abs(t.amount) - Math.abs(x.amount));
      if (da > amountTolerance(x.amount)) continue;
      cands.push({ i: x.item.id, t, score: dd + da / Math.max(1, Math.abs(x.amount)) * 10 - nameScore(x.item.matchName ?? x.item.title, t.name) * 2 });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands) {
    if (out.has(c.i) || used.has(c.t.id)) continue;
    out.set(c.i, c.t); used.add(c.t.id);
  }
  return out;
}

export function buildRundown(input: RundownInput): RundownResult {
  const { today, days, settings } = input;
  const last = addDays(today, days - 1);
  const { on } = spendableAccounts(input.accounts, settings);
  const viewIds = input.view && input.view !== "all" && on.has(input.view) ? [input.view] : [...on];
  const view = new Set(viewIds);
  const known = new Map(input.accounts.map(a => [a.id, a] as const));
  const nonSpendable = (id: string | null | undefined) => !!id && known.has(id) && !on.has(id);

  // ── 1. candidate items: planned kinds only, from/to a spendable account ──
  const items = input.items.filter(it => {
    if (!(PLANNED_KINDS as readonly string[]).includes(it.kind)) return false; // no ad hoc spending
    if (!Number.isFinite(it.amount) || it.amount === 0) return false;
    // charged to a card / loan / investment, or to an account the user switched off: not cash today
    if (nonSpendable(it.accountId)) return false;
    return true;
  });
  const prepared = items.map(it => {
    const amount = it.override?.amount != null ? Math.sign(it.amount) * Math.abs(it.override.amount) : it.amount;
    return { item: it, date: effectiveDate(it), amount };
  }).filter(x => x.date >= addDays(today, -LOOKBACK_DAYS) && x.date <= last);

  const matches = matchItems(prepared.filter(x => !x.item.status || x.item.status === "expected"), input.txns);

  const rows: RundownRow[] = prepared.map(x => {
    const it = x.item;
    const income = x.amount > 0 && it.kind !== "transfer";
    const m = matches.get(it.id) ?? null;
    let state: RowState;
    if (it.status === "skipped") state = "skipped";
    else if (it.status === "paid" || it.status === "received") state = income ? "received" : "paid";
    else if (m) state = m.pending ? "pending" : income ? "received" : "paid";
    else if (x.date < today) state = diffDays(today, x.date) > LATE_MAX_DAYS ? "missed" : "late";
    else state = "expected";
    const daysLate = state === "late" || state === "missed" ? diffDays(today, x.date) : 0;
    const lateOut = (state === "late" || state === "missed") && !income;
    const counts = (state === "expected" && x.date >= today) || lateOut;
    const day = lateOut ? today : x.date;
    return { item: it, date: x.date, day, amount: x.amount, state, daysLate, matchedTxnId: m?.id ?? null, counts, risk: null, eodAfter: null, flagged: false };
  });

  const ordered = (list: RundownRow[]) => [...list].sort((a, b) =>
    a.day.localeCompare(b.day) || KIND_ORDER(a) - KIND_ORDER(b) || a.amount - b.amount || a.item.title.localeCompare(b.item.title));

  // ── 2. project ──
  const startPer = new Map<string, number>();
  for (const id of on) startPer.set(id, known.get(id)?.balance ?? 0);
  const reserve = settings.reserveOn ? Math.max(0, settings.reserveDaily) : 0;

  /** Effect of a row on a set of accounts. Unknown account → counts toward the combined view only. */
  const delta = (r: RundownRow, set: Set<string>, combinedUnknown: boolean) => {
    const from = r.item.accountId, to = r.item.toAccountId;
    let d = 0;
    const fromIn = from ? set.has(from) : combinedUnknown;
    if (fromIn) d += r.amount;
    if (r.amount < 0 && to && set.has(to)) d += -r.amount; // transfer lands in a spendable account
    return d;
  };

  function project(extra: { amount: number; accountId: string | null } | null, ids: Set<string>, all: boolean) {
    const per = new Map(startPer);
    let bal = [...ids].reduce((s, id) => s + (startPer.get(id) ?? 0), 0);
    const start = bal;
    const eod: number[] = [];
    const risk = new Map<string, { accountId: string; before: number; short: number }>();
    const fut = ordered(rows.filter(r => r.counts && r.day >= today && r.day <= last));
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      if (extra && i === 0) {
        bal += extra.accountId == null ? (all ? extra.amount : 0) : ids.has(extra.accountId) ? extra.amount : 0;
        if (extra.accountId && per.has(extra.accountId)) per.set(extra.accountId, per.get(extra.accountId)! + extra.amount);
      }
      for (const r of fut.filter(x => x.day === date)) {
        bal += delta(r, ids, all);
        const from = r.item.accountId, to = r.item.toAccountId;
        const before = from && per.has(from) ? per.get(from)! : null;
        if (from && per.has(from)) per.set(from, per.get(from)! + r.amount);
        if (r.amount < 0 && to && per.has(to)) per.set(to, per.get(to)! - r.amount);
        if (r.amount < 0 && from && before != null && before + r.amount < 0) {
          risk.set(r.item.id, { accountId: from, before, short: -(before + r.amount) });
        }
      }
      bal -= reserve;
      eod.push(bal);
    }
    let lo = 0; eod.forEach((v, i) => { if (v < eod[lo]) lo = i; });
    return { start, eod, lo, low: eod[lo] ?? start, risk };
  }

  const allIds = on;
  const P = project(null, view, viewIds.length === on.size);
  const full = view.size === allIds.size ? P : project(null, allIds, true);
  const fullEod = (d: string) => { const i = diffDays(d, today); return i >= 0 && i < days ? full.eod[i] : null; };

  for (const r of rows) {
    const rk = full.risk.get(r.item.id);
    if (rk) r.risk = rk;
    const i = diffDays(r.day, today);
    r.eodAfter = r.counts && i >= 0 && i < days ? P.eod[i] : null;
    r.flagged = !!r.risk || r.state === "late" || r.state === "missed";
  }

  // ── 3. flags ──
  const flags: RundownFlag[] = [];
  const lateIncome = rows.filter(r => (r.state === "late" || r.state === "missed") && r.amount > 0 && r.item.kind !== "transfer");
  const riskRows = rows.filter(r => r.risk);
  const inShort = (r: RundownRow) => (fullEod(r.day) ?? 0) < 0;
  const firstBelow = P.eod.findIndex(v => v < settings.buffer);
  if (firstBelow >= 0) {
    const neg = P.low < 0;
    const incomeTotal = lateIncome.reduce((s, r) => s + r.amount, 0);
    const what = lateIncome.length ? project({ amount: incomeTotal, accountId: null }, view, true) : null;
    const firstDate = neg ? addDays(today, P.eod.findIndex(v => v < 0)) : addDays(today, firstBelow);
    flags.push({
      type: neg ? "short" : "buffer", id: "short", date: firstDate, low: P.low, lowDate: addDays(today, P.lo),
      amountShort: neg ? -P.low : settings.buffer - P.low,
      atRiskCount: riskRows.filter(inShort).length,
      ifIncome: what ? { amount: incomeTotal, low: what.low } : null,
    });
  }
  for (const r of lateIncome) {
    const W = project({ amount: r.amount, accountId: r.item.accountId }, allIds, true);
    const putsAtRisk = rows.filter(b => b.counts && b.amount < 0 && full.risk.has(b.item.id) && !W.risk.has(b.item.id)).map(b => b.item.title);
    flags.push({ type: r.state === "missed" ? "income_missed" : "income_late", id: `inc-${r.item.id}`, row: r, lowWithout: full.low, lowWith: W.low, putsAtRisk });
  }
  for (const r of rows.filter(x => (x.state === "late" || x.state === "missed") && !(x.amount > 0 && x.item.kind !== "transfer"))) {
    flags.push({ type: r.state === "missed" ? "missed" : "late", id: `late-${r.item.id}`, row: r });
  }
  // a separate At-risk chip only while the combined balance is still positive (else it's inside Shortfall)
  for (const r of riskRows.filter(x => !inShort(x))) flags.push({ type: "risk", id: `risk-${r.item.id}`, row: r, accountId: r.risk!.accountId, short: r.risk!.short });

  // ── 4. days + grouping ──
  const inView = (r: RundownRow) => {
    if (viewIds.length === on.size) return true;
    return (!!r.item.accountId && view.has(r.item.accountId)) || (!!r.item.toAccountId && view.has(r.item.toAccountId));
  };
  const perShortOn = (r: RundownRow) => !!r.item.accountId && riskRows.some(x => x.day === r.day && x.item.accountId === r.item.accountId);
  const group = (list: RundownRow[], key: string): RundownEntry[] => {
    const small = list.filter(r => r.amount < 0 && Math.abs(r.amount) < RUNDOWN_SMALL && r.item.kind !== "income" && r.item.kind !== "transfer" && !r.flagged && !perShortOn(r));
    const out: RundownEntry[] = [];
    if (small.length < 2) return list.map(row => ({ kind: "row", row }));
    let placed = false;
    for (const r of list) {
      if (!small.includes(r)) { out.push({ kind: "row", row: r }); continue; }
      if (!placed) { placed = true; out.push({ kind: "group", key, rows: small, total: small.reduce((s, x) => s + (x.state === "skipped" ? 0 : x.amount), 0) }); }
    }
    return out;
  };
  const daysOut: RundownDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const list = ordered(rows.filter(r => inView(r) && (
      r.day === date && (r.counts || r.state === "skipped" || r.state === "paid" || r.state === "received" || r.state === "pending")
      || (i === 0 && r.amount > 0 && (r.state === "late" || r.state === "missed")) // late income shows on Today
    )));
    daysOut.push({ date, eod: P.eod[i], entries: group(list, `d${i}`) });
  }

  // ── 5. recent (actual): walk back from the current balance over posted transactions ──
  const recent: RecentDay[] = [];
  let walk = P.start;
  const viewTx = input.txns.filter(t => !t.pending && t.accountId && view.has(t.accountId));
  for (let k = 1; k <= RECENT_DAYS; k++) {
    const date = addDays(today, -k);
    // balance at end of `date` = start minus everything posted after it
    walk -= viewTx.filter(t => t.date === addDays(date, 1)).reduce((s, t) => s + t.amount, 0);
    const list = ordered(rows.filter(r => inView(r) && r.date === date && !r.counts && r.state !== "late" && r.state !== "missed"))
      .concat(ordered(rows.filter(r => inView(r) && r.date === date && (r.state === "late" || r.state === "missed"))));
    recent.unshift({ date, actualEod: walk, entries: group(list, `r${k}`) });
  }

  const horizon = (r: RundownRow) => r.counts && r.day >= today && r.day <= last;
  const internal = (r: RundownRow) => r.item.kind === "transfer" || (!!r.item.toAccountId && on.has(r.item.toAccountId));
  const incomeExpected = rows.filter(r => horizon(r) && inView(r) && r.amount > 0 && !internal(r)).reduce((s, r) => s + r.amount, 0);
  const billsDue = rows.filter(r => horizon(r) && inView(r) && r.amount < 0 && !internal(r)).reduce((s, r) => s + r.amount, 0);
  const incomeReceived = rows.filter(r => inView(r) && r.state === "received" && r.date >= addDays(today, -RECENT_DAYS) && r.date <= last).reduce((s, r) => s + r.amount, 0);

  return {
    today, days, start: P.start, buffer: settings.buffer, reserve, spendable: [...on], view: viewIds,
    daysOut, eod: P.eod, low: P.low, lowDate: addDays(today, P.lo), flags, incomeExpected, billsDue, incomeReceived, recent, rows,
  };
}

/** Projection low if one item were moved/re-amounted (detail "Edit" preview). */
export function previewEdit(input: RundownInput, itemId: string, override: { date?: string; amount?: number }): { low: number; lowDate: string } {
  const items = input.items.map(it => (it.id === itemId ? { ...it, override: { ...it.override, ...override }, status: "expected" as const } : it));
  const r = buildRundown({ ...input, items });
  return { low: r.low, lowDate: r.lowDate };
}

/** Rows of a group key ("d3" / "r1") — for the mobile group sheet. */
export function findGroup(r: RundownResult, key: string): Extract<RundownEntry, { kind: "group" }> | null {
  for (const d of [...r.daysOut, ...r.recent]) for (const e of d.entries) if (e.kind === "group" && e.key === key) return e;
  return null;
}
