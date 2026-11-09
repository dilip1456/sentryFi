/**
 * "Detected recurring" review for My Financial Picture.
 *
 *   detectRecurringSeries (grouped by canonical payee / employer + direction,
 *   card payments and savings transfers kept)
 *     ─▶ policy: what may count as recurring (no ad-hoc spending), minimum
 *        evidence (3+, insurance & tax 2+, income across 3+ months), amount
 *        tolerance (fixed, or a band for utilities)
 *     ─▶ dedupe (one mortgage, one employer)
 *     ─▶ the person's decisions (confirmed / edited / dismissed) win
 *
 * Pure: no React, no network. The detector, schedule fitting and amount model
 * all live in this folder; this file only decides what to show and how.
 */
import type { ClassifierAccount, ClassifierTxn, TransactionClassifier, TxnClassification, TxnTypeOverride } from "./classifier";
import { addDays, diffDays, parseDate, type ISODate } from "./dates";
import { detectRecurringSeries, type RecurringSeries, type SeriesKind } from "./detect";
import { billSubtype, loanSubtype } from "./patterns";
import { employerKey, employerLabel, isP2PText, payeeKey } from "./payee";
import { CADENCES, type Cadence, type Schedule } from "./schedule";

export const REVIEW_GROUPS = ["income", "bills", "insurance_tax", "payments", "savings"] as const;
export type ReviewGroup = (typeof REVIEW_GROUPS)[number];
export const REVIEW_GROUP_LABEL: Record<ReviewGroup, string> = {
  income: "Income",
  bills: "Bills & utilities",
  insurance_tax: "Insurance & tax",
  payments: "Payments & loans",
  savings: "Savings",
};
export type ReviewStatus = "suggested" | "confirmed" | "dismissed";

export const PER_YEAR_CADENCE: Record<Cadence, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 };
export const monthlyEquivalent = (amount: number, cadence: Cadence) => Math.round(((amount * PER_YEAR_CADENCE[cadence]) / 12) * 100) / 100;

/** What the person decided about one item. Stored per user (recurring_streams, source 'picture'). */
export interface RecurringDecision {
  key: string;
  status: ReviewStatus;
  /** User edits; null/undefined = keep what detection found. */
  cadence?: Cadence | null;
  /** Typical amount per occurrence (positive). */
  amount?: number | null;
  group?: ReviewGroup | null;
  coverAccountId?: string | null;
  decidedAt?: string | null;
  /** Snapshot so a decided item can still be listed when detection no longer finds it. */
  snapshot?: Partial<Pick<ReviewItem, "label" | "group" | "kind" | "cadence" | "amount" | "lastSeen" | "nextDue" | "transactionIds" | "pattern" | "accountId" | "direction">>;
}

export interface MatchedTxn { id: string; date: ISODate; amount: number; name: string; accountId: string }

export interface ReviewItem {
  key: string;
  group: ReviewGroup;
  kind: SeriesKind;
  subtype: string | null;
  direction: "inflow" | "outflow";
  label: string;
  /** "semi-monthly on the 15th and last day", "every 2 weeks on Fridays", "every 6 months (Jan & Jul)". */
  pattern: string;
  cadence: Cadence;
  /** Typical amount per occurrence, positive. */
  amount: number;
  amountKind: "fixed" | "variable";
  amountRange: [number, number];
  monthly: number;
  lastSeen: ISODate;
  nextDue: ISODate | null;
  occurrences: number;
  confidence: number;
  transactionIds: string[];
  matched: MatchedTxn[];
  accountId: string | null;
  coverAccountId: string | null;
  /** The covering account came from the person, not detection. */
  coverUserSet: boolean;
  status: ReviewStatus;
  /** True when the person changed cadence, amount, group or covering account. */
  edited: boolean;
  /** A confirmed item whose latest expected payment didn't arrive in its grace window. */
  missed: boolean;
  daysLate: number | null;
  /** Plain-English "How we found this". */
  why: string;
  /** What detection alone found (before edits), for "Reset". */
  detected: { cadence: Cadence; amount: number; group: ReviewGroup } | null;
}

export interface ReviewResult {
  /** Suggested + confirmed items, grouped order. */
  items: ReviewItem[];
  dismissed: ReviewItem[];
  series: RecurringSeries[];
}

export interface ReviewOptions {
  today: ISODate;
  classifier?: TransactionClassifier;
  overrides?: TxnTypeOverride[];
  decisions?: RecurringDecision[];
  /** Category text for a transaction (the app's effective category), used to keep ad-hoc spending out. */
  categoryOf?: (t: ClassifierTxn) => string | null | undefined;
  /** Linked accounts, for "Transfers to <account>" labels. */
  accounts?: ClassifierAccount[];
}

// ── Policy ────────────────────────────────────────────────────────────────

/** Ad-hoc spending: never recurring, even when the same merchant repeats. */
export const ADHOC_RE =
  /\bfood|dining|restaurant|grocer|supermarket|coffee|fast[_ ]?food|bakery|\bbars?\b|alcohol|general[_ ]merchandise|shopping|clothing|apparel|department[_ ]store|electronics|sporting[_ ]goods|transportation[_ ]gas|gas[_ ]stations?|\bfuel\b|convenience|personal[_ ]care|home[_ ]improvement|rideshare|\btaxi|parking|\btravel|\bairline|lodging|\bhotel/i;
/** Subscriptions and memberships are the exception to ad-hoc merchants. */
export const SUBSCRIPTION_RE =
  /subscri|membership|member\s?fee|\bgym\b|fitness|netflix|spotify|hulu|disney\s*\+?|\bhbo\b|max\.com|youtube\s*(premium|tv)|apple\.com\/bill|icloud|amazon\s*prime|prime\s*video|audible|patreon|adobe|microsoft\s*365|google\s*(storage|one)|dropbox|peloton|costco\s*(member|annual)|sam'?s\s*club|walmart\+|dashpass|uber\s*one|instacart\s*\+|siriusxm|\bnyt\b|duolingo|chatgpt|openai|onlyfans|xbox\s*game\s*pass|playstation\s*plus|nintendo\s*online/i;
const INSURANCE_RE = /\binsurance\b|\bins\b|geico|state\s*farm|progressive|allstate|liberty\s*mutual|usaa|lemonade|nationwide|farmers\s*ins|travelers|metlife|prudential|aflac|northwestern\s*mutual|new\s*york\s*life|guardian\s*life|root\s*ins/i;
const INTERNAL_INFLOW_SUBTYPES = new Set(["account_transfer", "from_savings", "from_investments", "loan_proceeds", "refund", "cash_advance"]);
const INTERNAL_INFLOW_RE =
  /\b(internal|account)\s+(transfer|xfer)\b|\bonline\s+(transfer|xfer)\b|\btransfer\s+between\s+accounts\b|\bfrom\s+(checking|chk|savings|sav|brokerage|investment)\b|\b(cash\s+advance|loan\s+proceeds)\b/i;

/** Max coefficient of variation of amounts for an item to count as one pattern. */
function amountTolerance(group: ReviewGroup, kind: SeriesKind, subtype: string | null): number {
  if (kind === "bill" && (subtype === "utility" || subtype === "phone" || subtype === "internet")) return 0.6;
  if (group === "insurance_tax") return 0.6; // estimated taxes / premiums change year to year
  if (kind === "card_payment") return 1.5; // card payments follow the statement balance
  if (group === "income") return 0.35; // overtime, shift differentials
  if (kind === "bill") return 0.45;
  return 0.25;
}

export function groupFor(kind: SeriesKind, subtype: string | null, text: string): ReviewGroup {
  switch (kind) {
    case "salary": case "income": case "interest": return "income";
    case "tax": return "insurance_tax";
    case "savings": return "savings";
    case "loan": case "card_payment": case "transfer": return "payments";
    default:
      if (subtype === "insurance" || INSURANCE_RE.test(text)) return "insurance_tax";
      return "bills";
  }
}

const minOccurrences = (group: ReviewGroup) => (group === "insurance_tax" ? 2 : 3);

// ── Labels ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
const dayWord = (d: number) => (d >= 31 ? "last day" : ordinal(d));
export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every 6 months", yearly: "Yearly",
};

/** A plain-English pattern label from a fitted schedule. */
export function patternLabel(s: Schedule | null, cadence: Cadence): string {
  if (!s || s.cadence !== cadence) return CADENCE_LABEL[cadence];
  switch (s.kind) {
    case "interval": {
      const wd = WEEKDAYS[new Date(`${s.phaseDay}T00:00:00Z`).getUTCDay()];
      return s.intervalDays === 7 ? `Weekly on ${wd}` : `Every 2 weeks on ${wd}`;
    }
    case "semimonthly": {
      const [a, b] = [...s.anchorDays].sort((x, y) => x - y);
      return `Semi-monthly on the ${dayWord(a)} and ${b >= 31 ? "last day" : dayWord(b)}`;
    }
    case "irs-estimated": return "Quarterly on IRS estimated-tax dates (Apr, Jun, Sep, Jan)";
    case "day-of-month": {
      if (s.monthStep === 1) return `Monthly on the ${dayWord(s.anchorDay)}`;
      const months: string[] = [];
      for (let i = 0; i < 12 / s.monthStep; i++) months.push(MONTHS[(s.anchorMonth - 1 + i * s.monthStep) % 12]);
      months.sort((x, y) => MONTHS.indexOf(x) - MONTHS.indexOf(y));
      if (s.monthStep === 12) return `Yearly in ${months[0]} (around the ${dayWord(s.anchorDay)})`;
      if (s.monthStep === 6) return `Every 6 months (${months.join(" & ")})`;
      return `Quarterly (${months.join(", ")})`;
    }
  }
}

// ── Building items ────────────────────────────────────────────────────────

/** Grouping key handed to the detector: one employer per paycheck series, one payee otherwise. */
export function reviewKeyOf(t: ClassifierTxn, c: TxnClassification): string {
  const p = { name: t.name ?? null, merchant_name: t.merchant_name ?? null };
  if (c.txnType === "income_salary") return `pay:${employerKey(p)}`;
  // Savings transfers group by destination account so two goals stay two goals.
  if (c.txnType === "savings_contribution" && c.counterpartAccountId) return `save:${c.counterpartAccountId}`;
  return payeeKey(p);
}

const baseKey = (k: string) => k.replace(/\|~\d+$/, "");
const round2 = (n: number) => Math.round(n * 100) / 100;

function typicalAmount(s: RecurringSeries): number {
  return round2(Math.abs(s.amount.expected || s.amount.median));
}

function latestDue(s: RecurringSeries, today: ISODate): { late: boolean; daysLate: number | null } {
  const past = s.occurrences.filter(o => o.expectedDate <= today && o.status !== "expected");
  const last = past[past.length - 1];
  if (!last) return { late: !s.active, daysLate: null };
  if (last.status === "late") return { late: true, daysLate: last.daysLate ?? diffDays(today, last.expectedDate) };
  return { late: !s.active, daysLate: null };
}

function whyText(s: RecurringSeries, group: ReviewGroup, pattern: string, amountKind: "fixed" | "variable", range: [number, number]): string {
  const n = s.occurrenceCount;
  const amt = amountKind === "fixed"
    ? `the same amount each time (about $${Math.round(range[1]).toLocaleString("en-US")})`
    : `amounts between $${Math.round(range[0]).toLocaleString("en-US")} and $${Math.round(range[1]).toLocaleString("en-US")}`;
  const span = `${MONTHS[parseDate(s.firstSeen).m - 1]} ${parseDate(s.firstSeen).y} to ${MONTHS[parseDate(s.lastSeen).m - 1]} ${parseDate(s.lastSeen).y}`;
  const kindWord = group === "income" ? "deposits" : "payments";
  return `${n} ${kindWord} from ${span}, ${pattern.charAt(0).toLowerCase()}${pattern.slice(1)}, with ${amt}. Confidence ${Math.round(s.confidence * 100)}%.`;
}

interface Draft { s: RecurringSeries; group: ReviewGroup; label: string; amount: number; key: string; transactionIds: string[]; text: string }

/**
 * Merge two detections of one real thing:
 *  - the same loan / bill reported under two descriptors (dates and amounts line up) → keep one;
 *  - one paycheck split across two accounts (dates line up, amounts differ) → add them.
 */
function alignedShare(a: RecurringSeries, b: RecurringSeries): number {
  const bd = b.occurrences.filter(o => o.actualDate).map(o => o.actualDate!);
  const ad = a.occurrences.filter(o => o.actualDate).map(o => o.actualDate!);
  if (!ad.length || !bd.length) return 0;
  const hits = ad.filter(d => bd.some(x => Math.abs(diffDays(d, x)) <= 4)).length;
  return hits / Math.min(ad.length, bd.length);
}

function dedupe(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  const sorted = [...drafts].sort((a, b) => b.s.occurrenceCount - a.s.occurrenceCount || b.amount - a.amount);
  for (const d of sorted) {
    const twin = out.find(o => {
      if (o.group !== d.group || o.s.direction !== d.s.direction || o.s.cadence !== d.s.cadence) return false;
      const sameBase = baseKey(o.key) === baseKey(d.key);
      const sameEmployer = o.s.kind === "salary" && d.s.kind === "salary" && o.key.split("|")[1] === d.key.split("|")[1];
      const sameLoan = o.s.kind === "loan" && d.s.kind === "loan" && !!o.s.subtype && o.s.subtype === d.s.subtype;
      const sameBrand = o.key.split("|")[1]?.split(" ")[0] === d.key.split("|")[1]?.split(" ")[0];
      if (!(sameBase || sameEmployer || sameLoan || sameBrand)) return false;
      return alignedShare(o.s, d.s) >= 0.6;
    });
    if (!twin) { out.push({ ...d }); continue; }
    const close = Math.abs(twin.amount - d.amount) / Math.max(twin.amount, d.amount) <= 0.05;
    if (!close && twin.s.kind === "salary") twin.amount = round2(twin.amount + d.amount); // split deposit
    else if (!close) { out.push({ ...d }); continue; } // same payee, different amount: two bills
    twin.transactionIds = [...new Set([...twin.transactionIds, ...d.transactionIds])];
  }
  // A payee left with one item keeps its plain key, so decisions survive an amount change.
  const perBase = new Map<string, number>();
  for (const o of out) perBase.set(baseKey(o.key), (perBase.get(baseKey(o.key)) ?? 0) + 1);
  for (const o of out) if (perBase.get(baseKey(o.key)) === 1) o.key = baseKey(o.key);
  return out;
}
const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());

/** Turn detector output into review drafts, applying the recurring policy. */
export function reviewDrafts(series: RecurringSeries[], txnById: Map<string, ClassifierTxn>, opts: Pick<ReviewOptions, "categoryOf" | "today" | "accounts">): Draft[] {
  const acctName = new Map((opts.accounts ?? []).map(a => [a.account_id, a.name ?? null] as const));
  const drafts: Draft[] = [];
  const baseCount = new Map<string, number>();
  for (const s of series) baseCount.set(baseKey(s.seriesKey), (baseCount.get(baseKey(s.seriesKey)) ?? 0) + 1);
  for (const s of series) {
    const members = s.transactionIds.map(id => txnById.get(id)).filter(Boolean) as ClassifierTxn[];
    if (!members.length) continue;
    const text = members.map(t => `${t.name ?? ""} ${t.merchant_name ?? ""}`).join(" ");
    const catText = members.map(t => [opts.categoryOf?.(t), t.pfc_primary, t.pfc_detailed, ...(t.category ?? [])].filter(Boolean).join(" ")).join(" ");
    const subtype = s.subtype ?? (s.kind === "loan" ? loanSubtype(text) : billSubtype(text));
    const group = groupFor(s.kind, subtype, `${text} ${catText}`);

    // Ad-hoc spending is never recurring; subscriptions and memberships are.
    const spendLike = s.txnType === "spend" || s.kind === "subscription";
    if (spendLike && !billSubtype(text) && !INSURANCE_RE.test(text)) {
      if (ADHOC_RE.test(catText) && !SUBSCRIPTION_RE.test(text)) continue;
      // A "subscription" bills the same price; a varying spend at one merchant is shopping.
      if (s.amount.cv > 0.1 && !SUBSCRIPTION_RE.test(text)) continue;
    }
    // Internal movement and refunds are not income.
    if (s.direction === "inflow") {
      if (s.subtype && INTERNAL_INFLOW_SUBTYPES.has(s.subtype)) continue;
      if (s.kind === "income" && INTERNAL_INFLOW_RE.test(text)) continue;
    }
    // Evidence.
    if (s.occurrenceCount < minOccurrences(group)) continue;
    if (s.amount.cv > amountTolerance(group, s.kind, subtype)) continue;
    if (group === "income") {
      const months = new Set(members.map(t => t.date.slice(0, 7)));
      if (months.size < 3 || diffDays(s.lastSeen, s.firstSeen) < 56) continue;
    }
    if (!s.active) continue; // ended series aren't recurring now (a confirmed one is kept below as "missed")

    const last = members[members.length - 1];
    const p2p = isP2PText({ name: last.name ?? null, merchant_name: last.merchant_name ?? null });
    const payee = baseKey(s.seriesKey).split("|")[1] ?? "";
    const saveTo = payee.startsWith("save:") ? acctName.get(payee.slice(5)) : undefined;
    const label = saveTo ? `Transfers to ${saveTo}` : s.kind === "salary" ? employerLabel({ name: last.name ?? null, merchant_name: last.merchant_name ?? null })
      : p2p && payee && !/^(save|pay):/.test(payee) ? titleCase(payee) : s.displayName;
    // One amount cluster for a payee: drop the "|~bucket" so a price change keeps the same key.
    const key = baseCount.get(baseKey(s.seriesKey)) === 1 ? baseKey(s.seriesKey) : s.seriesKey;
    drafts.push({ s, group, label, amount: typicalAmount(s), key, transactionIds: [...s.transactionIds], text });
  }
  return dedupe(drafts);
}

function itemFromDraft(d: Draft, txnById: Map<string, ClassifierTxn>, today: ISODate): ReviewItem {
  const s = d.s;
  const range: [number, number] = [round2(Math.abs(s.amount.min)), round2(Math.abs(s.amount.max))];
  const amountKind = s.amount.isFixed || s.amount.cv <= 0.05 ? "fixed" : "variable";
  const pattern = patternLabel(s.schedule, s.cadence);
  const lateInfo = latestDue(s, today);
  const matched: MatchedTxn[] = d.transactionIds
    .map(id => txnById.get(id))
    .filter(Boolean)
    .map(t => ({ id: t!.transaction_id, date: t!.date, amount: Math.abs(t!.amount), name: t!.merchant_name || t!.name || "", accountId: t!.account_id }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    key: d.key,
    group: d.group,
    kind: s.kind,
    subtype: s.subtype,
    direction: s.direction,
    label: d.label,
    pattern,
    cadence: s.cadence,
    amount: d.amount,
    amountKind,
    amountRange: range,
    monthly: monthlyEquivalent(d.amount, s.cadence),
    lastSeen: matched[0]?.date ?? s.lastSeen,
    nextDue: s.nextExpectedDate,
    occurrences: matched.length,
    confidence: s.confidence,
    transactionIds: matched.map(m => m.id),
    matched,
    accountId: s.accountId,
    coverAccountId: s.direction === "outflow" ? s.accountId : null,
    coverUserSet: false,
    status: "suggested",
    edited: false,
    missed: false,
    daysLate: lateInfo.late ? lateInfo.daysLate : null,
    why: whyText(s, d.group, pattern, amountKind, range),
    detected: { cadence: s.cadence, amount: d.amount, group: d.group },
  };
}

/** Apply a stored decision on top of a detected (or remembered) item. */
export function applyDecision(item: ReviewItem, dec: RecurringDecision | undefined, today: ISODate): ReviewItem {
  if (!dec) return item;
  const cadence = dec.cadence && (CADENCES as readonly string[]).includes(dec.cadence) ? dec.cadence : item.cadence;
  const amount = dec.amount != null && dec.amount >= 0 ? round2(dec.amount) : item.amount;
  const group = dec.group && (REVIEW_GROUPS as readonly string[]).includes(dec.group) ? dec.group : item.group;
  const coverAccountId = dec.coverAccountId !== undefined && dec.coverAccountId !== null ? dec.coverAccountId : item.coverAccountId;
  const edited = cadence !== item.cadence || amount !== item.amount || group !== item.group || (dec.coverAccountId != null && dec.coverAccountId !== item.coverAccountId);
  const out: ReviewItem = {
    ...item,
    status: dec.status,
    cadence,
    amount,
    group,
    coverAccountId,
    coverUserSet: dec.coverAccountId != null,
    edited,
    monthly: monthlyEquivalent(amount, cadence),
    pattern: cadence !== item.cadence ? CADENCE_LABEL[cadence] : item.pattern,
  };
  // "Missed or late": only for things the person told us are real.
  if (out.status === "confirmed") {
    if (item.daysLate != null) out.missed = true;
    else if (item.nextDue && diffDays(today, item.nextDue) > (item.direction === "inflow" ? 3 : 6)) { out.missed = true; out.daysLate = diffDays(today, item.nextDue); }
  }
  return out;
}

/** An item rebuilt from a decision's snapshot (detection no longer finds it). */
function itemFromSnapshot(dec: RecurringDecision, txnById: Map<string, ClassifierTxn>, today: ISODate): ReviewItem | null {
  const sn = dec.snapshot ?? {};
  const cadence = (dec.cadence ?? sn.cadence) as Cadence | undefined;
  const group = (dec.group ?? sn.group) as ReviewGroup | undefined;
  if (!cadence || !group || !(CADENCES as readonly string[]).includes(cadence)) return null;
  const amount = round2(Math.abs(dec.amount ?? sn.amount ?? 0));
  const ids = sn.transactionIds ?? [];
  const matched = ids.map(id => txnById.get(id)).filter(Boolean)
    .map(t => ({ id: t!.transaction_id, date: t!.date, amount: Math.abs(t!.amount), name: t!.merchant_name || t!.name || "", accountId: t!.account_id }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastSeen = matched[0]?.date ?? sn.lastSeen ?? today;
  const nextDue = sn.nextDue ?? null;
  const kind = (sn.kind ?? "bill") as SeriesKind;
  const item: ReviewItem = {
    key: dec.key, group, kind, subtype: null, direction: sn.direction ?? (group === "income" ? "inflow" : "outflow"),
    label: sn.label ?? "Recurring item", pattern: sn.pattern ?? CADENCE_LABEL[cadence], cadence, amount, amountKind: "fixed", amountRange: [amount, amount],
    monthly: monthlyEquivalent(amount, cadence), lastSeen, nextDue, occurrences: matched.length, confidence: 0,
    transactionIds: matched.map(m => m.id), matched, accountId: sn.accountId ?? null, coverAccountId: dec.coverAccountId ?? sn.accountId ?? null,
    coverUserSet: dec.coverAccountId != null, status: dec.status, edited: dec.cadence != null || dec.amount != null || dec.group != null || dec.coverAccountId != null,
    missed: false, daysLate: null,
    why: "We no longer see this pattern in your recent transactions. It is listed because you made a decision about it.",
    detected: null,
  };
  if (dec.status === "confirmed") {
    // A confirmed item that stopped arriving: the next expected date has passed.
    const expected = nextDue ?? addDays(lastSeen, Math.round(365 / PER_YEAR_CADENCE[cadence]));
    const late = diffDays(today, expected);
    if (late > (item.direction === "inflow" ? 3 : 6)) { item.missed = true; item.daysLate = late; }
  }
  return item;
}

const GROUP_ORDER = new Map(REVIEW_GROUPS.map((g, i) => [g, i] as const));
const byGroupThenMonthly = (a: ReviewItem, b: ReviewItem) =>
  (GROUP_ORDER.get(a.group)! - GROUP_ORDER.get(b.group)!) || b.monthly - a.monthly || a.label.localeCompare(b.label);

/** Detected-series options the review uses (shared so callers can run detection once). */
export const REVIEW_DETECT_OPTIONS = { includeCardPayments: true, includeSavingsTransfers: true, keyOf: reviewKeyOf } as const;

/** Build the review from already-detected series (detected with REVIEW_DETECT_OPTIONS). */
export function buildReview(series: RecurringSeries[], txns: ClassifierTxn[], opts: ReviewOptions): ReviewResult {
  const txnById = new Map(txns.map(t => [t.transaction_id, t] as const));
  const decisions = new Map((opts.decisions ?? []).map(d => [d.key, d] as const));
  const items: ReviewItem[] = [];
  const dismissed: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const d of reviewDrafts(series, txnById, opts)) {
    const it = applyDecision(itemFromDraft(d, txnById, opts.today), decisions.get(d.key), opts.today);
    seen.add(d.key);
    (it.status === "dismissed" ? dismissed : items).push(it);
  }
  // Decisions about things detection no longer finds: a dismissed one stays
  // dismissed (and listed, so it can be restored); a confirmed one stays and
  // shows "Missed or late" once it is overdue.
  for (const dec of decisions.values()) {
    if (seen.has(dec.key) || dec.status === "suggested") continue;
    const it = itemFromSnapshot(dec, txnById, opts.today);
    if (!it) continue;
    (it.status === "dismissed" ? dismissed : items).push(it);
  }
  items.sort(byGroupThenMonthly);
  dismissed.sort(byGroupThenMonthly);
  return { items, dismissed, series };
}

/** Detect and review in one call (tests and non-React callers). */
export function reviewRecurring(txns: ClassifierTxn[], accounts: ClassifierAccount[], opts: ReviewOptions): ReviewResult {
  const series = detectRecurringSeries(txns, accounts, { today: opts.today, classifier: opts.classifier, overrides: opts.overrides, ...REVIEW_DETECT_OPTIONS });
  return buildReview(series, txns, { accounts, ...opts });
}

/** The decision to store for an action on an item (with a snapshot for later). */
export function decisionFor(item: ReviewItem, patch: Partial<Omit<RecurringDecision, "key" | "snapshot">>, now = new Date().toISOString()): RecurringDecision {
  return {
    key: item.key,
    status: patch.status ?? item.status,
    cadence: patch.cadence !== undefined ? patch.cadence : item.detected && item.cadence !== item.detected.cadence ? item.cadence : null,
    amount: patch.amount !== undefined ? patch.amount : item.detected && item.amount !== item.detected.amount ? item.amount : null,
    group: patch.group !== undefined ? patch.group : item.detected && item.group !== item.detected.group ? item.group : null,
    coverAccountId: patch.coverAccountId !== undefined ? patch.coverAccountId : item.edited && item.coverAccountId !== item.accountId ? item.coverAccountId : null,
    decidedAt: now,
    snapshot: {
      label: item.label, group: item.detected?.group ?? item.group, kind: item.kind, cadence: item.detected?.cadence ?? item.cadence,
      amount: item.detected?.amount ?? item.amount, lastSeen: item.lastSeen, nextDue: item.nextDue, transactionIds: item.transactionIds.slice(0, 60),
      pattern: item.pattern, accountId: item.accountId, direction: item.direction,
    },
  };
}
