/**
 * One Financial Picture: where the money goes, taxes paid and saved, and
 * rule-based recommendations. Pure; every number comes from data the app
 * already has (transactions → recurring review, payroll deductions, settings)
 * and every tax figure is an estimate with its assumptions spelled out.
 */
import { addDays, diffDays, type ISODate } from "@/lib/recurring/dates";
import type { ReviewItem } from "@/lib/recurring/review";
import type { MatchStatus, TaxSaverNumbers, TaxSnapshot } from "./tax";
import { CATEGORY_LABEL, PLAN_CADENCE_LABEL, sinkingFund, type Obligation, type ObligationCategory } from "./obligations";

const r0 = (n: number) => Math.round(n);
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── Where the money goes ────────────────────────────────────────────────────

export type AllocationKey = "taxes" | "retirement" | "hsa" | "stock" | "savings" | "investments" | "housing" | "debt" | "bills" | "spending" | "left";
export const ALLOCATION_LABEL: Record<AllocationKey, string> = {
  taxes: "Income tax & FICA (est.)", retirement: "401(k) & retirement", hsa: "HSA", stock: "Company stock (ESPP/RSU)",
  savings: "Savings & sinking pools", investments: "Investments", housing: "Rent, mortgage & HOA", debt: "Loans & card payoff",
  bills: "Other bills & set-asides", spending: "Budgeted spending", left: "Unplanned / left over",
};
export interface AllocationSlice { key: AllocationKey; label: string; monthly: number; share: number }
export interface Allocation { basis: "gross" | "take-home"; income: number; slices: AllocationSlice[] }

export interface AllocationInput {
  grossMonthly: number;
  takeHomeMonthly: number;
  taxMonthly: number;
  payroll: { k401: number; hsa: number; espp: number; rsu: number };
  /** Savings rows: monthly transfers and what kind of account they land in. */
  savings: { monthly: number; toSubtype?: string | null; toType?: string | null }[];
  obligations: readonly Obligation[];
  budgetsMonthly: number;
}

const RETIRE = /^(401k|403b|401a|457b|ira|roth|roth 401k|sep ira|simple ira|pension|retirement)$/;

/**
 * Share of pay per destination. On gross pay (when known) taxes and payroll
 * deductions are slices too; otherwise everything is a share of take-home.
 */
export function moneyAllocation(i: AllocationInput): Allocation {
  const gross = i.grossMonthly > 0;
  const income = gross ? i.grossMonthly : i.takeHomeMonthly;
  const m: Record<AllocationKey, number> = { taxes: 0, retirement: 0, hsa: 0, stock: 0, savings: 0, investments: 0, housing: 0, debt: 0, bills: 0, spending: 0, left: 0 };
  if (gross) { m.taxes = i.taxMonthly; m.retirement = i.payroll.k401; m.hsa = i.payroll.hsa; m.stock = i.payroll.espp + i.payroll.rsu; }
  for (const s of i.savings) {
    const sub = (s.toSubtype ?? "").toLowerCase();
    if (RETIRE.test(sub)) m.retirement += s.monthly;
    else if (sub === "hsa") m.hsa += s.monthly;
    else if ((s.toType ?? "").toLowerCase() === "investment" || sub === "brokerage") m.investments += s.monthly;
    else m.savings += s.monthly;
  }
  for (const ob of i.obligations) {
    if (ob.noCost) continue;
    const k: AllocationKey = ob.category === "housing" ? "housing" : ob.category === "debt" ? "debt" : "bills";
    m[k] += ob.monthly;
  }
  m.spending = i.budgetsMonthly;
  const used = (Object.keys(m) as AllocationKey[]).filter(k => k !== "left").reduce((s, k) => s + m[k], 0);
  m.left = income - used;
  const slices = (Object.keys(m) as AllocationKey[])
    .filter(k => k === "left" || m[k] > 0.5)
    .map(k => ({ key: k, label: ALLOCATION_LABEL[k], monthly: Math.round(m[k] * 100) / 100, share: income > 0 ? Math.round((m[k] / income) * 1000) / 10 : 0 }));
  return { basis: gross ? "gross" : "take-home", income, slices };
}

// ── Taxes ───────────────────────────────────────────────────────────────────

export interface TaxSummary {
  /** Federal income tax + FICA withheld from pay, per year (estimate from gross). */
  withheld: number;
  fed: number;
  fica: number;
  /** Estimated / IRS / state tax payments seen in the last 12 months. */
  estimatedPayments: number;
  propertyTax: number;
  /** Federal tax pre-tax 401(k) and HSA save this year (estimate). */
  preTaxSaved: number;
  k401Saves: number;
  hsaSaves: number;
  marginalRate: number;
  standardDeduction: number;
  assumptions: string[];
  /** Things we can't see and you'd need to type in for a fuller picture. */
  missing: string[];
}

const paidWithin = (items: readonly ReviewItem[], today: ISODate, test: (it: ReviewItem) => boolean) =>
  items.filter(test).flatMap(it => it.matched).filter(t => diffDays(today, t.date) <= 365 && t.date <= today).reduce((s, t) => s + Math.abs(t.amount), 0);

export function taxSummary(i: {
  today: ISODate; year: number; gross: number; grossEstimated: boolean; filing: "single" | "married_joint"; filingSet: boolean;
  tax: TaxSnapshot; savers: TaxSaverNumbers; reviewItems: readonly ReviewItem[]; hsaMonthly: number; k401Monthly: number;
}): TaxSummary {
  const isTax = (it: ReviewItem) => it.kind === "tax" && it.status !== "dismissed";
  const estimatedPayments = paidWithin(i.reviewItems, i.today, it => isTax(it) && it.subtype !== "property");
  const propertyTax = paidWithin(i.reviewItems, i.today, it => it.status !== "dismissed" && (it.subtype === "property" || /property\s*tax|county\s*treas|tax\s*collector/i.test(it.label)));
  const assumptions = [
    `${i.year} federal brackets, ${i.filing === "single" ? "single" : "married filing jointly"}${i.filingSet ? "" : " (assumed; change it in the Taxes detail)"}, standard deduction ${usd(i.tax.standardDeduction)}.`,
    `Gross pay ${usd(i.gross)}/yr${i.grossEstimated ? ", estimated from your take-home deposits" : ", as you entered it"}.`,
    "Pre-tax 401(k) and HSA amounts come from the paycheck deductions we detected or you entered.",
    "State and local income tax are not included. Estimates, not tax advice.",
  ];
  const missing: string[] = [];
  if (i.grossEstimated) missing.push("Your gross salary (we estimate it from take-home pay)");
  if (!i.filingSet) missing.push("Your filing status (we assume single)");
  if (i.k401Monthly <= 0) missing.push("Your 401(k) contribution % (no payroll 401(k) deduction found)");
  missing.push("FSA contributions (not visible in bank data)");
  missing.push("Mortgage interest paid (needs your Form 1098; payments mix interest and principal)");
  return {
    withheld: r0(i.tax.fed + i.tax.fica), fed: r0(i.tax.fed), fica: r0(i.tax.fica), estimatedPayments: r0(estimatedPayments), propertyTax: r0(propertyTax),
    preTaxSaved: r0(i.savers.now), k401Saves: r0(i.savers.k401Saves), hsaSaves: r0(i.savers.hsaSaves), marginalRate: i.tax.rate, standardDeduction: i.tax.standardDeduction,
    assumptions, missing,
  };
}

// ── Recommendations ─────────────────────────────────────────────────────────

export type RecTone = "save" | "warn" | "info";
export type RecAction = "review" | "match" | "taxes" | "upcoming" | "giftcards";
export interface Recommendation { id: string; tone: RecTone; title: string; why: string; action?: RecAction }

export interface RecInput {
  today: ISODate;
  obligations: readonly Obligation[];
  toReview: number;
  cash: number;
  /** Lowest point of cash over the next 30 days and when. */
  low?: { date: ISODate; balance: number } | null;
  match: MatchStatus;
  savers: TaxSaverNumbers;
  gross: number;
  k401Annual: number;
  year: number;
  /** Utility payments (any time), to compare the last 3 months with a year earlier. */
  utilityPayments: { date: ISODate; amount: number }[];
  giftCardsExpiringSoon: number;
  dismissed: readonly string[];
}

/** Rule-based and explainable: each one says why. Dismissed ids (settings.dismissedInsights) never show again. */
export function recommendations(i: RecInput): Recommendation[] {
  const out: Recommendation[] = [];
  const costs = i.obligations.filter(o => !o.noCost);

  const missed = costs.filter(o => o.missed);
  if (missed.length) out.push({ id: `rec:missed:${missed.map(o => o.id).sort().join(",")}`, tone: "warn", title: `${missed.length} expected payment${missed.length === 1 ? " hasn't" : "s haven't"} shown up`, why: `${missed.slice(0, 3).map(o => o.label).join(", ")}${missed.length > 3 ? "…" : ""} ${missed.length === 1 ? "was" : "were"} due and no matching payment was seen. Check it was paid from another account.`, action: "upcoming" });

  if (i.low && i.low.balance < 0) out.push({ id: `rec:short:${i.low.date}`, tone: "warn", title: `Cash may run short around ${shortDate(i.low.date)}`, why: `Expected bills and pay over the next 30 days take checking and savings to about ${i.low.balance < 0 ? "−" : ""}${usd(i.low.balance)} on ${shortDate(i.low.date)}.`, action: "upcoming" });

  // Sinking funds for the biggest non-monthly bills.
  const sinks = costs.map(o => ({ o, f: sinkingFund(o, i.today) })).filter(x => x.f && x.o.amount >= 100 && x.o.source !== "detected").sort((a, b) => b.o.amount - a.o.amount).slice(0, 3);
  for (const { o, f } of sinks) {
    out.push({ id: `rec:sink:${o.id}`, tone: "save", title: `Set aside ${usd(f!.perMonth)}/mo for ${o.label}`, why: `${o.label} is about ${usd(o.amount)} ${PLAN_CADENCE_LABEL[o.cadence].toLowerCase()}${o.nextDue ? `, next due ${shortDate(o.nextDue)}` : ""}. Putting ${usd(f!.perMonth)} a month into savings covers it without a hit to one paycheck${f!.toBeReady > f!.perMonth + 1 ? ` (${usd(f!.toBeReady)}/mo if you start from zero now)` : ""}.` });
  }

  if (i.match.answer === "yes" && i.match.missing > 0) out.push({ id: "rec:match", tone: "save", title: `You may be leaving ${usd(i.match.missing)}/yr of 401(k) match`, why: `You put in about ${i.match.yourPct.toFixed(1)}% of pay; your employer matches up to ${i.match.upToPct}%. Raising your contribution to ${i.match.upToPct}% gets the full match.`, action: "match" });
  else if (!i.match.answered && i.gross > 0) out.push({ id: "rec:match-ask", tone: "info", title: "Do you get a 401(k) match?", why: "Tell us once and we'll check you're putting in enough to get all of it.", action: "match" });

  if (i.gross > 0 && i.savers.k401Room > 500) {
    const pct = i.gross > 0 ? (i.k401Annual / i.gross) * 100 : 0;
    out.push({ id: `rec:401k:${i.year}`, tone: "save", title: `${usd(i.savers.k401Room)} of 401(k) room left for ${i.year}`, why: `You're contributing about ${pct.toFixed(1)}% of gross pay (${usd(i.k401Annual)}/yr, from your paycheck deductions). Every extra $1,000 pre-tax cuts this year's federal tax by roughly ${usd(1000 * (i.savers.k401Saves > 0 && i.k401Annual > 0 ? i.savers.k401Saves / i.k401Annual : 0.22))} (estimate).`, action: "taxes" });
  }
  if (i.savers.hsaRoom > 200 && i.savers.hsaSaves > 0) out.push({ id: `rec:hsa:${i.year}`, tone: "save", title: `${usd(i.savers.hsaRoom)} of HSA room left for ${i.year}`, why: `HSA money goes in pre-tax and comes out tax-free for medical costs. Your current HSA saves about ${usd(i.savers.hsaSaves)}/yr in federal tax (estimate, self-only limit ${usd(i.savers.hsaLimit)}).`, action: "taxes" });

  // Utilities vs a year ago (same 3-month window).
  const recent = i.utilityPayments.filter(p => diffDays(i.today, p.date) >= 0 && diffDays(i.today, p.date) < 91).reduce((s, p) => s + p.amount, 0);
  const lastYear = i.utilityPayments.filter(p => { const d = diffDays(i.today, p.date); return d >= 365 && d < 456; }).reduce((s, p) => s + p.amount, 0);
  if (recent > 0 && lastYear > 0) {
    const ch = (recent - lastYear) / lastYear;
    if (ch >= 0.15) out.push({ id: `rec:util:${i.today.slice(0, 7)}`, tone: "warn", title: `Utilities up ${Math.round(ch * 100)}% vs last year`, why: `You paid ${usd(recent)} for utilities in the last 3 months, against ${usd(lastYear)} in the same months last year. Worth checking rates or usage.` });
  }

  // Cash buffer in weeks of obligations.
  const weekly = costs.reduce((s, o) => s + o.monthly, 0) * 12 / 52;
  if (weekly > 0) {
    const weeks = Math.floor(i.cash / weekly);
    out.push({ id: `rec:buffer:${weeks < 4 ? "low" : weeks < 13 ? "mid" : "ok"}`, tone: weeks < 4 ? "warn" : "info", title: `Your cash covers about ${weeks} week${weeks === 1 ? "" : "s"} of bills`, why: `${usd(i.cash)} in checking and savings against about ${usd(weekly)} a week of expected expenses${weeks < 13 ? ". Many people aim for 3–6 months." : "."}` });
  }

  if (i.toReview > 0) out.push({ id: `rec:review:${i.toReview}`, tone: "info", title: `Review ${i.toReview} detected bill${i.toReview === 1 ? "" : "s"}`, why: "We found these repeating in your transactions. Confirm the real ones so your plan and totals are complete.", action: "review" });
  if (i.giftCardsExpiringSoon > 0) out.push({ id: `rec:gift:${i.today.slice(0, 7)}`, tone: "info", title: `${i.giftCardsExpiringSoon} gift card${i.giftCardsExpiringSoon === 1 ? " expires" : "s expire"} within 30 days`, why: "Use the balance before it's gone.", action: "giftcards" });

  const gone = new Set(i.dismissed);
  return out.filter(r => !gone.has(r.id));
}

export const categoryLabel = (c: ObligationCategory) => CATEGORY_LABEL[c];
export const daysUntil = (d: ISODate, today: ISODate) => diffDays(d, today);
export const dueSoon = (ob: Obligation, today: ISODate, days = 7) => !!ob.nextDue && ob.nextDue >= today && ob.nextDue <= addDays(today, days);
