/**
 * My Financial Picture: derived numbers + every write the page makes, shared by
 * the desktop columns, the mobile cards and all detail views via context.
 *
 * Writes go through one `onUpdate` call per user action, built from a working
 * copy of the current settings, so a multi-field save (the Edit form) can't
 * lose an earlier field to a stale read.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { FinancialPictureData, FinancialPictureManualItem, ManualIncomeItem, SavingsGoal } from "@/hooks/useUserSettings";
import { FP_UNASSIGNED } from "@/lib/picture/keys";
import { buildPictureModel, type AcctInfo, type PAccount, type PClass, type PictureGroup, type PictureModel, type PictureRow, type PTxn, type CardInfo } from "@/lib/picture/model";
import { taxSnapshot, taxSaverNumbers, matchStatus, type MatchStatus, type TaxSnapshot, type TaxSaverNumbers, type EmployerMatch } from "@/lib/picture/tax";
import { savingsBreakdown, type SavingsBreakdown, type TierAccount } from "@/lib/picture/savings-breakdown";
import { riskNote, type RiskLevel, type RiskNote } from "@/lib/picture/risk";
import { coverage, coverageMap, type CoverageResult, type MapBox } from "@/lib/picture/coverage";
import { cashflowSteps, flowSplit, type FlowSplit, type WaterfallStep } from "@/lib/picture/cashflow";

export type Shares = NonNullable<FinancialPictureData["shares"]>;

export interface PictureSettingsPatch {
  financialPicture?: FinancialPictureData;
  budgets?: Record<string, number>;
  cardAutopayFrom?: Record<string, string>;
  savingsGoals?: SavingsGoal[];
}

export interface MyFinancialPictureProps {
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

  const today = useMemo(() => props.today ?? new Date(), [props.today]);
  const m = useMemo(() => buildPictureModel({
    txns: props.txns, accounts: props.accounts, classOf: props.classOf, getEffectiveCategory: props.getEffectiveCategory,
    formatCat: props.formatCat, manualIncome: props.manualIncome, budgets, cardAutopayFrom: cardsFrom, savingsGoals: goals, fp, today,
  }), [props.txns, props.accounts, props.classOf, props.getEffectiveCategory, props.formatCat, props.manualIncome, budgets, cardsFrom, goals, fp, today]);

  const year = today.getFullYear();
  const P = full ? 12 : 1;
  const per = full ? "/yr" : "/mo";
  const perWord = full ? "a year" : "a month";

  const tax = useMemo(() => taxSnapshot({ gross: m.gross.annual, hsa: m.payroll.hsa * 12, k401: m.payroll.k401 * 12, filing: m.filing, year }), [m, year]);
  const savers = useMemo(() => taxSaverNumbers(m.gross.annual, m.payroll.hsa * 12, m.payroll.k401 * 12, m.filing, year), [m, year]);
  const match = useMemo(() => matchStatus(fp.employerMatch, m.gross.annual, m.payroll.k401 * 12), [fp.employerMatch, m]);

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
  const fpPatch = useCallback((patch: Partial<FinancialPictureData>) => one(w => { w.fp = { ...w.fp, ...patch }; w.touched.add("fp"); }), [one]);

  const act: PictureState["act"] = useMemo(() => ({
    setCover: (g, id, a) => one(w => applyCov(w, g, id, a)),
    setAmount: (g, id, v) => one(w => applyAmt(w, g, id, v)),
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
  }), [one, fpPatch, applyAmt, applyCov]);

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
      }
    });
    setDraft({}); setEditing(false);
  }, [draft, one, applyAmt, applyCov]);
  const draftAmt = useCallback((g: string, id: string) => { const v = draft[`amt:${g}:${id}`]; return v === undefined ? undefined : Number(v); }, [draft]);
  const draftCov = useCallback((g: string, id: string) => { const k = `cov:${g}:${id}`; if (!(k in draft)) return undefined; const v = draft[k]; return v === "" ? null : String(v); }, [draft]);
  const setDraftAmt = useCallback((g: string, id: string, v: number) => setDraft(d => ({ ...d, [`amt:${g}:${id}`]: v })), []);
  const setDraftCov = useCallback((g: string, id: string, v: string | null) => setDraft(d => ({ ...d, [`cov:${g}:${id}`]: v ?? "" })), []);

  const value: PictureState = {
    demo: !!demo, today,
    props, m, fp, goals, full, setFull: v => { setFull(v); if (v) cancelEdit(); }, P, per, perWord, year,
    rowsFor, sumOf, findRow, acct, pool, tax, savers, match, bd, cov, map, flow, steps, risk, riskInfo,
    shares: { ...sharesRaw, total: sharesTotal, account: sharesAcct },
    editing, startEdit, resetDraft, cancelEdit, saveEdit, draftAmt, draftCov, setDraftAmt, setDraftCov, act,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
