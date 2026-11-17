/**
 * My Financial Picture as an inventory (Dilip, Nov 17: "a full picture of
 * all my finances and obligations and savings and expenses in one place"):
 * a compact header, then Income, Obligations & expenses (plan.tsx),
 * Savings & contributions, and Accounts & balances. Every row shows its
 * amount, how often, the next date, its status and the yearly total.
 * Analysis (taxes, where the money goes, recommendations, the monthly
 * breakdown) lives on the Insights screen.
 *
 * Overlay keys: "inv:add-income", "inv:income:<manual id>".
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, ChevronRight, Gift, Landmark, Lightbulb, PiggyBank, Plus, Wallet, X } from "lucide-react";
import { diffDays } from "@/lib/recurring/dates";
import type { ReviewItem } from "@/lib/recurring";
import type { NetWorthGroupKey } from "@/lib/picture/overview";
import { usePicture, type PictureState } from "./state";
import { useOverlay, type DetailView } from "./overlays";
import { fmt } from "./bits";

const CADENCE_WORD: Record<string, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly", quarterly: "Every 3 months", semiannual: "Every 6 months", yearly: "Yearly",
};
const shortDate = (d: string, today: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined });

export type Tag = { text: string; cls: "det" | "ok" | "man" | "bad" | "warn" | "" };

/** One inventory line: next date, name + how often, status tags, amount and yearly total. */
export function InvRow({ label, sub, amount, per, annual, next, tags, onClick, testId }: {
  label: string; sub?: string; amount: number; per: string; annual: number; next?: string | null; tags: Tag[]; onClick?: () => void; testId: string;
}) {
  const t = usePicture().plan.todayISO;
  const soon = !!next && next >= t && diffDays(next, t) <= 7;
  const body = <>
    <span className="pl-date" aria-hidden="true">{next ? <><b>{new Date(`${next}T12:00:00`).getDate()}</b><small>{new Date(`${next}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</small></> : <small>—</small>}</span>
    <span className="pl-lbl"><b>{label}</b>{sub && <small>{sub}</small>}
      {tags.length > 0 && <span className="pl-tags">{tags.map(x => <span key={x.text} className={`pl-st ${x.cls}`}>{x.text}</span>)}</span>}
    </span>
    <span className="pl-amt">{fmt(amount)}<i className="pl-per">{per}</i><small>{fmt(annual)}/yr</small></span>
  </>;
  const aria = `${label}, ${fmt(amount)}${per}, ${fmt(annual)} a year${next ? `, next ${shortDate(next, t)}` : ""}`;
  return onClick
    ? <button type="button" className={`pl-row ${soon ? "soon" : ""}`} data-testid={testId} onClick={onClick} aria-label={`${aria}. Details`}>{body}</button>
    : <div className="pl-row static" data-testid={testId} aria-label={aria}>{body}</div>;
}

function Section({ id, icon, title, sub, right, children, testId }: { id?: string; icon: ReactNode; title: string; sub?: ReactNode; right?: ReactNode; children?: ReactNode; testId: string }) {
  return (
    <section className="sec pl-card" id={id} data-testid={testId} aria-label={title}>
      <div className="sec-h"><span className="sec-ico" aria-hidden="true">{icon}</span><div className="min-w-0 flex-1"><h3 className="sec-t">{title}</h3>{sub && <div className="sec-s">{sub}</div>}</div>{right}</div>
      {children}
    </section>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

export function PictureSummary() {
  const { plan } = usePicture();
  const outs = plan.next30.events.filter(e => e.direction === "outflow");
  const setAside = plan.totals.reduce((s, t) => s + t.setAside, 0);
  const monthly = plan.totals.reduce((s, t) => s + t.monthly, 0);
  const annual = plan.totals.reduce((s, t) => s + t.annual, 0);
  const items = plan.totals.reduce((s, t) => s + t.count, 0);
  const a = plan.accounted;
  const done = a.paid + a.covered;
  const pct = a.expected ? Math.round((done / a.expected) * 100) : 100;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <section className="pl-summary inv-summary" aria-label="Summary" data-testid="plan-summary">
      <button type="button" className="pl-metric" data-testid="sum-obligations" onClick={() => go("plan-upcoming")}>
        <span>Obligations this year</span><strong>{fmt(annual)}</strong><small>{fmt(monthly)}/mo · {items} item{items === 1 ? "" : "s"}</small>
      </button>
      <button type="button" className="pl-metric" data-testid="sum-setaside" onClick={() => go("plan-upcoming")}>
        <span>Set aside monthly</span><strong>{fmt(setAside)}</strong><small>for non-monthly bills</small>
      </button>
      <button type="button" className="pl-metric" data-testid="sum-next30" onClick={() => go("plan-upcoming")}>
        <span>Due next 30 days</span><strong>{fmt(plan.next30.outflow)}</strong><small>{outs.length} payment{outs.length === 1 ? "" : "s"}</small>
      </button>
      <button type="button" className={`pl-metric ${a.missing.length || a.uncovered.length ? "warn" : ""}`} data-testid="sum-accounted" onClick={() => go("plan-accounted")}>
        <span>Accounted for</span><strong>{done} of {a.expected}</strong><small>{a.missing.length ? `${a.missing.length} not seen yet` : `${pct}% this month`}</small>
      </button>
      <button type="button" className="pl-metric" data-testid="sum-income" onClick={() => go("pic-income")}>
        <span>Income a year</span><strong>{fmt(plan.incomeMonthly * 12)}</strong><small>{fmt(plan.incomeMonthly)}/mo take-home</small>
      </button>
      <button type="button" className="pl-metric" data-testid="sum-savings" onClick={() => go("pic-savings")}>
        <span>Saving a year</span><strong>{fmt(plan.savingsMonthly * 12)}</strong><small>{fmt(plan.savingsMonthly)}/mo set aside</small>
      </button>
    </section>
  );
}

// ── Income ──────────────────────────────────────────────────────────────────

function payTags(items: ReviewItem[], edited: boolean, estimated: boolean): Tag[] {
  const out: Tag[] = [];
  if (edited) out.push({ text: "Set by you", cls: "man" });
  else if (estimated) out.push({ text: "Estimated", cls: "det" });
  else if (items.some(i => i.status === "confirmed")) out.push({ text: "Confirmed", cls: "ok" });
  else if (items.length) out.push({ text: "Detected", cls: "det" });
  if (items.some(i => i.missed)) out.push({ text: "Late", cls: "bad" });
  return out;
}

export function IncomeSection() {
  const pc = usePicture();
  const { open } = useOverlay();
  const rows = pc.m.rows.income;
  const all = [...pc.m.review.items, ...pc.m.review.dismissed].filter(i => i.direction === "inflow");
  const pay = all.filter(i => i.kind === "salary");
  const other = pc.m.review.items.filter(i => i.direction === "inflow" && i.kind !== "salary");
  const nextOf = (list: ReviewItem[]) => list.map(i => i.nextDue).filter((d): d is string => !!d && d >= pc.plan.todayISO).sort()[0] ?? null;
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  return (
    <Section id="pic-income" testId="pic-income" icon={<Wallet className="h-[18px] w-[18px]" />} title="Income"
      sub={<>Take-home <b className="text-foreground">{fmt(total)}/mo</b> · {fmt(total * 12)} a year</>}
      right={<button type="button" className="btn tap-44 pl-add" onClick={() => open("inv:add-income")}><Plus className="h-4 w-4" aria-hidden="true" />Add income</button>}>
      <div className="rows">
        {rows.map(r => {
          if (r.id === "salary") {
            const estimated = !pay.length && r.monthly > 0 && !r.edited;
            const cad = pay[0] ? (pay[0].pattern || CADENCE_WORD[pay[0].cadence]) : estimated ? "Averaged from recent paychecks" : "No paychecks found yet";
            return <InvRow key={r.id} testId="inv-income" label={pay.length > 1 ? `Salary · ${pay.length} employers` : pay[0] ? `Salary · ${pay[0].label}` : "Salary"} sub={cad}
              amount={r.monthly} per="/mo" annual={r.monthly * 12} next={nextOf(pay)} tags={payTags(pay, !!r.edited, estimated)} onClick={() => open("row:income:salary")} />;
          }
          if (r.manualId) return <InvRow key={r.id} testId="inv-income" label={r.label} sub="Monthly" amount={r.monthly} per="/mo" annual={r.monthly * 12} tags={[{ text: "Added by you", cls: "man" }]} onClick={() => open(`inv:income:${r.manualId}`)} />;
          const list = r.id === "other" ? other : [];
          return <InvRow key={r.id} testId="inv-income" label={r.label} sub={r.sub} amount={r.monthly} per="/mo" annual={r.monthly * 12} next={nextOf(list)}
            tags={r.edited ? [{ text: "Set by you", cls: "man" }] : r.id === "bonus" ? [{ text: "Averaged", cls: "det" }] : payTags(list, false, false)} onClick={() => open(`row:income:${r.id}`)} />;
        })}
      </div>
    </Section>
  );
}

function IncomeForm({ editId }: { editId?: string }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const ex = editId ? (pc.props.manualIncome ?? []).find(x => x.id === editId) : undefined;
  const [label, setLabel] = useState(ex?.label ?? "");
  const [amount, setAmount] = useState(ex ? String(ex.amount) : "");
  const [acct, setAcct] = useState(ex?.accountId ?? "");
  const amt = Number(amount.replace(/[$,\s]/g, ""));
  const ok = label.trim().length > 0 && Number.isFinite(amt) && amt > 0;
  const field = "mt-1 w-full min-h-11 rounded-[10px] border border-border bg-transparent px-3 text-[14px]";
  const banks = pc.m.accounts.filter(a => a.kind === "bank" || a.kind === "save");
  return (
    <form className="space-y-3" data-testid="income-form" onSubmit={e => {
      e.preventDefault(); if (!ok) return;
      const it = { label, amount: amt, accountId: acct || undefined };
      if (ex) pc.act.updateIncome(ex.id, it); else pc.act.addIncome(it);
      toast.success(ex ? `${label.trim()} updated` : `${label.trim()} added to your income`, { id: "fp-income" });
      close();
    }}>
      <p className="mini">Income that doesn't arrive as a regular deposit we can detect: a pension, rent from a tenant, side work, child support.</p>
      <label className="block text-[13px]"><span className="text-muted-foreground">Name</span><input className={field} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Rental income" aria-label="Income name" /></label>
      <label className="block text-[13px]"><span className="text-muted-foreground">Take-home per month</span><span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Take-home per month" aria-invalid={amount !== "" && !(amt > 0)} /></span></label>
      {banks.length > 0 && <label className="block text-[13px]"><span className="text-muted-foreground">Lands in (optional)</span>
        <select className={field} value={acct} onChange={e => setAcct(e.target.value)} aria-label="Lands in"><option value="">Not set</option>{banks.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
      <button type="submit" className="btn-gold w-full" disabled={!ok}>{ex ? "Save" : "Add income"}</button>
      {ex && <button type="button" className="btn w-full" onClick={() => {
        pc.act.removeIncome(ex.id); close();
        toast(`${ex.label} removed`, { id: "fp-income", action: { label: "Undo", onClick: () => pc.act.restoreIncome(ex) } });
      }}><X className="h-4 w-4" aria-hidden="true" />Remove</button>}
    </form>
  );
}

// ── Savings & contributions ─────────────────────────────────────────────────

export function SavingsSection() {
  const pc = usePicture();
  const { open } = useOverlay();
  const t = pc.plan.todayISO;
  const ded = pc.m.rows.deductions;
  const dedOf = (id: string) => ded.find(r => r.id === id);
  const lines: { key: string; el: ReactNode; monthly: number }[] = [];
  const k401 = dedOf("k401");
  const k401m = pc.plan.k401Monthly;
  if (k401m > 0 || k401?.edited) lines.push({ key: "k401", monthly: k401m, el: <InvRow key="k401" testId="inv-saving" label="401(k)" sub={pc.plan.k401Source === "entered" ? "Every paycheck · from the % you entered" : "Every paycheck · pre-tax"} amount={k401m} per="/mo" annual={k401m * 12}
    tags={[k401?.edited || pc.plan.k401Source === "entered" ? { text: "Set by you", cls: "man" } : { text: "Detected", cls: "det" }]} onClick={() => open("row:deductions:k401")} /> });
  for (const id of ["hsa", "espp"]) {
    const r = dedOf(id);
    if (!r || !(r.monthly > 0)) continue;
    lines.push({ key: id, monthly: r.monthly, el: <InvRow key={id} testId="inv-saving" label={r.label} sub={id === "hsa" ? "Every paycheck · pre-tax" : "Every paycheck · after tax"} amount={r.monthly} per="/mo" annual={r.monthly * 12}
      tags={[r.edited ? { text: "Set by you", cls: "man" } : r.tags?.includes("det") ? { text: "Detected", cls: "det" } : { text: "Added by you", cls: "man" }]} onClick={() => open(`row:deductions:${id}`)} /> });
  }
  const fsa = pc.fp.taxInputs?.fsaAnnual ?? 0;
  if (fsa > 0) lines.push({ key: "fsa", monthly: fsa / 12, el: <InvRow key="fsa" testId="inv-saving" label="Health FSA" sub="Every paycheck · pre-tax" amount={fsa / 12} per="/mo" annual={fsa} tags={[{ text: "Set by you", cls: "man" }]} onClick={() => open("plan:taxes")} /> });
  for (const r of pc.m.rows.savings) {
    const goal = r.goalId ? pc.goals.find(g => g.id === r.goalId) : undefined;
    const to = r.toId ? pc.acct(r.toId)?.label : undefined;
    const sub = [goal?.targetAmount ? `Goal ${fmt(goal.targetAmount)}${goal.targetDate ? ` by ${shortDate(goal.targetDate, t)}` : ""}` : "Monthly", to && to !== r.label ? `into ${to}` : null].filter(Boolean).join(" · ");
    lines.push({ key: r.id, monthly: r.monthly, el: <InvRow key={r.id} testId="inv-saving" label={r.label} sub={sub} amount={r.monthly} per="/mo" annual={r.monthly * 12} next={goal?.targetDate ?? null}
      tags={[r.goalId ? { text: "Added by you", cls: "man" } : { text: "Detected", cls: "det" }]} onClick={() => open(`row:savings:${r.id}`)} /> });
  }
  const sink = pc.plan.totals.reduce((s, c) => s + c.setAside, 0);
  const total = lines.reduce((s, l) => s + l.monthly, 0);
  return (
    <Section id="pic-savings" testId="pic-savings" icon={<PiggyBank className="h-[18px] w-[18px]" />} title="Savings & contributions"
      sub={<>Set aside <b className="text-foreground">{fmt(total)}/mo</b> · {fmt(total * 12)} a year</>}
      right={<button type="button" className="btn tap-44 pl-add" onClick={() => open("add:savings")}><Plus className="h-4 w-4" aria-hidden="true" />Add savings</button>}>
      <div className="rows">
        {lines.map(l => l.el)}
        {sink > 0 && <InvRow testId="inv-saving" label="Sinking fund for non-monthly bills" sub="Monthly · covers quarterly, twice-a-year and yearly bills" amount={sink} per="/mo" annual={sink * 12} tags={[{ text: "Suggested", cls: "" }]}
          onClick={() => document.getElementById("plan-upcoming")?.scrollIntoView({ behavior: "smooth", block: "start" })} />}
        {!lines.length && !sink && <p className="mini py-2">Nothing set aside yet. Add a savings goal, or your 401(k) / HSA from a pay stub.</p>}
      </div>
    </Section>
  );
}

// ── Accounts & balances ─────────────────────────────────────────────────────

const NW_LABEL: Record<NetWorthGroupKey, string> = { cash: "Cash & savings", credit: "Credit cards", loans: "Loans & mortgage", investments: "Investments" };

export function AccountsSection() {
  const pc = usePicture();
  const { open } = useOverlay();
  const { nw, giftCards: gc, benefits, creditCardCount } = pc.plan;
  const g = nw.groups;
  const nav = pc.props.onNavigate;
  return (
    <Section testId="plan-networth" icon={<Landmark className="h-[18px] w-[18px]" />} title="Accounts & balances" sub={<>Assets {fmt(nw.assets)} · Owed {fmt(nw.liabilities)}</>}
      right={<span className="text-right"><b className="kpi text-[20px] block">{fmt(nw.netWorth)}</b><small className="mini">net worth</small></span>}>
      <div className="rows">
        {(Object.keys(NW_LABEL) as NetWorthGroupKey[]).filter(k => g[k].accounts.length).map(k => (
          <button key={k} type="button" className="pl-nw" onClick={() => open(`plan:nw:${k}`)}><span>{NW_LABEL[k]}<small>{g[k].accounts.length} account{g[k].accounts.length === 1 ? "" : "s"}</small></span><b className={k === "credit" || k === "loans" ? "text-negative" : ""}>{k === "credit" || k === "loans" ? "−" : ""}{fmt(g[k].total)}</b><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
        ))}
        <button type="button" className="pl-nw" data-testid="plan-more" onClick={() => nav?.("giftcards")} disabled={!nav}><span><span className="inline-flex items-center gap-1.5"><Gift className="h-3.5 w-3.5" aria-hidden="true" />Gift cards</span><small>{gc.count ? `${gc.count} card${gc.count === 1 ? "" : "s"}${gc.expiringSoon ? ` · ${gc.expiringSoon} expiring soon` : ""}` : pc.plan.giftCardsLoaded ? "None saved" : "Loading…"}</small></span><b>{fmt(gc.total)}</b><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
        <button type="button" className="pl-nw" onClick={() => nav?.("benefits")} disabled={!nav}><span>Card perks<small>{benefits ? `${benefits.totalPerks} perks · ${benefits.pendingActions} to use` : creditCardCount ? `Perks for your ${creditCardCount} credit card${creditCardCount === 1 ? "" : "s"}` : "No credit cards linked"}</small></span><b>{benefits ? benefits.completed : ""}</b><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
      </div>
    </Section>
  );
}

// ── Link to Insights ────────────────────────────────────────────────────────

export function InsightsLink() {
  const nav = usePicture().props.onNavigate;
  if (!nav) return null;
  return (
    <button type="button" className="inv-insights" data-testid="open-insights" onClick={() => nav("insights")}>
      <Lightbulb className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1"><b>Insights</b><small>Taxes paid & saved, where your money goes, recommendations and the monthly breakdown</small></span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- overlay renderer, like details.tsx
export function renderInventoryDetail(key: string, pc: PictureState): DetailView | null {
  if (key === "inv:add-income") return { title: "Add income", body: <IncomeForm /> };
  if (key.startsWith("inv:income:")) {
    const id = key.slice(11);
    const it = (pc.props.manualIncome ?? []).find(x => x.id === id);
    return it ? { title: it.label, body: <IncomeForm key={key} editId={id} /> } : null;
  }
  return null;
}
