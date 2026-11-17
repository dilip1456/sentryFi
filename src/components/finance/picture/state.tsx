/**
 * My Financial Picture: derived numbers + every write the page makes, shared by
 * the desktop columns, the mobile cards and all detail views via context.
 *
 * Writes go through one `onUpdate` call per user action, built from a working
 * copy of the current settings, so a multi-field save (the Edit form) can't
 * lose an earlier field to a stale read.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FinancialPictureData, FinancialPictureManualItem, ManualIncomeItem, SavingsGoal } from "@/hooks/useUserSettings";
import { FP_UNASSIGNED } from "@/lib/picture/keys";
import type { BankHistory } from "@/lib/relink/history";
import { useRecurringDecisions } from "@/hooks/useRecurringDecisions";
import { decisionFor, type RecurringDecision, type ReviewItem } from "@/lib/recurring";
import { buildPictureModel, ymd, type AcctInfo, type PAccount, type PClass, type PictureGroup, type PictureModel, type PictureRow, type PTxn, type CardInfo } from "@/lib/picture/model";
import { taxSnapshot, taxSaverNumbers, matchStatus, type MatchStatus, type TaxSnapshot, type TaxSaverNumbers, type EmployerMatch } from "@/lib/picture/tax";
import { savingsBreakdown, type SavingsBreakdown, type TierAccount } from "@/lib/picture/savings-breakdown";
import { riskNote, type RiskLevel, type RiskNote } from "@/lib/picture/risk";
import { coverage, coverageMap, type CoverageResult, type MapBox } from "@/lib/picture/coverage";
import { cashflowSteps, flowSplit, type FlowSplit, type WaterfallStep } from "@/lib/picture/cashflow";
import { giftCardSummary, netWorthBreakdown, savingsRate, upcomingWindow, type GiftCardLike, type GiftCardSummary, type ManualAccountLike, type NetWorth, type SavingsRate, type UpcomingWindow } from "@/lib/picture/overview";
import { accountedFor, buildObligations, categorize, categoryTotals, perYear, project, type AccountedFor, type CategoryTotal, type ManualObligationLike, type Obligation, type ObligationCategory, type PlanCadence } from "@/lib/picture/obligations";
import { effectiveK401, moneyAllocation, recommendations, taxSummary, type Allocation, type Recommendation, type TaxSummary } from "@/lib/picture/plan-insights";
import { addDays, expensesToReview } from "@/lib/recurring";
import { demoPlanClass, demoPlanTransactions } from "@/lib/picture/demo-plan";
import { useBenefitSummary, useGiftCardRows } from "@/hooks/usePictureExtras";
import type { BenefitSummary } from "@/lib/card-benefits";

export type Shares = NonNullable<FinancialPictureData["shares"]>;

export interface PictureSettingsPatch {
  financialPicture?: FinancialPictureData;
  budgets?: Record<string, number>;
  cardAutopayFrom?: Record<string, string>;
  savingsGoals?: SavingsGoal[];
  dismissedInsights?: string[];
  manualIncome?: ManualIncomeItem[];
}

export interface MyFinancialPictureProps {
  /** Signed-in user (decisions on detected recurring items are stored per user). */
  userId?: string | null;
  txns: PTxn[];
  accounts: PAccount[];
  getEffectiveCategory: (t: PTxn) => string;
  formatCat?: (c: string) => string;
  catColor?: (c: string) => string;
  classOf: (t: PTxn) => PClass | undefined;
  manualIncome?: ManualIncomeItem[];
  onOpenTxnDetail?: (t: PTxn) => void;
  budgets: Record<string, number>;
  cardAutopayFrom: Record<string, string>;
  savingsGoals: SavingsGoal[];
  financialPicture: FinancialPictureData;
  /** One write per user action (useUserSettings().update). */
  onUpdate: (patch: PictureSettingsPatch) => void;
  /** Demo / guest mode: example data, nothing is saved to the server. */
  demo?: boolean;
  /** For tests / screenshots. */
  today?: Date;
  /** History per connected bank, for the "Extend history" hint. */
  banks?: BankHistory[];
  /** user_settings.dismissedInsights (the hint's and recommendations' dismissals are stored there). */
  dismissedInsights?: string[];
  /** Accounts added by hand (Accounts screen), for net worth. */
  manualAccounts?: ManualAccountLike[];
  /** Open another screen (Accounts, Gift Cards, Benefits, Spending). */
  onNavigate?: (view: string) => void;
}

/** A typed-in expense from the "Add an expense" form (amount required). */
export interface PlanItemInput {
  label: string;
  category: ObligationCategory;
  amount: number;
  amountKind: "fixed" | "estimated";
  cadence: PlanCadence;
  intervalDays?: number;
  nextDue: string;
  reminderDays?: number;
  notes?: string;
}

/** Everything the plan (anticipated expenses) and overview sections show. */
export interface PlanState {
  todayISO: string;
  obligations: Obligation[];
  totals: CategoryTotal[];
  accounted: AccountedFor;
  next30: UpcomingWindow;
  toReview: ReviewItem[];
  nw: NetWorth;
  cash: number;
  savingsRate: SavingsRate;
  allocation: Allocation;
  taxes: TaxSummary;
  recs: Recommendation[];
  giftCards: GiftCardSummary;
  giftCardsLoaded: boolean;
  benefits: BenefitSummary | null;
  creditCardCount: number;
  /** 401(k) per month (payroll deductions, else the % typed in) and where it came from. */
  k401Monthly: number;
  k401Source: "payroll" | "entered" | "none";
  /** Take-home income per month (salary, bonus, other, added by hand). */
  incomeMonthly: number;
  /** Set aside per month: savings goals & transfers, pre-tax 401(k)/HSA/FSA and ESPP. */
  savingsMonthly: number;
}

export type ListGroup = Exclude<PictureGroup, "cards">;
export const DATA_GROUPS: PictureGroup[] = ["income", "deductions", "obligations", "fixed", "taxes", "budgets", "cards", "savings"];

// ── Demo / guest example data (layered under whatever the visitor edits) ──
const DEMO_FP: Partial<FinancialPictureData> = {
  riskProfile: "moderate",
  shares: { esppValue: 8900, esppMonthly: 400, esppNextBuy: "2026-12-31", rsuValue: 5400, rsuNextVest: "2026-12-15", rsuNextVestShares: 30 },
  manualItems: [{ id: "demo-gym", group: "fixed", label: "Gym membership", monthly: 60, dueDay: 3, createdAt: "2026-01-01T00:00:00Z" }],
};
const DEMO_OVERRIDES: Record<string, number> = { "deduction.hsa": 320, "deduction.401k": 854, "deduction.espp": 400 };
const DEMO_GOALS: SavingsGoal[] = [
  { id: "demo-emergency", name: "Emergency fund", monthlyTarget: 300, accountId: "da3", fromAccountId: "da1", targetAmount: 25000, kind: "transfer", createdAt: "2026-01-01T00:00:00Z" },
  { id: "demo-house", name: "House down payment", monthlyTarget: 500, accountId: "da2", fromAccountId: "da1", targetAmount: 60000, targetDate: "2028-06-01", kind: "transfer", createdAt: "2026-01-01T00:00:00Z" },
];
const DEMO_CARD_FROM: Record<string, string> = { da4: "da1" };

export interface PictureState {
  props: MyFinancialPictureProps;
  /** The person's saved decisions are in (until then the page shows its skeleton, not a guessed review). */
  ready: boolean;
  demo: boolean;
  today: Date;
  m: PictureModel;
  fp: FinancialPictureData;
  goals: SavingsGoal[];
  full: boolean;
  setFull: (v: boolean) => void;
  /** Multiplier for the period (12 in Full Picture). */
  P: number;
  per: string;
  perWord: string;
  year: number;
  rowsFor: (g: ListGroup) => PictureRow[];
  sumOf: (g: ListGroup) => number;
  findRow: (g: string, id: string) => PictureRow | CardInfo | undefined;
  acct: (id: string | null | undefined) => AcctInfo | null;
  pool: (g: PictureGroup) => AcctInfo[];
  tax: TaxSnapshot;
  savers: TaxSaverNumbers;
  match: MatchStatus;
  bd: SavingsBreakdown;
  cov: CoverageResult;
  map: { boxes: MapBox[]; notCovered: MapBox["items"] };
  flow: FlowSplit;
  steps: WaterfallStep[];
  risk: RiskLevel | undefined;
  riskInfo: RiskNote;
  shares: Shares & { total: number; account: AcctInfo | null };
  // edit mode
  editing: boolean;
  startEdit: () => void;
  /** Clear the draft without leaving edit mode (mobile Edit screen opens). */
  resetDraft: () => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  draftAmt: (g: string, id: string) => number | undefined;
  draftCov: (g: string, id: string) => string | null | undefined;
  setDraftAmt: (g: string, id: string, v: number) => void;
  setDraftCov: (g: string, id: string, v: string | null) => void;
  // immediate writes
  act: {
    setCover: (g: string, id: string, accountId: string | null) => void;
    setAmount: (g: string, id: string, v: number) => void;
    setMatch: (m: EmployerMatch | undefined) => void;
    setRisk: (r: RiskLevel) => void;
    setFiling: (f: "single" | "married_joint") => void;
    setGross: (annual: number | null) => void;
    confirmDeduction: (id: string, answer: "yes" | "no") => void;
    addManualItem: (item: Omit<FinancialPictureManualItem, "id" | "createdAt">, coverId?: string | null) => void;
    removeManualItem: (id: string) => void;
    addBudget: (cat: string, amount: number) => void;
    removeBudget: (cat: string) => void;
    addGoal: (g: Omit<SavingsGoal, "id" | "createdAt">) => void;
    removeGoal: (id: string) => void;
    setShares: (s: Shares) => void;
    addPlanItem: (it: PlanItemInput) => void;
    updatePlanItem: (id: string, it: PlanItemInput) => void;
    restoreManualItem: (item: FinancialPictureManualItem) => void;
    dismissRec: (id: string) => void;
    restoreRec: (id: string) => void;
    /** Income added by hand (pension, rent from a tenant, side work): take-home per month. */
    addIncome: (it: { label: string; amount: number; accountId?: string }) => void;
    updateIncome: (id: string, it: { label: string; amount: number; accountId?: string }) => void;
    removeIncome: (id: string) => void;
    restoreIncome: (it: ManualIncomeItem) => void;
    /** Tax inputs bank data can't show; undefined fields are cleared. */
    setTaxInputs: (t: { k401Pct?: number; fsaAnnual?: number; mortgageInterestAnnual?: number }) => void;
  };
  plan: PlanState;
  // "Detected recurring" review
  recurring: {
    /** Confirm, edit or dismiss ("Not recurring"); returns the previous decision for undo. */
    decide: (item: ReviewItem, patch: Partial<Omit<RecurringDecision, "key" | "snapshot">>) => RecurringDecision | undefined;
    /** Put a previous decision back (undo), or forget it when there was none. */
    revert: (key: string, prev: RecurringDecision | undefined) => void;
    /** Back to "suggested" (from the Dismissed list). */
    restore: (key: string) => void;
  };
}

const Ctx = createContext<PictureState | null>(null);
export const usePicture = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePicture outside PictureProvider");
  return c;
};

interface Working {
  fp: FinancialPictureData;
  budgets: Record<string, number>;
  cards: Record<string, string>;
  goals: SavingsGoal[];
  touched: Set<"fp" | "budgets" | "cards" | "goals">;
}

const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function PictureProvider({ props, children }: { props: MyFinancialPictureProps; children: ReactNode }) {
  const { demo } = props;
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number | string>>({});

  // Effective settings (demo example data underneath the visitor's own edits).
  const fp = useMemo<FinancialPictureData>(() => {
    const f = props.financialPicture ?? { overrides: {}, fundingAccounts: {} };
    if (!demo) return f;
    return {
      ...DEMO_FP, ...f,
      overrides: { ...DEMO_OVERRIDES, ...(f.overrides ?? {}) },
      fundingAccounts: { ...(f.fundingAccounts ?? {}) },
      shares: f.shares ?? DEMO_FP.shares,
      manualItems: f.manualItems ?? DEMO_FP.manualItems,
      riskProfile: f.riskProfile ?? DEMO_FP.riskProfile,
    };
  }, [props.financialPicture, demo]);
  const goals = useMemo(() => (demo && !props.savingsGoals.length ? DEMO_GOALS : props.savingsGoals), [demo, props.savingsGoals]);
  const cardsFrom = useMemo(() => (demo ? { ...DEMO_CARD_FROM, ...props.cardAutopayFrom } : props.cardAutopayFrom ?? {}), [demo, props.cardAutopayFrom]);
  const budgets = useMemo(() => props.budgets ?? {}, [props.budgets]);

  // Re-read decisions whenever transactions are refreshed or synced, so the
  // review, plan and "missed" flags are rebuilt from fresh data.
  const rd = useRecurringDecisions(props.userId, !!demo, props.txns);
  // "Today" follows the clock: the app can stay open (or sit in the Android
  // background) past midnight, and a frozen date hid newer payments (posted
  // after it) and kept already-paid bills flagged as missed. Recomputed on
  // every refresh and when the app comes back to the foreground.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { setNow(new Date()); }, [props.txns]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      setNow(prev => (ymd(prev) === ymd(new Date()) ? prev : new Date()));
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); };
  }, []);
  const today = props.today ?? now;
  const todayISO = ymd(today);
  // Demo: example yearly / twice-a-year / quarterly bills for the plan (Picture only).
  const txns = useMemo(() => (demo ? [...props.txns, ...demoPlanTransactions(todayISO)] : props.txns), [demo, props.txns, todayISO]);
  const { classOf: baseClassOf, getEffectiveCategory: baseGetCat } = props;
  const classOf = useMemo(() => (demo ? (t: PTxn) => demoPlanClass(t) ?? baseClassOf(t) : baseClassOf), [demo, baseClassOf]);
  const getCat = useMemo(() => (demo ? (t: PTxn) => (t.id.startsWith("dpl-") ? (t.category?.[0] ?? "Other") : baseGetCat(t)) : baseGetCat), [demo, baseGetCat]);
  const m = useMemo(() => buildPictureModel({
    recurringDecisions: rd.decisions,
    txns, accounts: props.accounts, classOf, getEffectiveCategory: getCat,
    formatCat: props.formatCat, manualIncome: props.manualIncome, budgets, cardAutopayFrom: cardsFrom, savingsGoals: goals, fp, today,
  }), [txns, props.accounts, classOf, getCat, props.formatCat, props.manualIncome, budgets, cardsFrom, goals, fp, today, rd.decisions]);

  const year = today.getFullYear();
  const P = full ? 12 : 1;
  const per = full ? "/yr" : "/mo";
  const perWord = full ? "a year" : "a month";

  // 401(k): payroll deductions when found, else the % typed in (Taxes → Your tax inputs). FSA skips income tax and FICA like a payroll HSA.
  const k401 = useMemo(() => effectiveK401(m.payroll.k401, m.gross.annual, fp.taxInputs), [m, fp.taxInputs]);
  const fsaAnnual = Math.max(0, fp.taxInputs?.fsaAnnual ?? 0);
  const tax = useMemo(() => taxSnapshot({ gross: m.gross.annual, hsa: m.payroll.hsa * 12 + fsaAnnual, k401: k401.annual, filing: m.filing, year }), [m, year, k401, fsaAnnual]);
  const savers = useMemo(() => taxSaverNumbers(m.gross.annual, m.payroll.hsa * 12, k401.annual, m.filing, year), [m, year, k401]);
  const match = useMemo(() => matchStatus(fp.employerMatch, m.gross.annual, k401.annual), [fp.employerMatch, m, k401]);

  const sharesRaw: Shares = fp.shares ?? {};
  const sharesTotal = (sharesRaw.esppValue ?? 0) + (sharesRaw.rsuValue ?? 0);
  const sharesAcct = m.accounts.find(a => a.kind === "invest" && !/^(401k|403b|401a|457b|ira|roth)$/.test(a.subtype)) ?? null;

  const bd = useMemo(() => {
    const list: TierAccount[] = props.accounts.map(a => ({ account_id: a.account_id, name: a.name, official_name: a.official_name, type: a.type, subtype: a.subtype, current_balance: a.current_balance as number | null, mask: a.mask ?? null }));
    // Company shares are typed in (they don't sit in a linked account): count them as long term.
    if (sharesTotal > 0) list.push({ account_id: "fp-shares", name: "Company shares (ESPP + RSU)", type: "investment", subtype: "brokerage", current_balance: sharesTotal });
    return savingsBreakdown(list);
  }, [props.accounts, sharesTotal]);

  const taxRows = useMemo<PictureRow[]>(() => [
    { group: "taxes", id: "fedtax", label: "Federal income tax", sub: "Withheld from pay · estimate", monthly: tax.fed / 12, detected: tax.fed / 12, coverId: null, coverSource: "none", txns: [] },
    { group: "taxes", id: "fica", label: "Social Security & Medicare", sub: "Withheld from pay", monthly: tax.fica / 12, detected: tax.fica / 12, coverId: null, coverSource: "none", txns: [] },
    ...m.rows.taxes,
  ], [tax, m.rows.taxes]);

  const rowsFor = useCallback((g: ListGroup) => (g === "taxes" ? taxRows : m.rows[g]), [m, taxRows]);
  const sumOf = useCallback((g: ListGroup) => rowsFor(g).reduce((s, r) => s + r.monthly, 0), [rowsFor]);
  const findRow = useCallback((g: string, id: string) => (g === "cards" ? m.cards.find(c => c.id === id) : rowsFor(g as ListGroup)?.find(r => r.id === id)), [m, rowsFor]);
  const acct = useCallback((id: string | null | undefined) => (id ? m.acct.get(id) ?? null : null), [m]);
  const pool = useCallback((g: PictureGroup) => {
    const ok = (a: AcctInfo) => (g === "cards" || g === "savings" ? a.kind === "bank" || a.kind === "save"
      : g === "budgets" ? a.kind === "bank" || a.kind === "card"
      : a.kind === "bank" || a.kind === "save" || a.kind === "card");
    return m.accounts.filter(ok);
  }, [m]);

  const coverItems = useMemo(() => [
    ...m.rows.obligations.map(r => ({ group: "obligations" as const, id: r.id, label: r.label, monthly: r.monthly, coverId: r.coverId })),
    ...m.rows.fixed.map(r => ({ group: "fixed" as const, id: r.id, label: r.label, monthly: r.monthly, coverId: r.coverId })),
    ...m.rows.budgets.map(r => ({ group: "budgets" as const, id: r.id, label: r.label, monthly: r.monthly, coverId: r.coverId })),
    ...m.rows.savings.map(r => ({ group: "savings" as const, id: r.id, label: r.label, monthly: r.monthly, coverId: r.fromId ?? r.coverId, toLabel: r.toId ? m.acct.get(r.toId)?.name ?? r.label : r.label })),
  ], [m]);
  const coverCards = useMemo(() => m.cards.map(c => ({ id: c.id, label: c.name, payoffId: c.payoffId })), [m]);
  const cov = useMemo(() => coverage(coverItems, coverCards), [coverItems, coverCards]);
  const map = useMemo(() => coverageMap(coverItems, coverCards, m.accounts.map(a => ({ id: a.id, label: a.label, kind: a.chip }))), [coverItems, coverCards, m]);

  const flowInput = useMemo(() => {
    const inc = (id: string) => m.rows.income.find(r => r.id === id)?.monthly ?? 0;
    const manual = m.rows.income.filter(r => r.id.startsWith("manual-")).reduce((s, r) => s + r.monthly, 0);
    return {
      grossMonthly: m.gross.annual / 12, fedMonthly: tax.fed / 12, ficaMonthly: tax.fica / 12,
      hsaMonthly: m.payroll.hsa, k401Monthly: m.payroll.k401, postTaxMonthly: m.payroll.espp + m.payroll.rsu,
      takeHomeMonthly: inc("salary"), bonusMonthly: inc("bonus"), otherIncomeMonthly: inc("other") + manual,
      obligations: m.rows.obligations.reduce((s, r) => s + r.monthly, 0),
      fixed: m.rows.fixed.reduce((s, r) => s + r.monthly, 0),
      budgets: m.rows.budgets.reduce((s, r) => s + r.monthly, 0),
      savings: m.rows.savings.reduce((s, r) => s + r.monthly, 0),
    };
  }, [m, tax]);
  const flow = useMemo(() => flowSplit(flowInput), [flowInput]);
  const steps = useMemo(() => cashflowSteps(flowInput), [flowInput]);

  const risk = fp.riskProfile;
  const riskInfo = useMemo(() => riskNote(risk, bd), [risk, bd]);

  // ── The plan: every anticipated expense, plus the overview around it ──
  const gc = useGiftCardRows(props.userId, !!demo);
  const cardNames = useMemo(() => Object.fromEntries(m.accounts.filter(a => a.kind === "card").map(a => [a.id, a.name])), [m.accounts]);
  const benefits = useBenefitSummary(props.userId, !!demo, cardNames);
  const plan = useMemo<PlanState>(() => {
    const manual = (fp.manualItems ?? []) as ManualObligationLike[];
    const obligations = buildObligations({ today: todayISO, reviewItems: m.review.items, manual, giftCards: gc.rows });
    const nw = netWorthBreakdown(props.accounts, props.manualAccounts ?? []);
    const cash = m.accounts.filter(a => a.kind === "bank" || a.kind === "save").reduce((s, a) => s + a.balance, 0);
    const checking = m.accounts.filter(a => a.kind === "bank").reduce((s, a) => s + a.balance, 0);
    const toReview = expensesToReview(m.review.items);
    const incomeItems = m.review.items.filter(i => i.direction === "inflow" && i.group === "income");
    // Typed-in expenses join the 30-day cash run too.
    const extra = project(obligations.filter(o => o.source === "manual"), todayISO, addDays(todayISO, 30))
      .map(o => ({ key: `${o.ob.id}@${o.date}`, date: o.date, label: o.ob.label, amount: o.ob.amount, direction: "outflow" as const, detected: false }));
    const next30 = upcomingWindow({ today: todayISO, items: [...incomeItems, ...m.review.items.filter(i => i.direction === "outflow" && i.group !== "income")], startCash: checking, extra });
    const savingsMonthly = m.rows.savings.reduce((s, r) => s + r.monthly, 0);
    const takeHome = m.rows.income.reduce((s, r) => s + r.monthly, 0);
    const sr = savingsRate({ savingsMonthly, payrollSavingsMonthly: k401.annual / 12 + m.payroll.hsa + m.payroll.espp, grossMonthly: m.gross.annual / 12, takeHomeMonthly: takeHome });
    const allocation = moneyAllocation({
      grossMonthly: m.gross.annual / 12, takeHomeMonthly: takeHome, taxMonthly: (tax.fed + tax.fica) / 12,
      payroll: { k401: k401.annual / 12, hsa: m.payroll.hsa, espp: m.payroll.espp, rsu: m.payroll.rsu },
      savings: m.rows.savings.map(r => { const to = r.toId ? m.acct.get(r.toId) : undefined; return { monthly: r.monthly, toSubtype: to?.subtype, toType: to?.type }; }),
      obligations, budgetsMonthly: m.rows.budgets.reduce((s, r) => s + r.monthly, 0),
    });
    const taxes = taxSummary({ today: todayISO, year, gross: m.gross.annual, grossEstimated: m.gross.estimated, filing: m.filing, filingSet: fp.overrides?.filingStatusCode != null, tax, savers, reviewItems: m.review.items, hsaMonthly: m.payroll.hsa, k401Monthly: k401.annual / 12, inputs: fp.taxInputs, k401Source: k401.source });
    const giftCards = giftCardSummary(gc.rows, todayISO);
    const utilityPayments = m.review.items.filter(i => i.direction === "outflow" && categorize(i.label, i.kind, i.subtype, i.cadence) === "utilities").flatMap(i => i.matched.map(t => ({ date: t.date, amount: Math.abs(t.amount) })));
    const recs = recommendations({
      today: todayISO, obligations, toReview: toReview.length, cash, low: next30.low, match, savers, gross: m.gross.annual, k401Annual: k401.annual, year,
      utilityPayments, giftCardsExpiringSoon: giftCards.expiringSoon, dismissed: props.dismissedInsights ?? [],
      itemize: taxes.mortgageInterest > 0 ? { itemized: taxes.itemized, standard: taxes.standardDeduction, saves: taxes.itemizeSaves } : null,
      k401Unknown: k401.source === "none",
    });
    return {
      todayISO, obligations, totals: categoryTotals(obligations, todayISO), accounted: accountedFor(obligations, todayISO, checking), next30, toReview, nw, cash,
      savingsRate: sr, allocation, taxes, recs, giftCards, giftCardsLoaded: gc.loaded, benefits, creditCardCount: Object.keys(cardNames).length,
      k401Monthly: k401.annual / 12, k401Source: k401.source, incomeMonthly: takeHome,
      savingsMonthly: savingsMonthly + k401.annual / 12 + m.payroll.hsa + m.payroll.espp + fsaAnnual / 12,
    };
  }, [fp, todayISO, m, gc, props.accounts, props.manualAccounts, props.dismissedInsights, tax, savers, match, year, benefits, cardNames, k401, fsaAnnual]);

  // ── writes ──
  const working = useCallback((): Working => ({
    fp: { ...fp, overrides: { ...(fp.overrides ?? {}) }, fundingAccounts: { ...(fp.fundingAccounts ?? {}) } },
    budgets: { ...budgets }, cards: { ...cardsFrom }, goals: goals.map(g => ({ ...g })), touched: new Set(),
  }), [fp, budgets, cardsFrom, goals]);
  const commit = useCallback((w: Working) => {
    if (!w.touched.size) return;
    const patch: PictureSettingsPatch = {};
    if (w.touched.has("fp")) patch.financialPicture = w.fp;
    if (w.touched.has("budgets")) patch.budgets = w.budgets;
    if (w.touched.has("cards")) patch.cardAutopayFrom = w.cards;
    if (w.touched.has("goals")) patch.savingsGoals = w.goals;
    props.onUpdate(patch);
  }, [props]);

  const goalFromDetected = (w: Working, r: PictureRow, patch: Partial<SavingsGoal>) => {
    const g: SavingsGoal = { id: newId("sg"), name: r.label, monthlyTarget: Math.round(r.monthly), accountId: r.toId ?? undefined, fromAccountId: r.fromId ?? undefined, kind: "transfer", createdAt: new Date().toISOString(), ...patch };
    w.goals.push(g); w.touched.add("goals");
  };

  const applyAmt = useCallback((w: Working, g: string, id: string, v: number) => {
    const r = findRow(g, id) as PictureRow | undefined;
    if (!r || !Number.isFinite(v) || v < 0) return;
    if (r.manualId && (g === "obligations" || g === "fixed")) {
      w.fp.manualItems = (w.fp.manualItems ?? []).map(x => (x.id === r.manualId ? { ...x, monthly: v } : x)); w.touched.add("fp"); return;
    }
    if (g === "budgets" && r.category) {
      if (v > 0) w.budgets[r.category] = v; else delete w.budgets[r.category];
      w.touched.add("budgets"); return;
    }
    if (g === "savings") {
      if (r.goalId) { w.goals = w.goals.map(x => (x.id === r.goalId ? { ...x, monthlyTarget: v } : x)); w.touched.add("goals"); }
      else if (Math.abs(v - r.monthly) >= 0.5) goalFromDetected(w, r, { monthlyTarget: v });
      return;
    }
    if (r.overrideKey) {
      if (r.detected > 0 && Math.abs(v - r.detected) < 0.5) delete w.fp.overrides[r.overrideKey];
      else w.fp.overrides[r.overrideKey] = v;
      w.touched.add("fp");
    }
  }, [findRow]);

  const applyCov = useCallback((w: Working, g: string, id: string, v: string | null) => {
    if (g === "cards") { if (v) w.cards[id] = v; else delete w.cards[id]; w.touched.add("cards"); return; }
    const r = findRow(g, id) as PictureRow | undefined;
    if (!r) return;
    if (g === "savings") {
      if (r.goalId) { w.goals = w.goals.map(x => (x.id === r.goalId ? { ...x, fromAccountId: v ?? undefined } : x)); w.touched.add("goals"); }
      else goalFromDetected(w, r, { fromAccountId: v ?? undefined });
      return;
    }
    if (r.fundingKey) { w.fp.fundingAccounts[r.fundingKey] = v ?? FP_UNASSIGNED; w.touched.add("fp"); }
  }, [findRow]);

  const one = useCallback((fn: (w: Working) => void) => { const w = working(); fn(w); commit(w); }, [working, commit]);
  /** Editing a detected row (amount / covered by) is acting on it: it leaves "to review" as confirmed. */
  const confirmIfDetected = useCallback((g: string, id: string) => {
    const r = findRow(g, id) as PictureRow | undefined;
    const it = r?.reviewKey ? m.review.items.find(i => i.key === r.reviewKey) : undefined;
    if (!it || it.status !== "suggested") return;
    const prev = rd.decisions.find(d => d.key === it.key);
    void rd.save(decisionFor(it, { status: "confirmed", cadence: prev?.cadence, amount: prev?.amount, group: prev?.group, coverAccountId: prev?.coverAccountId }));
  }, [findRow, m.review.items, rd]);
  const planToManual = (it: PlanItemInput) => {
    const monthly = Math.round(((it.amount * perYear(it.cadence, it.intervalDays)) / 12 || 0) * 100) / 100;
    return {
      group: (it.category === "debt" || it.category === "housing" ? "obligations" : "fixed") as "obligations" | "fixed",
      label: it.label.trim(), monthly: it.cadence === "once" ? 0 : monthly, category: it.category, amount: it.amount, amountKind: it.amountKind,
      cadence: it.cadence, intervalDays: it.cadence === "custom" ? it.intervalDays : undefined, nextDue: it.nextDue,
      dueDay: it.cadence === "monthly" ? Number(it.nextDue.slice(8, 10)) : undefined,
      reminderDays: it.reminderDays, notes: it.notes?.trim() || undefined,
    };
  };
  const fpPatch = useCallback((patch: Partial<FinancialPictureData>) => one(w => { w.fp = { ...w.fp, ...patch }; w.touched.add("fp"); }), [one]);

  const act: PictureState["act"] = useMemo(() => ({
    setCover: (g, id, a) => { one(w => applyCov(w, g, id, a)); confirmIfDetected(g, id); },
    setAmount: (g, id, v) => { one(w => applyAmt(w, g, id, v)); confirmIfDetected(g, id); },
    setMatch: mm => fpPatch({ employerMatch: mm ? { ...mm, answer: mm.answer ?? "yes", at: new Date().toISOString() } : undefined }),
    setRisk: r => fpPatch({ riskProfile: r }),
    setFiling: f => one(w => { if (f === "married_joint") w.fp.overrides.filingStatusCode = 1; else delete w.fp.overrides.filingStatusCode; w.touched.add("fp"); }),
    setGross: a => one(w => { if (a && a > 0) w.fp.overrides["income.grossSalaryAnnual"] = a; else delete w.fp.overrides["income.grossSalaryAnnual"]; w.touched.add("fp"); }),
    confirmDeduction: (id, ans) => one(w => { w.fp.confirmations = { ...(w.fp.confirmations ?? {}), [`deduction:${id}`]: ans }; w.touched.add("fp"); }),
    addManualItem: (it, coverId) => one(w => {
      const item = { ...it, id: newId("mi"), createdAt: new Date().toISOString() };
      w.fp.manualItems = [...(w.fp.manualItems ?? []), item];
      if (coverId) w.fp.fundingAccounts[`funding:${it.group === "obligations" ? "obligation" : "expense"}:m-${item.id}`] = coverId;
      w.touched.add("fp");
    }),
    removeManualItem: id => one(w => { w.fp.manualItems = (w.fp.manualItems ?? []).filter(x => x.id !== id); w.touched.add("fp"); }),
    addBudget: (cat, amt) => one(w => { w.budgets[cat] = amt; w.touched.add("budgets"); }),
    removeBudget: cat => one(w => { delete w.budgets[cat]; w.touched.add("budgets"); }),
    addGoal: g => one(w => { w.goals.push({ ...g, id: newId("sg"), createdAt: new Date().toISOString() }); w.touched.add("goals"); }),
    removeGoal: id => one(w => { w.goals = w.goals.filter(x => x.id !== id); w.touched.add("goals"); }),
    setShares: s => fpPatch({ shares: s }),
    addPlanItem: it => one(w => { w.fp.manualItems = [...(w.fp.manualItems ?? []), { ...planToManual(it), id: newId("mi"), createdAt: new Date().toISOString() }]; w.touched.add("fp"); }),
    updatePlanItem: (id, it) => one(w => { w.fp.manualItems = (w.fp.manualItems ?? []).map(x => (x.id === id ? { ...x, ...planToManual(it) } : x)); w.touched.add("fp"); }),
    restoreManualItem: item => one(w => { w.fp.manualItems = [...(w.fp.manualItems ?? []).filter(x => x.id !== item.id), item]; w.touched.add("fp"); }),
    addIncome: it => props.onUpdate({ manualIncome: [...(props.manualIncome ?? []), { id: newId("inc"), label: it.label.trim(), amount: Math.round(it.amount * 100) / 100, accountId: it.accountId || undefined }] }),
    updateIncome: (id, it) => props.onUpdate({ manualIncome: (props.manualIncome ?? []).map(x => (x.id === id ? { ...x, label: it.label.trim(), amount: Math.round(it.amount * 100) / 100, accountId: it.accountId || undefined } : x)) }),
    removeIncome: id => props.onUpdate({ manualIncome: (props.manualIncome ?? []).filter(x => x.id !== id) }),
    restoreIncome: it => props.onUpdate({ manualIncome: [...(props.manualIncome ?? []).filter(x => x.id !== it.id), it] }),
    dismissRec: id => props.onUpdate({ dismissedInsights: [...new Set([...(props.dismissedInsights ?? []), id])] }),
    restoreRec: id => props.onUpdate({ dismissedInsights: (props.dismissedInsights ?? []).filter(x => x !== id) }),
    setTaxInputs: t => fpPatch({ taxInputs: { ...t, at: new Date().toISOString() } }),
  }), [one, fpPatch, applyAmt, applyCov, confirmIfDetected, props]);

  const startEdit = useCallback(() => { setDraft({}); setEditing(true); }, []);
  const resetDraft = useCallback(() => setDraft({}), []);
  const cancelEdit = useCallback(() => { setDraft({}); setEditing(false); }, []);
  const saveEdit = useCallback(() => {
    one(w => {
      for (const [k, v] of Object.entries(draft)) {
        const [kind, g, ...rest] = k.split(":");
        const id = rest.join(":");
        if (kind === "amt") applyAmt(w, g, id, Number(v));
        else if (kind === "cov") applyCov(w, g, id, v === "" ? null : String(v));
        confirmIfDetected(g, id);
      }
    });
    setDraft({}); setEditing(false);
  }, [draft, one, applyAmt, applyCov, confirmIfDetected]);
  const draftAmt = useCallback((g: string, id: string) => { const v = draft[`amt:${g}:${id}`]; return v === undefined ? undefined : Number(v); }, [draft]);
  const draftCov = useCallback((g: string, id: string) => { const k = `cov:${g}:${id}`; if (!(k in draft)) return undefined; const v = draft[k]; return v === "" ? null : String(v); }, [draft]);
  const setDraftAmt = useCallback((g: string, id: string, v: number) => setDraft(d => ({ ...d, [`amt:${g}:${id}`]: v })), []);
  const setDraftCov = useCallback((g: string, id: string, v: string | null) => setDraft(d => ({ ...d, [`cov:${g}:${id}`]: v ?? "" })), []);

  const recurring = useMemo<PictureState["recurring"]>(() => ({
    decide: (item, patch) => {
      const prev = rd.decisions.find(d => d.key === item.key);
      void rd.save(decisionFor(item, { status: item.status, cadence: prev?.cadence, amount: prev?.amount, group: prev?.group, coverAccountId: prev?.coverAccountId, ...patch }));
      return prev;
    },
    revert: (key, prev) => { void (prev ? rd.save(prev) : rd.remove(key)); },
    restore: key => { void rd.remove(key); },
  }), [rd]);

  const value: PictureState = {
    ready: rd.loaded, demo: !!demo, today,
    props, m, fp, goals, full, setFull: v => { setFull(v); if (v) cancelEdit(); }, P, per, perWord, year,
    rowsFor, sumOf, findRow, acct, pool, tax, savers, match, bd, cov, map, flow, steps, risk, riskInfo,
    shares: { ...sharesRaw, total: sharesTotal, account: sharesAcct },
    editing, startEdit, resetDraft, cancelEdit, saveEdit, draftAmt, draftCov, setDraftAmt, setDraftCov, act,
    recurring, plan,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
