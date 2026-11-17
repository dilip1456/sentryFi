/**
 * My Financial Picture: obligations & expenses (every bill you can expect,
 * weekly to yearly, detected or typed in), the review queue and whether it's
 * all accounted for; plus the Insights cards (where the money goes, taxes,
 * recommendations) shown on the Insights screen. Data: src/lib/picture/
 * {obligations,overview,plan-insights}.ts via the Picture state; nothing new
 * is fetched here except through usePictureExtras (gift cards, card perks).
 *
 * Overlay keys: "plan:add", "plan:edit:<manualId>", "plan:item:<obligation id>"
 * (a bottom sheet on phones), "plan:taxes", "plan:nw:<group>".
 */
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CalendarClock, Check, ChevronRight, CircleAlert, CircleCheck, Gift, Landmark, Lightbulb, PieChart, Plus, Receipt, Sparkles, TriangleAlert, Wallet, X,
} from "lucide-react";
import { addDays, diffDays } from "@/lib/recurring/dates";
import {
  BUCKET_LABEL, CATEGORY_LABEL, OBLIGATION_CATEGORIES, PLAN_CADENCE_LABEL, WINDOW_LABEL, cadenceBucket, project, sinkingFund, windowEnd,
  type CadenceBucket, type Obligation, type ObligationCategory, type PlanCadence, type PlanWindow,
} from "@/lib/picture/obligations";
import type { NetWorthGroupKey } from "@/lib/picture/overview";
import { usePicture, type PictureState, type PlanItemInput } from "./state";
import { useOverlay, type DetailView } from "./overlays";
import { fmt } from "./bits";
import { ItemRow, useRecurringActions } from "./recurring";

const money = (n: number) => (Math.abs(n) < 100 && n % 1 ? `$${Math.abs(n).toFixed(2)}` : fmt(n));
const shortDate = (d: string, today?: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: today && d.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined });
const STATUS: Record<Obligation["source"], { text: string; cls: string }> = {
  detected: { text: "Needs review", cls: "pl-st det" }, confirmed: { text: "Confirmed", cls: "pl-st ok" }, manual: { text: "Added by you", cls: "pl-st man" }, giftcard: { text: "Gift card", cls: "pl-st man" },
};

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="seg pl-seg" role="group" aria-label={label}>{options.map(([k, t]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{t}</button>)}</div>;
}

function Card({ id, icon, title, sub, right, children, testId }: { id?: string; icon: ReactNode; title: string; sub?: ReactNode; right?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <section className="sec pl-card" id={id} data-testid={testId} aria-label={title}>
      <div className="sec-h"><span className="sec-ico" aria-hidden="true">{icon}</span><div className="min-w-0 flex-1"><h3 className="sec-t">{title}</h3>{sub && <div className="sec-s">{sub}</div>}</div>{right}</div>
      {children}
    </section>
  );
}

// ── Review queue ────────────────────────────────────────────────────────────

export function ReviewQueue() {
  const pc = usePicture();
  const { open } = useOverlay();
  const list = pc.plan.toReview;
  // Only when something needs a decision: no "all caught up" card.
  if (!list.length) return null;
  return (
    <section className="sec rcv-card pl-queue" data-testid="rcv-card" aria-label="To review">
      <div className="sec-h">
        <span className="sec-ico" aria-hidden="true"><Sparkles className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1"><h3 className="sec-t">To review</h3>
          <div className="sec-s" data-testid="rcv-count">{`${list.length} detected bill${list.length === 1 ? "" : "s"} to confirm or dismiss`}</div></div>
        <button type="button" className="sec-more tap-44" onClick={() => open("rcv")}>Review all<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="rows">{list.slice(0, 4).map(it => <ItemRow key={it.key} it={it} />)}</div>
      {list.length > 4 && <p className="mini mt-2">and {list.length - 4} more</p>}
    </section>
  );
}

// ── Upcoming plan ───────────────────────────────────────────────────────────

type PlanView = "timeline" | "cadence" | "category";

function ObRow({ ob, date, overdue }: { ob: Obligation; date?: string; overdue?: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const t = pc.plan.todayISO;
  const d = date ?? ob.nextDue;
  const soon = !!d && !overdue && d >= t && diffDays(d, t) <= 7;
  const late = overdue || (ob.missed && !date);
  const st = STATUS[ob.source];
  const sub = [CATEGORY_LABEL[ob.category], PLAN_CADENCE_LABEL[ob.cadence] + (ob.cadence === "custom" && ob.intervalDays ? ` (${ob.intervalDays} days)` : ""), ob.lastPaid ? `last ${money(ob.lastPaid.amount)} on ${shortDate(ob.lastPaid.date, t)}` : null].filter(Boolean).join(" · ");
  return (
    <button type="button" className={`pl-row ${late ? "late" : soon ? "soon" : ""}`} data-testid="plan-row" data-source={ob.source} onClick={() => open(`plan:item:${ob.id}`)} aria-label={`${ob.label}, ${money(ob.amount)}${d ? `, due ${shortDate(d, t)}` : ""}. Details`}>
      <span className="pl-date" aria-hidden="true">{d ? <><b>{new Date(`${d}T12:00:00`).getDate()}</b><small>{new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</small></> : <small>—</small>}</span>
      <span className="pl-lbl"><b>{ob.label}</b><small>{sub}</small>
        <span className="pl-tags"><span className={st.cls}>{st.text}</span>{late && <span className="pl-st bad"><CircleAlert className="h-3 w-3" aria-hidden="true" />{ob.source === "giftcard" ? "Expired" : "Overdue"}</span>}{soon && <span className="pl-st warn"><CalendarClock className="h-3 w-3" aria-hidden="true" />{d === t ? "Due today" : `In ${diffDays(d!, t)} day${diffDays(d!, t) === 1 ? "" : "s"}`}</span>}</span>
      </span>
      <span className="pl-amt">{ob.amountKind === "estimated" ? "~" : ""}{money(ob.amount)}{ob.noCost ? <small>balance</small> : ob.annual > 0 ? <small>{fmt(ob.annual)}/yr</small> : null}</span>
    </button>
  );
}

export function UpcomingPlan() {
  const pc = usePicture();
  const { open } = useOverlay();
  const [win, setWin] = useState<PlanWindow>("month");
  const [view, setView] = useState<PlanView>("timeline");
  const t = pc.plan.todayISO;
  const end = windowEnd(win, t);
  const occ = useMemo(() => project(pc.plan.obligations, t, end), [pc.plan.obligations, t, end]);
  const total = occ.filter(o => !o.ob.noCost).reduce((s, o) => s + o.ob.amount, 0);
  const months = useMemo(() => {
    const by = new Map<string, typeof occ>();
    for (const o of occ) { const k = o.date.slice(0, 7); by.set(k, [...(by.get(k) ?? []), o]); }
    return [...by.entries()];
  }, [occ]);
  const byBucket = useMemo(() => {
    const order: CadenceBucket[] = ["weekly", "monthly", "quarterly", "annual"];
    return order.map(b => ({ b, list: pc.plan.obligations.filter(o => !o.noCost && cadenceBucket(o) === b) })).filter(x => x.list.length);
  }, [pc.plan.obligations]);
  return (
    <Card id="plan-upcoming" testId="plan-upcoming" icon={<CalendarClock className="h-[18px] w-[18px]" />} title="Obligations & expenses"
      sub="Every bill you can expect over the year: insurance, registration, taxes, HOA, utilities, housing, loans & cards, subscriptions and fees. Detected or added by you."
      right={<button type="button" className="btn tap-44 pl-add" onClick={() => open("plan:add")}><Plus className="h-4 w-4" aria-hidden="true" />Add expense</button>}>
      <div className="pl-controls">
        <Seg<PlanView> label="Obligations view" value={view} onChange={setView} options={[["timeline", "Upcoming"], ["cadence", "By cadence"], ["category", "By category"]]} />
        {view === "timeline" && <Seg<PlanWindow> label="Time range" value={win} onChange={setWin} options={[["week", "Week"], ["month", "Month"], ["quarter", "3 months"], ["year", "Year"]]} />}
      </div>
      {view === "timeline" && <>
        <p className="mini pl-total" data-testid="plan-window-total">{WINDOW_LABEL[win]}: <b>{fmt(total)}</b> across {occ.filter(o => !o.ob.noCost).length} payment{occ.length === 1 ? "" : "s"} (through {shortDate(end, t)})</p>
        {months.length ? months.map(([k, list]) => (
          <div key={k} className="pl-month">
            <div className="h4">{new Date(`${k}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: k.slice(0, 4) !== t.slice(0, 4) ? "numeric" : undefined })}<span>{fmt(list.filter(o => !o.ob.noCost).reduce((s, o) => s + o.ob.amount, 0))}</span></div>
            <div className="rows">{list.map(o => <ObRow key={`${o.ob.id}@${o.date}`} ob={o.ob} date={o.date} overdue={o.overdue} />)}</div>
          </div>
        )) : <p className="mini py-3">Nothing due {WINDOW_LABEL[win].toLowerCase()}.</p>}
      </>}
      {view === "cadence" && byBucket.map(({ b, list }) => (
        <div key={b} className="pl-month" data-testid={`plan-bucket-${b}`}>
          <div className="h4">{BUCKET_LABEL[b]}<span>{fmt(list.reduce((s, o) => s + o.monthly, 0))}/mo</span></div>
          <div className="rows">{list.map(o => <ObRow key={o.id} ob={o} />)}</div>
        </div>
      ))}
      {view === "category" && <CategoryTable expanded />}
    </Card>
  );
}

function CategoryTable({ expanded = false }: { expanded?: boolean }) {
  const pc = usePicture();
  const [openCat, setOpenCat] = useState<ObligationCategory | null>(null);
  const totals = pc.plan.totals;
  if (!totals.length) return <p className="mini py-2">No expenses yet. Add one, or review what we detected.</p>;
  return (
    <div className="pl-cats" data-testid="plan-categories">
      <div className="pl-cat head" aria-hidden="true"><span>Category</span><span>Per month</span><span>Per year</span><span>Set aside</span></div>
      {totals.map(c => (
        <div key={c.category}>
          <button type="button" className="pl-cat" aria-expanded={expanded && openCat === c.category} onClick={() => setOpenCat(v => (v === c.category ? null : c.category))} disabled={!expanded}>
            <span className="pl-cat-n">{CATEGORY_LABEL[c.category]}<small>{c.count} item{c.count === 1 ? "" : "s"}</small></span>
            <span>{fmt(c.monthly)}</span><span>{fmt(c.annual)}</span><span>{c.setAside ? `${fmt(c.setAside)}/mo` : "—"}</span>
          </button>
          {expanded && openCat === c.category && <div className="rows mb-2">{c.items.map(o => <ObRow key={o.id} ob={o} />)}</div>}
        </div>
      ))}
      <div className="pl-cat foot"><span>Total</span><span>{fmt(totals.reduce((s, c) => s + c.monthly, 0))}</span><span>{fmt(totals.reduce((s, c) => s + c.annual, 0))}</span><span>{fmt(totals.reduce((s, c) => s + c.setAside, 0))}/mo</span></div>
      <p className="mini mt-2">“Set aside” is a sinking fund: put that much into savings each month and quarterly, twice-a-year and yearly bills are covered when they come.</p>
    </div>
  );
}

export function CategoryCard() {
  return <Card id="plan-cats" testId="plan-cats" icon={<PieChart className="h-[18px] w-[18px]" />} title="Totals by category" sub="Monthly equivalent, yearly total and what to set aside"><CategoryTable /></Card>;
}

// ── Accounted for ───────────────────────────────────────────────────────────

export function AccountedCard() {
  const { plan } = usePicture();
  const { open } = useOverlay();
  const a = plan.accounted;
  const done = a.paid + a.covered;
  const pct = a.expected ? Math.round((done / a.expected) * 100) : 100;
  const ok = !a.missing.length && !a.uncovered.length;
  return (
    <Card id="plan-accounted" testId="plan-accounted" icon={ok ? <CircleCheck className="h-[18px] w-[18px]" /> : <TriangleAlert className="h-[18px] w-[18px]" />} title="Is everything accounted for?"
      sub={`This month: ${a.paid} paid, ${a.covered} still due and covered by cash`}>
      <div className="flex items-center gap-3"><div className={`bar flex-1 ${ok ? "pos" : ""}`} role="img" aria-label={`${done} of ${a.expected} accounted for`}><span style={{ width: `${pct}%` }} /></div><b className="tabular text-[14px]">{done} of {a.expected}</b></div>
      <p className="mini mt-2">Still due this month <b className="text-foreground">{fmt(a.upcomingTotal)}</b> against <b className="text-foreground">{fmt(a.cash)}</b> in checking.</p>
      {a.missing.length > 0 && <div className="pl-flags"><b>Expected but not seen</b>{a.missing.map(o => <button key={o.id} type="button" className="flag-btn" onClick={() => open(`plan:item:${o.id}`)}><CircleAlert className="h-4 w-4 shrink-0 text-negative" aria-hidden="true" />{o.label} · {money(o.amount)}</button>)}</div>}
      {a.uncovered.length > 0 && <div className="pl-flags"><b>Cash runs short before</b>{a.uncovered.map(o => <button key={o.id} type="button" className="flag-btn" onClick={() => open(`plan:item:${o.id}`)}><TriangleAlert className="h-4 w-4 shrink-0 text-negative" aria-hidden="true" />{o.label} · {money(o.amount)}</button>)}</div>}
    </Card>
  );
}

// ── Recommendations ─────────────────────────────────────────────────────────

export function RecsCard() {
  const pc = usePicture();
  const { open } = useOverlay();
  const go = (a?: string) => {
    if (a === "review") open("rcv");
    else if (a === "match" || a === "taxes") open("taxsavers");
    else if (a === "taxinputs") open("plan:taxes");
    else if (a === "upcoming") { const el = document.getElementById("plan-upcoming"); if (el) el.scrollIntoView({ behavior: "smooth" }); else pc.props.onNavigate?.("myfinances"); }
    else if (a === "giftcards") pc.props.onNavigate?.("giftcards");
  };
  const recs = pc.plan.recs;
  return (
    <Card testId="plan-recs" icon={<Lightbulb className="h-[18px] w-[18px]" />} title="Recommendations" sub={recs.length ? "Based on your own numbers. Dismiss what doesn't apply." : "Nothing to suggest right now."}>
      {recs.length > 0 && <ul className="pl-recs">{recs.map(r => (
        <li key={r.id} className={`pl-rec ${r.tone}`} data-testid="plan-rec">
          <div className="min-w-0 flex-1"><b>{r.title}</b><p>{r.why}</p>{r.action && <button type="button" className="pl-rec-go tap-44" onClick={() => go(r.action)}>{r.action === "review" ? "Review" : r.action === "upcoming" ? "See obligations" : r.action === "giftcards" ? "Open Gift Cards" : r.action === "taxinputs" ? "Add it" : "See details"}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}</div>
          <button type="button" className="icon-btn tap-44 shrink-0" aria-label={`Dismiss: ${r.title}`} onClick={() => { pc.act.dismissRec(r.id); toast("Recommendation dismissed", { id: "fp-rec", action: { label: "Undo", onClick: () => pc.act.restoreRec(r.id) } }); }}><X className="h-4 w-4" /></button>
        </li>
      ))}</ul>}
    </Card>
  );
}

// ── Where the money goes ────────────────────────────────────────────────────

const ALLOC_COLOR: Record<string, string> = {
  taxes: "hsl(var(--muted-foreground) / .55)", retirement: "hsl(270 45% 66%)", hsa: "hsl(190 60% 55%)", stock: "hsl(300 35% 60%)", savings: "hsl(var(--primary))",
  investments: "hsl(var(--info))", housing: "hsl(var(--negative) / .75)", debt: "hsl(20 80% 60%)", bills: "hsl(var(--warning) / .8)", spending: "hsl(210 25% 60%)", left: "hsl(var(--positive))",
};

export function AllocationCard() {
  const { plan } = usePicture();
  const [year, setYear] = useState(false);
  const P = year ? 12 : 1;
  const a = plan.allocation;
  const pos = a.slices.filter(s => s.monthly > 0);
  return (
    <Card testId="plan-allocation" icon={<Wallet className="h-[18px] w-[18px]" />} title="Where your money goes" sub={`Share of ${a.basis === "gross" ? "gross pay (est.)" : "take-home pay"}: ${fmt(a.income * P)}${year ? "/yr" : "/mo"}`}
      right={<Seg label="Allocation period" value={year ? "y" : "m"} onChange={v => setYear(v === "y")} options={[["m", "Month"], ["y", "Year"]]} />}>
      <div className="stack" role="img" aria-label={pos.map(s => `${s.label} ${s.share}%`).join(", ")}>{pos.map(s => <span key={s.key} style={{ flex: s.monthly, background: ALLOC_COLOR[s.key] }} />)}</div>
      <ul className="pl-alloc">{a.slices.map(s => (
        <li key={s.key}><span className="dot" style={{ background: ALLOC_COLOR[s.key] }} /><span className="min-w-0 flex-1 truncate">{s.label}</span><b>{fmt(s.monthly * P)}</b><small>{s.share}%</small></li>
      ))}</ul>
    </Card>
  );
}

// ── Taxes ───────────────────────────────────────────────────────────────────

function TaxBody({ full }: { full: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const t = pc.plan.taxes;
  const rows: [string, number, string][] = [
    ["Federal income tax withheld", t.fed, "from pay, this year"],
    ["Social Security & Medicare", t.fica, "from pay, this year"],
    ["Estimated & other tax payments", t.estimatedPayments, "seen in the last 12 months"],
    ["Property tax paid", t.propertyTax, "last 12 months · deductible if you itemize (SALT cap)"],
    [t.fsa > 0 ? "Saved by pre-tax 401(k), HSA & FSA" : "Saved by pre-tax 401(k) & HSA", t.preTaxSaved, `401(k) ${fmt(t.k401Saves)}${t.k401Source === "entered" ? " (your %)" : ""} · HSA ${fmt(t.hsaSaves)}${t.fsa > 0 ? ` · FSA ${fmt(t.fsaSaves)}` : ""}`],
    ...(t.mortgageInterest > 0 ? [[t.itemizeSaves > 0 ? "Saved by itemizing" : "Itemizing (standard is bigger)", t.itemizeSaves,
      `Mortgage interest + property tax ${fmt(t.itemized)} vs standard ${fmt(t.standardDeduction)}`] as [string, number, string]] : []),
  ];
  return <>
    <div className="pl-tax">{rows.map(([k, v, s]) => <div key={k}><span>{k}<small>{s}</small></span><b>{fmt(v)}</b></div>)}</div>
    <p className="mini mt-2">Top federal bracket {Math.round(t.marginalRate * 100)}%. All figures are estimates.</p>
    {full && <>
      <div className="h4">How we estimate</div>
      <ul className="pl-list">{t.assumptions.map(x => <li key={x}>{x}</li>)}</ul>
      {t.missing.length > 0 && <><div className="h4">Needs your input</div>
      <ul className="pl-list">{t.missing.map(x => <li key={x}>{x}</li>)}</ul></>}
      <TaxInputsForm />
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn" onClick={() => open("row:income:salary")}>Gross salary</button>
        <button type="button" className="btn" onClick={() => open("bracket")}>Filing status</button>
        <button type="button" className="btn" onClick={() => open("taxsavers")}>401(k), HSA & match</button>
      </div>
    </>}
  </>;
}

/** What bank data can't show: 401(k) % (when no payroll deduction is found), FSA and mortgage interest. Saved in settings.financialPicture.taxInputs. */
function TaxInputsForm() {
  const pc = usePicture();
  const ti = pc.fp.taxInputs ?? {};
  const payroll401k = pc.plan.taxes.k401Source === "payroll";
  const [pct, setPct] = useState(ti.k401Pct ? String(ti.k401Pct) : "");
  const [fsa, setFsa] = useState(ti.fsaAnnual ? String(ti.fsaAnnual) : "");
  const [mi, setMi] = useState(ti.mortgageInterestAnnual ? String(ti.mortgageInterestAnnual) : "");
  const num = (v: string) => { const n = Number(v.replace(/[$,%\s]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined; };
  const bad = (v: string) => { const n = Number(v.replace(/[$,%\s]/g, "")); return v.trim() !== "" && !(Number.isFinite(n) && n >= 0); };
  const pctN = num(pct);
  const ok = !bad(pct) && !bad(fsa) && !bad(mi) && (pctN === undefined || pctN <= 100);
  const field = "mt-1 w-full min-h-11 rounded-[10px] border border-border bg-transparent px-3 text-[14px]";
  return (
    <form className="space-y-3 mt-3" data-testid="tax-inputs" aria-label="Your tax inputs" onSubmit={e => {
      e.preventDefault(); if (!ok) return;
      pc.act.setTaxInputs({ k401Pct: pctN, fsaAnnual: num(fsa), mortgageInterestAnnual: num(mi) });
      toast.success("Tax inputs saved", { id: "fp-taxinputs" });
    }}>
      <div className="h4">Your tax inputs</div>
      <label className="block text-[13px]"><span className="text-muted-foreground">401(k) contribution, % of gross pay{payroll401k ? " (we use your paycheck deductions)" : ""}</span>
        <input className={field} inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} placeholder="e.g. 6" aria-label="401(k) contribution percent" disabled={payroll401k} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[13px]"><span className="text-muted-foreground">Health FSA per year</span>
          <input className={field} inputMode="decimal" value={fsa} onChange={e => setFsa(e.target.value)} placeholder="$0" aria-label="FSA per year" /></label>
        <label className="block text-[13px]"><span className="text-muted-foreground">Mortgage interest per year</span>
          <input className={field} inputMode="decimal" value={mi} onChange={e => setMi(e.target.value)} placeholder="$0" aria-label="Mortgage interest per year" /></label>
      </div>
      <button type="submit" className="btn-gold w-full" disabled={!ok}>Save tax inputs</button>
    </form>
  );
}

export function TaxCard() {
  const { open } = useOverlay();
  return <Card testId="plan-taxes" icon={<Receipt className="h-[18px] w-[18px]" />} title="Taxes paid & saved" sub="Estimates · state tax not included"
    right={<button type="button" className="sec-more tap-44" onClick={() => open("plan:taxes")}>Details<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}><TaxBody full={false} /></Card>;
}

// ── Net worth details ───────────────────────────────────────────────────────

const NW_LABEL: Record<NetWorthGroupKey, string> = { cash: "Cash & savings", credit: "Credit cards", loans: "Loans & mortgage", investments: "Investments" };

// ── Details ─────────────────────────────────────────────────────────────────

function ObligationDetail({ ob }: { ob: Obligation }) {
  const pc = usePicture();
  const { open, close } = useOverlay();
  const ra = useRecurringActions();
  const t = pc.plan.todayISO;
  const it = ob.reviewKey ? pc.m.review.items.find(i => i.key === ob.reviewKey) : undefined;
  const f = sinkingFund(ob, t);
  const manual = ob.manualId ? (pc.fp.manualItems ?? []).find(x => x.id === ob.manualId) : undefined;
  const kv: [string, ReactNode, string?][] = [
    ["Amount", `${ob.amountKind === "estimated" ? "~" : ""}${money(ob.amount)}`, ob.amountKind === "estimated" ? "estimate" : "each time"],
    ["How often", PLAN_CADENCE_LABEL[ob.cadence] + (ob.cadence === "custom" && ob.intervalDays ? ` · ${ob.intervalDays} days` : ""), ob.monthly ? `${money(ob.monthly)}/mo · ${fmt(ob.annual)}/yr` : undefined],
    ["Next expected", ob.nextDue ? shortDate(ob.nextDue, t) : "—", ob.nextDue ? (ob.nextDue < t ? `${diffDays(t, ob.nextDue)} days ago` : `in ${diffDays(ob.nextDue, t)} days`) : undefined],
    ["Last paid", ob.lastPaid ? money(ob.lastPaid.amount) : "—", ob.lastPaid ? shortDate(ob.lastPaid.date, t) : ob.source === "manual" ? "added by you" : undefined],
  ];
  return (
    <div data-testid="plan-item-detail">
      <div className="flex flex-wrap items-center gap-2 mb-3"><span className={STATUS[ob.source].cls}>{STATUS[ob.source].text}</span><span className="pl-st">{CATEGORY_LABEL[ob.category]}</span>{ob.missed && <span className="pl-st bad">Overdue</span>}</div>
      <div className="kv">{kv.map(([k, v, s]) => <div key={k}><div className="k">{k}</div><div className="v">{v}</div>{s && <div className="mini">{s}</div>}</div>)}</div>
      {f && <p className="note mt-3">Set aside <b>{money(f.perMonth)}/mo</b> and this is covered every time{f.toBeReady > f.perMonth + 1 ? ` (${money(f.toBeReady)}/mo to have it all by ${shortDate(ob.nextDue!, t)} starting from zero)` : ""}.</p>}
      {ob.reminderDays ? <p className="mini mt-2">Reminder {ob.reminderDays} day{ob.reminderDays === 1 ? "" : "s"} before it's due{ob.nextDue ? ` (${shortDate(addDays(ob.nextDue, -ob.reminderDays), t)})` : ""}.</p> : null}
      {ob.notes && <p className="note mt-2">{ob.notes}</p>}
      <div className="rcv-btns mt-4">
        {it && it.status === "suggested" && <button type="button" className="btn-gold" onClick={() => { ra.confirm(it); close(); }}><Check className="h-4 w-4" aria-hidden="true" />Confirm</button>}
        {it && <button type="button" className="btn" onClick={() => open(`rcv:item:${encodeURIComponent(it.key)}`)}>Edit</button>}
        {it && <button type="button" className="btn" onClick={() => { ra.dismiss(it); close(); }}><X className="h-4 w-4" aria-hidden="true" />{it.status === "suggested" ? "Not a bill" : "Remove"}</button>}
        {manual && <button type="button" className="btn" onClick={() => open(`plan:edit:${manual.id}`)}>Edit</button>}
        {manual && <button type="button" className="btn" onClick={() => {
          pc.act.removeManualItem(manual.id); close();
          toast(`${manual.label} removed`, { id: "fp-plan", action: { label: "Undo", onClick: () => pc.act.restoreManualItem(manual) } });
        }}><X className="h-4 w-4" aria-hidden="true" />Remove</button>}
        {ob.source === "giftcard" && pc.props.onNavigate && <button type="button" className="btn" onClick={() => { close(); pc.props.onNavigate!("giftcards"); }}>Open Gift Cards</button>}
      </div>
    </div>
  );
}

const CADENCE_CHOICES: PlanCadence[] = ["weekly", "biweekly", "monthly", "quarterly", "semiannual", "yearly", "custom", "once"];

function PlanForm({ editId }: { editId?: string }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const ex = editId ? (pc.fp.manualItems ?? []).find(x => x.id === editId) : undefined;
  const [label, setLabel] = useState(ex?.label ?? "");
  const [category, setCategory] = useState<ObligationCategory>(ex?.category ?? "other");
  const [amount, setAmount] = useState(ex ? String(ex.amount ?? ex.monthly) : "");
  const [amountKind, setAmountKind] = useState<"fixed" | "estimated">(ex?.amountKind ?? "fixed");
  const [cadence, setCadence] = useState<PlanCadence>(ex?.cadence ?? "monthly");
  const [interval, setInterval] = useState(ex?.intervalDays ? String(ex.intervalDays) : "");
  const [nextDue, setNextDue] = useState(ex?.nextDue ?? "");
  const [reminder, setReminder] = useState(ex?.reminderDays ? String(ex.reminderDays) : "");
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const amt = Number(amount.replace(/[$,\s]/g, ""));
  const days = Math.round(Number(interval));
  const ok = label.trim().length > 0 && Number.isFinite(amt) && amt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(nextDue) && (cadence !== "custom" || days >= 1);
  const submit = () => {
    if (!ok) return;
    const it: PlanItemInput = { label, category, amount: Math.round(amt * 100) / 100, amountKind, cadence, intervalDays: cadence === "custom" ? days : undefined, nextDue, reminderDays: Number(reminder) > 0 ? Math.round(Number(reminder)) : undefined, notes };
    if (ex) pc.act.updatePlanItem(ex.id, it); else pc.act.addPlanItem(it);
    toast.success(ex ? `${label.trim()} updated` : `${label.trim()} added to your Picture`, { id: "fp-plan" });
    close();
  };
  const field = "mt-1 w-full min-h-11 rounded-[10px] border border-border bg-transparent px-3 text-[14px]";
  return (
    <form className="space-y-3" data-testid="plan-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      <p className="mini">For expenses that don't show up in your bank transactions, or that you want to see coming. Every item needs an amount.</p>
      <label className="block text-[13px]"><span className="text-muted-foreground">Name</span><input className={field} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Car registration" aria-label="Name" /></label>
      <label className="block text-[13px]"><span className="text-muted-foreground">Category</span>
        <select className={field} value={category} onChange={e => setCategory(e.target.value as ObligationCategory)} aria-label="Category">{OBLIGATION_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[13px]"><span className="text-muted-foreground">Amount</span><span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Amount" aria-invalid={amount !== "" && !(amt > 0)} /></span></label>
        <label className="block text-[13px]"><span className="text-muted-foreground">Amount is</span>
          <select className={field} value={amountKind} onChange={e => setAmountKind(e.target.value as "fixed" | "estimated")} aria-label="Amount is"><option value="fixed">Fixed</option><option value="estimated">An estimate</option></select></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[13px]"><span className="text-muted-foreground">How often</span>
          <select className={field} value={cadence} onChange={e => setCadence(e.target.value as PlanCadence)} aria-label="How often">{CADENCE_CHOICES.map(c => <option key={c} value={c}>{c === "custom" ? "Every N days" : PLAN_CADENCE_LABEL[c]}</option>)}</select></label>
        <label className="block text-[13px]"><span className="text-muted-foreground">{cadence === "once" ? "Due date" : "Next due"}</span><input type="date" className={field} value={nextDue} onChange={e => setNextDue(e.target.value)} aria-label="Next due date" /></label>
      </div>
      {cadence === "custom" && <label className="block text-[13px]"><span className="text-muted-foreground">Every how many days</span><input className={field} inputMode="numeric" value={interval} onChange={e => setInterval(e.target.value)} aria-label="Every how many days" /></label>}
      <label className="block text-[13px]"><span className="text-muted-foreground">Remind me (days before, optional)</span><input className={field} inputMode="numeric" value={reminder} onChange={e => setReminder(e.target.value)} aria-label="Reminder days before" /></label>
      <label className="block text-[13px]"><span className="text-muted-foreground">Notes (optional)</span><textarea className={`${field} py-2`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} aria-label="Notes" /></label>
      <button type="submit" className="btn-gold w-full" disabled={!ok}>{ex ? "Save" : "Add expense"}</button>
    </form>
  );
}

function NetWorthDetail({ g }: { g: NetWorthGroupKey }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const grp = pc.plan.nw.groups[g];
  const owed = g === "credit" || g === "loans";
  return <>
    <p className="mini mb-3">{owed ? "What you owe" : "What you have"}: <b className="text-foreground">{fmt(grp.total)}</b> across {grp.accounts.length} account{grp.accounts.length === 1 ? "" : "s"}.</p>
    {grp.accounts.length ? <div className="rows">{grp.accounts.map(a => <div key={a.id} className="pl-nw static"><span>{a.label}<small>{a.sub}</small></span><b>{fmt(a.balance)}</b><span /></div>)}</div> : <p className="mini">No accounts here.</p>}
    {pc.props.onNavigate && <button type="button" className="btn w-full mt-3" onClick={() => { close(); pc.props.onNavigate!("accounts"); }}>Open Accounts</button>}
  </>;
}

// eslint-disable-next-line react-refresh/only-export-components -- overlay renderer, like details.tsx
export function renderPlanDetail(key: string, pc: PictureState): DetailView | null {
  if (key === "plan:add") return { title: "Add an expense", body: <PlanForm /> };
  if (key.startsWith("plan:edit:")) return { title: "Edit expense", body: <PlanForm key={key} editId={key.slice(10)} /> };
  if (key.startsWith("plan:item:")) {
    const ob = pc.plan.obligations.find(o => o.id === key.slice(10));
    return ob ? { title: ob.label, body: <ObligationDetail key={key} ob={ob} /> } : null;
  }
  if (key === "plan:taxes") return { title: "Taxes paid & saved (estimates)", body: <TaxBody full /> };
  if (key.startsWith("plan:nw:")) { const g = key.slice(8) as NetWorthGroupKey; return NW_LABEL[g] ? { title: NW_LABEL[g], body: <NetWorthDetail g={g} /> } : null; }
  return null;
}
