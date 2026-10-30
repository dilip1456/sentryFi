/**
 * Detail views: the same content renders in the desktop dialog, a mobile
 * full screen or a mobile bottom sheet (see overlays.tsx).
 */
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowRight, Check, ChevronRight, CircleAlert, CircleCheck, Info, Lightbulb, Network, PiggyBank, Plus, Repeat, CreditCard,
  SlidersHorizontal, Trash2, TriangleAlert,
} from "lucide-react";
import { usePicture, type ListGroup, type PictureState } from "./state";
import { useOverlay, type DetailView } from "./overlays";
import { CovChip, Donut, Gauge, LimitBar, RadioList, SavingsStack, Tag, fmt, fmtSigned, pctOf } from "./bits";
import { SEC, COVER_GROUPS } from "./meta";
import { AmountInput, parseAmt } from "./data-column";
import { MatchBlock, TIERS, riskLabel, FLOW_COLORS } from "./insights";
import { ORDINAL, resolveBucket, shortDate, type AcctInfo, type CardInfo, type PictureGroup, type PictureRow, type PTxn } from "@/lib/picture/model";
import { whatIf, whatIfLimits } from "@/lib/picture/whatif";
import { RISK_LEVELS, riskGaugeValue, type RiskLevel } from "@/lib/picture/risk";
import { taxTable } from "@/lib/tax-tables";

const NEG = { color: "hsl(var(--negative-text))" };
const saved = () => toast.success("Saved. Your picture is updated.");

// ── small pieces ───────────────────────────────────────────────────────────

function KV({ items, cols }: { items: { k: string; v: ReactNode; sub?: ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <div className={`kv ${cols === 2 ? "!grid-cols-2" : cols === 1 ? "!grid-cols-1" : ""}`}>
      {items.map(x => (
        <div key={x.k}><div className="k">{x.k}</div><div className="v">{x.v}</div>{x.sub && <div className="text-[12px] text-muted-foreground">{x.sub}</div>}</div>
      ))}
    </div>
  );
}

function EvList({ txns, pc }: { txns: PTxn[]; pc: PictureState }) {
  if (!txns.length) return <p className="mini">No payments seen in your linked accounts yet.</p>;
  const open = pc.props.onOpenTxnDetail;
  return (
    <div className="lst">
      {txns.map(t => {
        const inner = (
          <>
            <span className="grow text-left">
              <span className="block truncate text-[13.5px]">{pc.acct(t.account_id)?.label ?? t.name}</span>
              <small>{shortDate(t.date)}, {t.date.slice(0, 4)}</small>
            </span>
            <b className="amt">{fmt(Math.abs(Number(t.amount)))}</b>
          </>
        );
        return open
          ? <button type="button" key={t.id} className="li !min-h-[44px] w-full" onClick={() => open(t)} aria-label={`Payment on ${t.date}, ${fmt(Math.abs(Number(t.amount)))}, open transaction`}>{inner}</button>
          : <div key={t.id} className="li !min-h-[44px]">{inner}</div>;
      })}
    </div>
  );
}

function AcctPicker({ label, pool, value, onChange }: { label: string; pool: AcctInfo[]; value: string | null; onChange: (id: string) => void }) {
  if (!pool.length) return <p className="mini">No linked accounts to choose from yet.</p>;
  return (
    <RadioList label={label} value={value} onChange={onChange}
      options={pool.map(a => ({ value: a.id, label: <>{a.name} {a.mask && <span className="text-muted-foreground">••{a.mask}</span>}</> }))} />
  );
}

/** One-field amount editor (row details), writes immediately. */
function AmountEditor({ g, r, className = "" }: { g: ListGroup; r: PictureRow; className?: string }) {
  const pc = usePicture();
  const [v, setV] = useState(String(Math.round(r.monthly)));
  const n = parseAmt(v);
  return (
    <form className={`flex items-end gap-2 mt-4 ${className}`} onSubmit={e => { e.preventDefault(); if (Number.isFinite(n) && n >= 0) { pc.act.setAmount(g, r.id, n); saved(); } }}>
      <label className="flex-1 text-[13px]">
        <span className="text-muted-foreground">Amount per month</span>
        <span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={v} onChange={e => setV(e.target.value)} aria-label={`${r.label} amount per month`} /></span>
      </label>
      <button type="submit" className="btn !min-h-[44px]" disabled={!Number.isFinite(n) || n < 0 || Math.round(n) === Math.round(r.monthly)}>Update</button>
    </form>
  );
}

// ── Section (mobile screen) ────────────────────────────────────────────────

function MRow({ g, r }: { g: ListGroup; r: PictureRow }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const right = g === "deductions" ? (r.tags ?? []).map(t => <Tag key={t} kind={t} />)
    : g === "savings" ? <CovChip acct={pc.acct(r.toId)} />
    : g === "income" || g === "taxes" ? null : <CovChip acct={pc.acct(r.coverId)} />;
  return (
    <button type="button" className="li w-full" onClick={() => open(`row:${g}:${r.id}`)} aria-label={`${r.label}, ${fmt(r.monthly * pc.P)} ${pc.perWord}, details`}>
      <span className="grow text-left">
        <span className="block font-medium truncate">{r.label}</span>
        {right && <span className="chips">{right}</span>}
      </span>
      <span className="amt">{fmt(r.monthly * pc.P)}<span>{pc.per}</span></span>
      <ChevronRight className="chev" aria-hidden="true" />
    </button>
  );
}

function CardChain({ c }: { c: CardInfo }) {
  const pc = usePicture();
  const items = [...pc.m.rows.obligations, ...pc.m.rows.fixed, ...pc.m.rows.budgets].filter(r => r.coverId === c.id);
  return (
    <div className={`map-acct${c.payoffId ? "" : " bad"} mb-2`}>
      <div className="chain">
        <CovChip acct={pc.acct(c.id)} /><ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <CovChip acct={pc.acct(c.payoffId)} text="No payoff account" />
      </div>
      <div className="map-items">
        {items.length ? items.map(r => <span key={r.group + r.id} className={`map-item${c.payoffId ? "" : " warn"}`}>{r.label} · {fmt(r.monthly)}</span>) : <span className="mini">Nothing assigned yet</span>}
      </div>
    </div>
  );
}

function SecDetail({ g }: { g: PictureGroup }) {
  const pc = usePicture();
  const { open } = useOverlay();
  if (g === "cards") {
    const cards = pc.m.cards;
    return (
      <>
        <div className="mb-4"><KV cols={2} items={[{ k: "Cards", v: cards.length }, { k: "Payoff set", v: `${cards.filter(c => c.payoffId).length} of ${cards.length}` }]} /></div>
        <div className="card-stack">
          {cards.map(c => {
            const charged = [...pc.m.rows.obligations, ...pc.m.rows.fixed, ...pc.m.rows.budgets].filter(r => r.coverId === c.id);
            const sum = charged.reduce((t, r) => t + r.monthly, 0);
            return (
              <button type="button" key={c.id} className={`card-item${c.payoffId ? "" : " bad"}`} onClick={() => open(`row:cards:${c.id}`)} aria-label={`${c.name} details`}>
                <span className="ci-top">
                  <CreditCard className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                  <span className="ci-name">{c.name}</span>
                  {c.mask && <span className="ci-mask">••{c.mask}</span>}
                  <ChevronRight className="chev" aria-hidden="true" />
                </span>
                <span className="ci-row"><span className="ci-k">Paid by</span><CovChip acct={pc.acct(c.payoffId)} text="No payoff account" /></span>
                <span className="ci-row"><span className="ci-k">Charged here</span>
                  <span className="ci-v">{charged.length ? <>{charged.length} item{charged.length === 1 ? "" : "s"} · {fmt(sum)}<span>/mo</span></> : "Nothing yet"}</span></span>
              </button>
            );
          })}
          {!cards.length && <p className="mini">No credit cards linked.</p>}
        </div>
        {cards.length > 0 && (
          <>
            <div className="h4 !mt-5">How cards are covered</div>
            {cards.map(c => <CardChain key={c.id} c={c} />)}
            <p className="note mt-2">Spending on a card is covered only when the card itself has a payoff account.</p>
          </>
        )}
      </>
    );
  }
  const rows = pc.rowsFor(g);
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  const due = (g === "obligations" || g === "fixed")
    ? rows.filter(r => r.dueDay).sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0))
    : [];
  return (
    <>
      <div className="mb-4"><KV cols={2} items={[{ k: "Total", v: <>{fmt(total * pc.P)}{pc.per}</> }, { k: g === "savings" ? "Goals" : "Items", v: rows.length }]} /></div>
      <div className="lst">{rows.map(r => <MRow key={r.id} g={g} r={r} />)}</div>
      {!rows.length && <p className="mini">Nothing here yet.</p>}
      {(g === "obligations" || g === "fixed" || g === "budgets" || g === "savings") && (
        <button type="button" className="btn w-full mt-4" onClick={() => open(`add:${g}`)}><Plus className="h-4 w-4" aria-hidden="true" />Add {g === "savings" ? "a goal" : g === "budgets" ? "a budget" : "one"}</button>
      )}
      {due.length > 0 && (
        <>
          <div className="h4 !mt-5">Due in {pc.m.nextMonthLabel}</div>
          <div className="lst">
            {due.map(r => (
              <div key={r.id} className="li !min-h-[44px]">
                <span className="w-[56px] text-[13px] text-muted-foreground shrink-0 tabular">{pc.m.nextMonthLabel.slice(0, 3)} {r.dueDay}</span>
                <span className="grow text-[14px] truncate">{r.label}</span>
                {r.coverId
                  ? <span className="text-[12.5px] flex items-center gap-1 text-positive"><CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />Covered</span>
                  : <span className="text-[12.5px] flex items-center gap-1" style={NEG}><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />Not covered</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {g === "deductions" && <p className="note mt-4"><Tag kind="pre" /> lowers your taxes now. <Tag kind="post" /> comes from already-taxed pay. <Tag kind="det" /> we found it, please confirm.</p>}
      {COVER_GROUPS.has(g) && <p className="note mt-4">"Covered by" is the account that pays it or that you save into for it. <CovChip acct={null} /> means nothing is set aside, so it's a red flag.</p>}
    </>
  );
}

// ── Row detail (sheet on mobile) ───────────────────────────────────────────

function CardRowDetail({ c }: { c: CardInfo }) {
  const pc = usePicture();
  const { open, close } = useOverlay();
  const [pick, setPick] = useState<string | null>(c.payoffId);
  const charged = [...pc.m.rows.obligations, ...pc.m.rows.fixed, ...pc.m.rows.budgets].filter(r => r.coverId === c.id);
  const payer = pc.acct(c.payoffId);
  const chooser = (
    <>
      <div className="h4">Which account pays this card?</div>
      <AcctPicker label="Payoff account" pool={pc.pool("cards")} value={pick} onChange={setPick} />
      <button type="button" className="btn-gold w-full mt-4" disabled={!pick || pick === c.payoffId} onClick={() => { if (pick) { pc.act.setCover("cards", c.id, pick); saved(); close(); } }}>Save</button>
    </>
  );
  if (!payer) {
    return (
      <>
        <div className="flags mb-4">
          <div className="font-semibold flex items-center gap-2" style={NEG}><TriangleAlert className="h-4 w-4" aria-hidden="true" />No payoff account</div>
          <p className="note mt-1 !text-foreground">
            We haven't seen {c.label} paid from any linked account.
            {charged.length ? ` ${charged.map(r => `${r.label} (${fmt(r.monthly)}/mo)`).join(", ")} ${charged.length === 1 ? "is" : "are"} charged here, so ${charged.length === 1 ? "it isn't" : "they aren't"} covered either.` : ""}
          </p>
        </div>
        {chooser}
      </>
    );
  }
  const last = c.lastPayment;
  return (
    <>
      <KV items={[
        { k: "Autopay", v: <span className="!text-[14px]">{c.payments.length >= 2 ? "Seen monthly" : "Not sure"}</span> },
        { k: "Due", v: <span className="!text-[14px]">{c.dueDay ? `~${ORDINAL(c.dueDay)}` : "—"}</span> },
        // last so the phone's 2-column grid gives the account name a full row
        { k: "Paid by", v: <span className="!text-[14px]">{payer.name}</span> },
      ]} />
      <div className="h4">Charged to this card</div>
      <div className="flex flex-wrap gap-2">{charged.length ? charged.map(r => <span key={r.group + r.id} className="map-item">{r.label}</span>) : <span className="mini">Nothing assigned yet</span>}</div>
      <p className="note mt-4">{c.payoffSource === "user" ? `You set ${payer.label} as the account that pays this card.` : `Detected from card payments paired with ${payer.label}.`}{last ? ` Last payment ${shortDate(last.date)}: ${fmt(Math.abs(Number(last.amount)))}.` : ""}</p>
      <button type="button" className="btn w-full mt-4" onClick={() => open(`pick:cards:${c.id}`)}>Change payoff account</button>
    </>
  );
}

function CoverBlock({ g, r }: { g: ListGroup; r: PictureRow }) {
  const pc = usePicture();
  const { open, close } = useOverlay();
  const [pick, setPick] = useState<string | null>(null);
  const a = pc.acct(r.coverId);
  if (!a) {
    return (
      <>
        <div className="flags mt-4">
          <div className="font-semibold flex items-center gap-2" style={NEG}><TriangleAlert className="h-4 w-4" aria-hidden="true" />Not covered</div>
          <p className="note mt-1 !text-foreground">{r.unassignedReason ?? `Nothing pays ${r.label} yet. Pick an account so it counts in your plan.`}</p>
        </div>
        <div className="h4">Covered by</div>
        <AcctPicker label="Covered by" pool={pc.pool(g)} value={pick} onChange={setPick} />
        <button type="button" className="btn-gold w-full mt-4" disabled={!pick} onClick={() => { if (pick) { pc.act.setCover(g, r.id, pick); saved(); close(); } }}>Save</button>
      </>
    );
  }
  const card = a.kind === "card" ? pc.m.cards.find(c => c.id === a.id) : undefined;
  const title = r.setAside ? "Saving for it" : card ? "Charged to card" : r.autopayDetected ? "Looks like autopay" : "Paid from";
  const desc = r.setAside
    ? `${fmt(r.setAside.monthly)}/mo goes to ${a.label}; it pays the ${fmt(r.perPayment ?? r.monthly)} bill`
    : card ? `${a.label}, ${card.payoffId ? `paid off by ${pc.acct(card.payoffId)?.name}` : "which has no payoff account yet"}`
    : `From ${a.label}${r.dueText ? ` on the ${r.dueText.replace(/^~/, "")}` : ""}`;
  const Icon = r.setAside ? PiggyBank : card ? CreditCard : Repeat;
  return (
    <div className="pay-block mt-4 rounded-[10px] border p-3 flex items-center gap-3" style={{ borderColor: "hsl(var(--positive) / .35)", background: "hsl(var(--positive) / .06)" }}>
      <Icon className="h-5 w-5 text-positive shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0"><div className="font-semibold text-positive">{title}</div><div className="text-[13px] text-muted-foreground">{desc}</div></div>
      <button type="button" className="btn !min-h-[44px]" onClick={() => open(`pick:${g}:${r.id}`)}>Change</button>
    </div>
  );
}

function SavingsGoalForm({ r }: { r: PictureRow }) {
  const pc = usePicture();
  const [target, setTarget] = useState(r.target ? String(r.target) : "");
  const [by, setBy] = useState(r.by ?? "");
  const t = parseAmt(target);
  const submit = () => {
    if (!(t > 0)) return;
    pc.props.onUpdate({ savingsGoals: r.goalId
      ? pc.goals.map(g => (g.id === r.goalId ? { ...g, targetAmount: t, targetDate: by || undefined } : g))
      : [...pc.goals, { id: `sg_${Date.now()}`, name: r.label, monthlyTarget: Math.round(r.monthly), accountId: r.toId ?? undefined, fromAccountId: r.fromId ?? undefined, kind: "transfer", targetAmount: t, targetDate: by || undefined, createdAt: new Date().toISOString() }] });
    saved();
  };
  return (
    <form className="grid grid-cols-2 gap-2 mt-2" onSubmit={e => { e.preventDefault(); submit(); }}>
      <label className="text-[13px]"><span className="text-muted-foreground">Goal amount</span>
        <span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} aria-label="Goal amount" /></span></label>
      <label className="text-[13px]"><span className="text-muted-foreground">By (optional)</span>
        <input type="date" className="amt-in mt-1 !w-full !h-11 px-2" value={by} onChange={e => setBy(e.target.value)} aria-label="Goal date" /></label>
      <button type="submit" className="btn col-span-2" disabled={!(t > 0)}>{r.target ? "Update goal" : "Set goal"}</button>
    </form>
  );
}

function RowDetail({ g, r }: { g: ListGroup; r: PictureRow }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const [grossEdit, setGrossEdit] = useState(false);
  const [gross, setGross] = useState(String(Math.round(pc.m.gross.annual)));
  const third = r.dueText ? { k: "Due", v: <span className="!text-[15px]">{r.dueText}</span> }
    : r.spent != null ? { k: "Spent so far", v: fmt(r.spent) }
    : { k: "Type", v: <span className="!text-[15px]">{g === "deductions" ? (r.tags?.includes("pre") ? "Pre-tax" : "Post-tax") : SEC[g].t}</span> };
  const coverK = g === "savings" || g === "deductions" ? "Goes to" : g === "income" ? "Lands in" : "Covered by";
  const coverV = g === "savings" || g === "deductions" ? <CovChip acct={pc.acct(r.toId)} text="Not linked" />
    : g === "taxes" ? (r.id === "fedtax" || r.id === "fica" ? <span className="text-[14px]">Withheld by payroll</span> : <CovChip acct={pc.acct(r.coverId)} />)
    : g === "income" ? <span className="text-[14px]">{pc.acct(r.coverId ?? r.txns[0]?.account_id)?.label ?? "—"}</span>
    : <CovChip acct={pc.acct(r.coverId)} />;
  const head = <div className="mb-1"><KV items={[{ k: "Amount", v: fmt(r.monthly * pc.P), sub: pc.perWord }, third, { k: coverK, v: <div className="mt-1">{coverV}</div> }]} /></div>;
  const salary = g === "income" && r.id === "salary";
  let body: ReactNode = null;
  const canEdit = !pc.full && g !== "taxes" && !(g === "income" && r.id.startsWith("manual-"));
  if (g === "obligations" || g === "fixed") {
    body = <>
      <CoverBlock g={g} r={r} />
      <div className="h4">Recent payments</div><EvList txns={r.txns} pc={pc} />
      {r.sub && <p className="note mt-3">{r.sub}</p>}
    </>;
  } else if (g === "budgets") {
    const p = pctOf(r.spent ?? 0, r.monthly);
    const card = pc.m.cards.find(c => c.id === r.coverId);
    body = <>
      <div className="h4">This month</div>
      <div className={`bar ${p < 90 ? "pos" : ""}`} role="img" aria-label={`${p}% of budget used`}><span style={{ width: `${Math.min(100, p)}%` }} /></div>
      <p className="mini mt-2">{fmt(r.spent ?? 0)} of {fmt(r.monthly)} · {r.monthly - (r.spent ?? 0) >= 0 ? `${fmt(r.monthly - (r.spent ?? 0))} left` : `${fmt((r.spent ?? 0) - r.monthly)} over`}</p>
      {card && !card.payoffId && <p className="note mt-3 flex gap-2" style={{ color: "hsl(var(--warning))" }}><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />Charged to {card.name}, which has no payoff account yet.</p>}
      <CoverBlock g={g} r={r} />
    </>;
  } else if (g === "savings") {
    const have = r.have ?? 0;
    const p = r.target ? pctOf(have, r.target) : 0;
    const months = r.target && r.monthly > 0 ? Math.max(0, Math.ceil((r.target - have) / r.monthly)) : null;
    body = <>
      <div className="h4">Goal</div>
      {r.target ? <>
        <div className="bar pos" role="img" aria-label={`${p}% of goal`}><span style={{ width: `${Math.min(100, p)}%` }} /></div>
        <p className="mini mt-2">{fmt(have)} of {fmt(r.target)} ({p}%){r.by ? ` · by ${new Date(r.by + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : months != null ? ` · about ${months} months to go` : ""}</p>
      </> : <p className="mini">No goal amount yet. Set one to track progress.</p>}
      <SavingsGoalForm r={r} />
      <div className="h4">Transfer</div>
      <div className="flex items-center gap-2 flex-wrap">
        <CovChip acct={pc.acct(r.fromId)} text="From: not set" /><ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><CovChip acct={pc.acct(r.toId)} text="To: not linked" />
        <span className="mini">{fmt(r.monthly)}{r.txns[0] ? ` on the ${ORDINAL(Number(r.txns[0].date.slice(8, 10)))}` : " a month"}</span>
      </div>
      {r.txns.length > 0 && <><div className="h4">Recent transfers</div><EvList txns={r.txns} pc={pc} /></>}
    </>;
  } else if (g === "deductions") {
    const det = r.tags?.includes("det");
    body = <>
      <p className="note mt-4 !text-foreground">{r.why}</p>
      {det && (
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn-gold flex-1" onClick={() => { pc.act.confirmDeduction(r.id, "yes"); toast.success("Thanks, marked as right."); close(); }}><Check className="h-4 w-4" aria-hidden="true" />Looks right</button>
          <button type="button" className="btn flex-1" onClick={() => { pc.act.confirmDeduction(r.id, "no"); toast("Removed. Enter the right amount any time."); close(); }}>Not right</button>
        </div>
      )}
      {r.txns.length > 0 && <><div className="h4">What we saw</div><EvList txns={r.txns} pc={pc} /></>}
    </>;
  } else if (g === "income") {
    body = <>
      {salary && <div className="fp-salary-gross">
        <span>Gross pay {pc.m.gross.estimated ? "estimate" : "set"}: <b>{fmt(pc.m.gross.annual)}/yr</b><small> Used for tax estimates.</small></span>
        {!grossEdit ? <button type="button" className="fp-salary-edit" onClick={() => setGrossEdit(true)}>Edit</button> : (
          <form className="fp-salary-gross-form" onSubmit={e => { e.preventDefault(); const n = parseAmt(gross); if (n > 0) { pc.act.setGross(n); setGrossEdit(false); saved(); } }}>
            <span className="amt-in !h-10 flex-1"><span>$</span><input inputMode="decimal" value={gross} onChange={e => setGross(e.target.value)} aria-label="Gross pay per year" /></span>
            <button type="submit" className="btn !min-h-10">Save</button>
            {!pc.m.gross.estimated && <button type="button" className="btn !min-h-10" onClick={() => { pc.act.setGross(null); setGrossEdit(false); saved(); }}>Use estimate</button>}
          </form>
        )}
      </div>}
      <section className={salary ? "fp-salary-deposits" : ""} aria-label={salary ? "Recent salary deposits" : "Deposits"}>
        <div className="h4">{salary ? "Recent deposits" : "Deposits"}<span>{r.txns.length}</span></div>
        <div className={salary ? "fp-deposit-scroll" : ""}><EvList txns={r.txns} pc={pc} /></div>
      </section>
    </>;
  } else if (g === "taxes") {
    body = <p className="note mt-4">{r.id === "fedtax" || r.id === "fica"
      ? `Estimated from your gross pay with ${pc.year} federal rates (${pc.m.filing === "single" ? "single" : "married filing jointly"}). State tax not included. Estimate, not tax advice.`
      : `${r.label} paid ${r.sub ?? "from your accounts"}.`}</p>;
  }
  return (
    <>
      {head}
      {salary && canEdit && <AmountEditor g={g} r={r} className="fp-salary-amount" />}
      {body}
      {canEdit && !salary && <AmountEditor g={g} r={r} />}
      {r.manualId && (g === "obligations" || g === "fixed") && (
        <button type="button" className="btn w-full mt-3" onClick={() => { pc.act.removeManualItem(r.manualId!); toast("Removed."); close(); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove {r.label}</button>
      )}
      {g === "budgets" && r.category && (
        <button type="button" className="btn w-full mt-3" onClick={() => { pc.act.removeBudget(r.category!); toast("Budget removed."); close(); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Stop budgeting {r.label}</button>
      )}
      {g === "savings" && r.goalId && (
        <button type="button" className="btn w-full mt-3" onClick={() => { pc.act.removeGoal(r.goalId!); toast("Goal removed."); close(); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove goal</button>
      )}
    </>
  );
}

// ── Pick ("covered by") ────────────────────────────────────────────────────

function PickDetail({ g, id, viaEdit }: { g: PictureGroup; id: string; viaEdit: boolean }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const row = pc.findRow(g, id) as PictureRow | CardInfo | undefined;
  const current = row ? ("coverId" in row ? (g === "savings" ? (row as PictureRow).fromId ?? null : row.coverId) : (row as CardInfo).payoffId) : null;
  const d = viaEdit ? pc.draftCov(g, id) : undefined;
  const [pick, setPick] = useState<string | null>(d === undefined ? current : d);
  const apply = (v: string | null) => {
    if (viaEdit) pc.setDraftCov(g, id, v);
    else { pc.act.setCover(g, id, v); saved(); }
    close();
  };
  return (
    <>
      <AcctPicker label="Covered by" pool={pc.pool(g)} value={pick} onChange={setPick} />
      <button type="button" className="btn mt-3 w-full" onClick={() => apply(null)}><TriangleAlert className="h-4 w-4" aria-hidden="true" />Leave unassigned</button>
      <button type="button" className="btn-gold w-full mt-3" onClick={() => apply(pick)}>Done</button>
    </>
  );
}

// ── Add (bill / loan / budget / goal) ──────────────────────────────────────

function AddDetail({ g }: { g: "obligations" | "fixed" | "budgets" | "savings" }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const [label, setLabel] = useState("");
  const [amt, setAmt] = useState("");
  const [day, setDay] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const n = parseAmt(amt);
  const cats = useMemo(() => {
    if (g !== "budgets") return [];
    const set = new Set<string>();
    for (const t of pc.props.txns) { const c = pc.props.getEffectiveCategory(t); if (c && !(c in (pc.props.budgets ?? {})) && resolveBucket({ type: "spend" }, c) === "expense") set.add(c); }
    return [...set].sort();
  }, [g, pc.props]);
  const ok = n > 0 && (g === "budgets" ? !!label : label.trim().length > 0);
  const submit = () => {
    if (!ok) return;
    if (g === "budgets") pc.act.addBudget(label, n);
    else if (g === "savings") pc.act.addGoal({ name: label.trim(), monthlyTarget: n, accountId: to ?? undefined, fromAccountId: cover ?? undefined, kind: "transfer", targetAmount: parseAmt(target) > 0 ? parseAmt(target) : undefined });
    else { const dd = Math.round(Number(day)); pc.act.addManualItem({ group: g, label: label.trim(), monthly: n, dueDay: dd >= 1 && dd <= 31 ? dd : undefined }, cover); }
    toast.success("Added. Your picture is updated.");
    close();
  };
  const field = "mt-1 w-full h-11 rounded-[10px] border border-border bg-transparent px-3 text-[14px]";
  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3">
      {g === "budgets" ? (
        <label className="block text-[13px]"><span className="text-muted-foreground">Category</span>
          <select className={field} value={label} onChange={e => setLabel(e.target.value)} aria-label="Category">
            <option value="">Choose a category</option>
            {cats.map(c => <option key={c} value={c}>{pc.props.formatCat ? pc.props.formatCat(c) : c}</option>)}
          </select></label>
      ) : (
        <label className="block text-[13px]"><span className="text-muted-foreground">{g === "savings" ? "Goal name" : "Name"}</span>
          <input className={field} value={label} onChange={e => setLabel(e.target.value)} placeholder={g === "savings" ? "e.g. Vacation" : g === "obligations" ? "e.g. Car loan" : "e.g. Gym"} aria-label={g === "savings" ? "Goal name" : "Name"} /></label>
      )}
      <label className="block text-[13px]"><span className="text-muted-foreground">Amount per month</span>
        <span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} aria-label="Amount per month" /></span></label>
      {(g === "obligations" || g === "fixed") && (
        <label className="block text-[13px]"><span className="text-muted-foreground">Due day of the month (optional)</span>
          <input className={field} inputMode="numeric" value={day} onChange={e => setDay(e.target.value)} aria-label="Due day of the month" /></label>
      )}
      {g === "savings" && (
        <label className="block text-[13px]"><span className="text-muted-foreground">Goal amount (optional)</span>
          <span className="amt-in mt-1 !w-full !h-11"><span>$</span><input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} aria-label="Goal amount" /></span></label>
      )}
      {g !== "budgets" && (
        <>
          <div className="h4">{g === "savings" ? "From" : "Covered by"}</div>
          <AcctPicker label={g === "savings" ? "From account" : "Covered by"} pool={pc.pool(g === "savings" ? "savings" : g)} value={cover} onChange={setCover} />
        </>
      )}
      {g === "savings" && (
        <>
          <div className="h4">Goes to</div>
          <AcctPicker label="Goes to" pool={pc.m.accounts.filter(a => a.kind === "save" || a.kind === "invest")} value={to} onChange={setTo} />
        </>
      )}
      <button type="submit" className="btn-gold w-full" disabled={!ok}>Add</button>
    </form>
  );
}

// ── Insight details ────────────────────────────────────────────────────────

function CovDetail() {
  const pc = usePicture();
  const { open } = useOverlay();
  const { cov, map } = pc;
  return (
    <>
      <div className="flex items-center gap-5 flex-wrap">
        <Donut pct={cov.pct} />
        <div className="flex-1 min-w-[200px]">
          <p className="text-[15px]">{cov.covered} of {cov.items} bills, budgets, cards and goals have an account behind them.</p>
          <p className="note mt-1">{cov.flags.length ? `Fix the ${cov.flags.length} red flag${cov.flags.length === 1 ? "" : "s"} to reach 100%.` : "Nothing to fix."}</p>
        </div>
      </div>
      {cov.flags.length > 0 && (
        <>
          <div className="h4 !mt-5">Fix these</div>
          <div className="lst">
            {cov.flags.map(f => (
              <button type="button" key={f.key} className="li w-full" onClick={() => open(f.key)}>
                <CircleAlert className="h-4 w-4 shrink-0" style={NEG} aria-hidden="true" />
                <span className="grow font-medium text-left">{f.text}</span>
                <span className="text-primary text-[13px] font-semibold shrink-0">Fix</span>
              </button>
            ))}
          </div>
        </>
      )}
      {cov.warnings.length > 0 && <p className="note mt-2">{cov.warnings.map(w => w.text).join(". ")}.</p>}
      <div className="h4 !mt-5 flex items-center gap-2"><Network className="h-3.5 w-3.5" aria-hidden="true" />Coverage map · which account funds what</div>
      <div className="grid md:grid-cols-2 gap-3">
        {map.boxes.map(b => (
          <div key={b.account.id} className="map-acct">
            <div className="flex items-center gap-2"><CovChip acct={pc.acct(b.account.id)} /><span className="text-[12.5px] text-muted-foreground ml-auto">{b.items.length} item{b.items.length > 1 ? "s" : ""}</span></div>
            <div className="map-items">{b.items.map((it, i) => <span key={i} className={`map-item${it.tone === "warn" ? " warn" : ""}`}>{it.label}</span>)}</div>
          </div>
        ))}
        {map.notCovered.length > 0 && (
          <div className="map-acct bad">
            <div className="flex items-center gap-2"><CovChip acct={null} text="Not covered" /></div>
            <div className="map-items">{map.notCovered.map((it, i) => <span key={i} className="map-item bad">{it.label}</span>)}</div>
          </div>
        )}
      </div>
    </>
  );
}

function WhatIf() {
  const pc = usePicture();
  const lim = whatIfLimits(pc.year);
  const baseK = pc.m.payroll.k401, baseH = pc.m.payroll.hsa;
  const [k, setK] = useState(Math.round(baseK));
  const [h, setH] = useState(Math.round(baseH));
  const r = whatIf({ gross: pc.m.gross.annual, filing: pc.m.filing, baseK401: baseK, baseHsa: baseH, k401: k, hsa: h, year: pc.year });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <KV cols={1} items={[{ k: "Tax saved / year", v: <span className="text-positive">{fmt(r.savedYear)}</span>, sub: `${fmtSigned(r.deltaYear)} vs now` }]} />
        <KV cols={1} items={[{ k: "Take-home change", v: fmtSigned(r.takeHomeDeltaMonthly), sub: "per month" }]} />
      </div>
      <label className="block mt-3"><span className="flex justify-between text-[14px]"><span>401(k) per month</span><b className="tabular">{fmt(k)}</b></span>
        <input type="range" min={0} max={Math.round(lim.k401Max)} step={lim.k401Step} value={k} onChange={e => setK(Number(e.target.value))} aria-label="401(k) per month" /></label>
      <label className="block"><span className="flex justify-between text-[14px]"><span>HSA per month</span><b className="tabular">{fmt(h)}</b></span>
        <input type="range" min={0} max={Math.round(lim.hsaMax)} step={lim.hsaStep} value={h} onChange={e => setH(Number(e.target.value))} aria-label="HSA per month" /></label>
      <div className="flex gap-2 mt-1">
        <button type="button" className="btn flex-1" onClick={() => { setK(Math.round(lim.k401Max)); setH(Math.round(lim.hsaMax)); }}>Max both</button>
        <button type="button" className="btn flex-1" onClick={() => { setK(Math.round(baseK)); setH(Math.round(baseH)); }}>Reset</button>
      </div>
    </>
  );
}

function TaxDetail() {
  const pc = usePicture();
  const { savers, tax, m } = pc;
  const hY = m.payroll.hsa * 12, kY = m.payroll.k401 * 12;
  return (
    <>
      <div className="big-line">You save {fmt(savers.now)} a year in taxes. Max out to save <b>+{fmt(savers.more)}</b> more.</div>
      <p className="note mt-1">Federal income tax + Social Security/Medicare, {Math.round(tax.rate * 100)}% bracket. State tax not included. Estimate, not tax advice.</p>
      <div className="h4">Your tax-saving accounts</div>
      <div className="space-y-4">
        <LimitBar label="HSA" yearly={hY} limit={savers.hsaLimit} sub={`Saves ${fmt(savers.hsaSaves)}/yr · ${fmt(savers.hsaRoom)} room left`} />
        <LimitBar label="401(k)" yearly={kY} limit={savers.k401Limit} sub={`Saves ${fmt(savers.k401Saves)}/yr · ${fmt(savers.k401Room)} room left`} />
      </div>
      <div className="h4">Employer match</div>
      <MatchBlock compact={false} />
      <div className="h4 flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />What if I put in more?</div>
      <WhatIf />
      <div className="h4">Not counted yet</div>
      <p className="note">ESPP and RSUs don't lower your taxes now. Dependent-care FSA and a 529 state deduction could; tell us if you have them.</p>
    </>
  );
}

function BreakdownDetail() {
  const { bd } = usePicture();
  return (
    <>
      <div className="kpi text-[34px]">{fmt(bd.total)}</div>
      <p className="mini mt-1">Everything you've saved, by how soon you can use it</p>
      <SavingsStack now={bd.tiers.now} long={bd.tiers.long} ret={bd.tiers.ret} className="mt-3" />
      {TIERS.map(t => (
        <div key={t.k}>
          <div className="h4 flex items-center gap-2"><span className={`dot c-${t.k}`} aria-hidden="true" />{t.k === "ret" ? "Retirement · locked" : t.l}
            <span className="ml-auto normal-case tracking-normal text-foreground text-[14px] tabular">{fmt(bd.tiers[t.k])} · {pctOf(bd.tiers[t.k], bd.total)}%</span></div>
          <p className="note -mt-1 mb-1">{t.s}</p>
          <div className="lst">
            {bd.accounts[t.k].map(({ account: a, balance }) => (
              <div key={a.account_id} className="li !min-h-[44px]"><span className="grow truncate">{a.name} {a.mask && <span className="text-muted-foreground text-[12.5px]">••{a.mask}</span>}</span><b className="amt">{fmt(balance)}</b></div>
            ))}
            {!bd.accounts[t.k].length && <p className="mini">Nothing here yet.</p>}
          </div>
        </div>
      ))}
    </>
  );
}

function BracketDetail() {
  const pc = usePicture();
  const { tax, m, year } = pc;
  const bs = taxTable(year).brackets[m.filing];
  const pre = (m.payroll.hsa + m.payroll.k401) * 12;
  return (
    <>
      <div className="flex items-end gap-3"><span className="kpi text-[48px] text-primary">{Math.round(tax.rate * 100)}%</span><span className="mini pb-1.5">your federal bracket</span></div>
      <p className="text-[14px] mt-2">Based on about {fmt(m.gross.annual)} gross pay, minus {fmt(pre)} pre-tax and the {fmt(tax.standardDeduction)} standard deduction = <b>{fmt(tax.taxable)}</b> taxable.</p>
      <div className="flex items-center gap-3 mt-3">
        <span className="text-[13px] text-muted-foreground">Filing as</span>
        <div className="seg !inline-flex" role="group" aria-label="Filing status">
          <button type="button" aria-pressed={m.filing === "single"} onClick={() => pc.act.setFiling("single")}>Single</button>
          <button type="button" aria-pressed={m.filing !== "single"} onClick={() => pc.act.setFiling("married_joint")}>Married</button>
        </div>
      </div>
      <table className="brk mt-4">
        <caption className="sr-only">{year} federal income tax brackets</caption>
        <thead><tr><th scope="col" className="text-left text-[12px] text-muted-foreground font-semibold px-2.5">Rate</th><th scope="col" className="text-right text-[12px] text-muted-foreground font-semibold px-2.5">Taxable income</th></tr></thead>
        <tbody>
          {bs.map((b, i) => (
            <tr key={i} className={i === tax.idx ? "me" : ""}>
              <td>{Math.round(b.rate * 100)}%{i === tax.idx ? " · you" : ""}</td>
              <td className="text-right">{fmt(i ? bs[i - 1].upTo + 1 : 0)} – {Number.isFinite(b.upTo) ? fmt(b.upTo) : "and up"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tax.toNext != null && tax.nextRate != null && (
        <p className="note mt-3 flex gap-2"><Lightbulb className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />You're {fmt(tax.toNext)} below the next bracket. A raise or bonus above that is taxed at {Math.round(tax.nextRate * 100)}%; more 401(k) keeps you in {Math.round(tax.rate * 100)}%.</p>
      )}
      <p className="note mt-2">{year} federal brackets and standard deduction from IRS Rev. Proc. 2025-32. State tax not included. Estimate, not tax advice.</p>
    </>
  );
}

function RiskDetail() {
  const pc = usePicture();
  const r = riskLabel(pc.risk);
  return (
    <>
      <div className="flex flex-col items-center">
        <Gauge v={riskGaugeValue(pc.risk)} w={220} label={r?.label ?? "not set"} />
        <div className="text-[18px] font-semibold -mt-1">{r?.label ?? "Not set yet"}</div>
        <p className="mini text-center mt-1 max-w-[340px]">{r?.desc ?? "Pick the one that sounds most like you."}</p>
      </div>
      <div className="h4">Pick what fits you</div>
      <RadioList<RiskLevel> label="Risk profile" value={pc.risk ?? null} onChange={v => { pc.act.setRisk(v); saved(); }}
        options={RISK_LEVELS.map(x => ({ value: x.key, label: <b>{x.label}</b>, sub: x.desc }))} />
      <p className="note mt-3">You choose this; we can't tell it from transactions. For reference: {pc.riskInfo.text}</p>
    </>
  );
}

function SharesDetail() {
  const pc = usePicture();
  const s = pc.shares;
  const [f, setF] = useState({
    esppValue: s.esppValue ? String(s.esppValue) : "", esppMonthly: s.esppMonthly ? String(s.esppMonthly) : "", esppNextBuy: s.esppNextBuy ?? "",
    rsuValue: s.rsuValue ? String(s.rsuValue) : "", rsuNextVest: s.rsuNextVest ?? "", rsuNextVestShares: s.rsuNextVestShares ? String(s.rsuNextVestShares) : "",
  });
  const sharePct = pctOf(s.total, pc.bd.total);
  const rsuMonthly = pc.m.payroll.rsu;
  const num = (v: string) => { const n = parseAmt(v); return n > 0 ? n : undefined; };
  const save = () => {
    pc.act.setShares({ ...s, esppValue: num(f.esppValue), esppMonthly: num(f.esppMonthly), esppNextBuy: f.esppNextBuy || undefined, rsuValue: num(f.rsuValue), rsuNextVest: f.rsuNextVest || undefined, rsuNextVestShares: num(f.rsuNextVestShares) });
    saved();
  };
  const inp = (k: keyof typeof f, label: string, money = true) => (
    <label className="block text-[13px]"><span className="text-muted-foreground">{label}</span>
      {k === "esppNextBuy" || k === "rsuNextVest"
        ? <input type="date" className="amt-in mt-1 !w-full !h-11 px-2" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} aria-label={label} />
        : <span className="amt-in mt-1 !w-full !h-11">{money && <span>$</span>}<input inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} aria-label={label} /></span>}
    </label>
  );
  return (
    <>
      <KV items={[{ k: "Value now", v: fmt(s.total) }, { k: "ESPP / month", v: fmt(s.esppMonthly ?? pc.m.payroll.espp) }, { k: "RSU withheld", v: <>{fmt(rsuMonthly)}/mo</> }]} />
      <div className="h4">ESPP</div>
      <p className="text-[14px]">{s.esppValue ? <>You hold {fmt(s.esppValue)} of company stock from the ESPP.{s.esppNextBuy && <> Next purchase <b>{shortDate(s.esppNextBuy)}</b>.</>}</> : "No ESPP shares entered."}</p>
      <div className="h4">RSU</div>
      <p className="text-[14px]">{s.rsuValue ? <>You hold {fmt(s.rsuValue)} of vested RSUs.{s.rsuNextVest && <> Next {s.rsuNextVestShares ? `${s.rsuNextVestShares} shares` : "shares"} vest <b>{shortDate(s.rsuNextVest)}</b>.</>}</> : "No RSUs entered."}</p>
      {s.total > 0 && (
        <>
          <div className="h4">Heads-up</div>
          <p className="note flex gap-2"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />Company stock is {sharePct}% of your savings. Many planners suggest keeping one company under 10–15%.</p>
          <p className="note mt-2">Counted in Savings Breakdown → Long term.</p>
        </>
      )}
      <div className="h4">Update your shares</div>
      <p className="note mb-2">ESPP and RSUs don't show up in bank data, so enter them from your brokerage or pay stub.</p>
      <form className="grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); save(); }}>
        {inp("esppValue", "ESPP value")}{inp("esppMonthly", "ESPP per month")}
        {inp("esppNextBuy", "Next ESPP buy")}{inp("rsuValue", "Vested RSU value")}
        {inp("rsuNextVest", "Next RSU vest")}{inp("rsuNextVestShares", "Shares vesting", false)}
        <button type="submit" className="btn-gold col-span-2">Save shares</button>
      </form>
    </>
  );
}

function CashflowDetail() {
  const pc = usePicture();
  const { steps, P, full } = pc;
  const max = Math.max(1, ...steps.map(s => Math.max(s.from, s.to)));
  const left = steps[steps.length - 1];
  const gross = steps[0]?.amount ?? 0;
  return (
    <>
      <p className="mini">{full ? "Per year" : "Per month"}, from gross pay to what's left.</p>
      <div className="mt-3">
        {steps.slice(0, -1).map(s => {
          const a = Math.min(s.from, s.to), b = Math.max(s.from, s.to);
          const col = s.kind === "start" || s.kind === "subtotal" ? "hsl(var(--info))" : s.kind === "in" ? "hsl(var(--positive))" : s.key === "savings" ? FLOW_COLORS.savings : "hsl(var(--negative) / .75)";
          const sign = s.kind === "in" ? "+" : s.kind === "out" ? "−" : "";
          return (
            <div key={s.key} className={`wf-row${s.kind === "subtotal" ? " border-t border-border pt-1 font-semibold" : ""}`}>
              <span>{s.label}</span>
              <span className="wf-track"><span style={{ left: `${(Math.max(0, a) / max) * 100}%`, width: `${Math.max(0.6, ((b - Math.max(0, a)) / max) * 100)}%`, background: col }} /></span>
              <span className="text-right tabular font-semibold">{sign}{fmt(Math.abs(s.amount) * P)}</span>
            </div>
          );
        })}
        <div className="wf-row border-t border-border mt-1 pt-1">
          <b>{left.label}</b>
          <span className="wf-track"><span style={{ left: 0, width: `${(Math.max(0, left.amount) / max) * 100}%`, background: "hsl(var(--positive))" }} /></span>
          <b className={`text-right tabular ${left.amount >= 0 ? "text-positive" : ""}`} style={left.amount < 0 ? NEG : undefined}>{fmt(left.amount * P)}</b>
        </div>
      </div>
      <p className="note mt-3 flex gap-2">
        {left.amount >= 0 ? <CircleCheck className="h-4 w-4 text-positive shrink-0" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4 shrink-0" style={NEG} aria-hidden="true" />}
        {left.amount >= 0 ? `${fmt(left.amount * P)} is left for unbudgeted spending, about ${pctOf(left.amount, gross)}% of gross pay.` : `You're ${fmt(-left.amount * P)} short; your plan spends more than comes in.`}
      </p>
      <p className="note mt-1">RSU tax is withheld in shares at vest, so it isn't in this cash flow. "Other payroll" is whatever the gross estimate can't explain: state tax, benefits and rounding.</p>
    </>
  );
}

// ── Mobile edit screen ─────────────────────────────────────────────────────

function EditBody() {
  const pc = usePicture();
  const { open } = useOverlay();
  const groups: ListGroup[] = ["income", "deductions", "obligations", "fixed", "budgets", "savings"];
  return (
    <>
      <p className="note">Change any amount or what covers it. Your changes override what we detected.</p>
      {groups.map(g => {
        const rows = pc.rowsFor(g).filter(r => !(g === "income" && r.id.startsWith("manual-")));
        if (!rows.length) return null;
        return (
          <div key={g}>
            <div className="h4">{SEC[g].t}</div>
            <div className="lst">
              {rows.map(r => {
                const d = pc.draftCov(g, r.id);
                const cur = g === "savings" ? r.fromId ?? null : r.coverId;
                const covId = d === undefined ? cur : d;
                return (
                  <div key={r.id} className="li flex-wrap !gap-2">
                    <span className="grow font-medium">{r.label}</span>
                    <AmountInput g={g} row={r} className="!h-11" />
                    {(COVER_GROUPS.has(g) || g === "savings") && (
                      <button type="button" className="w-full flex items-center justify-between !min-h-[44px] text-[13px]" onClick={() => open(`pick:${g}:${r.id}:edit`)} aria-label={`${r.label} ${g === "savings" ? "from" : "covered by"}`}>
                        <span className="text-muted-foreground">{g === "savings" ? "From" : "Covered by"}</span><CovChip acct={pc.acct(covId)} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function EditFooter() {
  const pc = usePicture();
  const { close } = useOverlay();
  return (
    <div className="save-bar">
      <button type="button" className="btn" onClick={() => { pc.resetDraft(); close(); }}>Cancel</button>
      <button type="button" className="btn-gold" onClick={() => { pc.saveEdit(); saved(); close(); }}>Save changes</button>
    </div>
  );
}

// ── Router ─────────────────────────────────────────────────────────────────

export function renderDetail(key: string, pc: PictureState): DetailView | null {
  const [a, b, ...rest] = key.split(":");
  const viaEdit = rest[rest.length - 1] === "edit" && a === "pick";
  const c = (viaEdit ? rest.slice(0, -1) : rest).join(":");
  if (a === "sec") return { title: SEC[b as PictureGroup]?.t ?? "Details", body: <SecDetail g={b as PictureGroup} /> };
  if (a === "row") {
    if (b === "cards") { const card = pc.m.cards.find(x => x.id === c); return card ? { title: card.name, body: <CardRowDetail key={c} c={card} /> } : null; }
    const r = pc.rowsFor(b as ListGroup)?.find(x => x.id === c);
    return r ? { title: r.label, compact: b === "income" && r.id === "salary", body: <RowDetail key={key} g={b as ListGroup} r={r} /> } : null;
  }
  if (a === "pick") {
    const r = pc.findRow(b, c);
    const label = r ? ("label" in r && b !== "cards" ? (r as PictureRow).label : (r as CardInfo).name) : "Item";
    return { title: `${label}: ${b === "cards" ? "paid by" : b === "savings" ? "from" : "covered by"}`, body: <PickDetail key={key} g={b as PictureGroup} id={c} viaEdit={viaEdit} /> };
  }
  if (a === "add") {
    const t = { obligations: "Add a loan or obligation", fixed: "Add a bill", budgets: "Add a budget", savings: "Add a savings goal" }[b as "fixed"];
    return t ? { title: t, body: <AddDetail g={b as "fixed"} /> } : null;
  }
  switch (key) {
    case "coverage": return { title: "Coverage Health", wide: true, body: <CovDetail /> };
    case "taxsavers": return { title: "Tax Savers", body: <TaxDetail /> };
    case "breakdown": return { title: "Savings Breakdown", body: <BreakdownDetail /> };
    case "bracket": return { title: "Tax Bracket", body: <BracketDetail /> };
    case "risk": return { title: "Risk Profile", body: <RiskDetail /> };
    case "shares": return { title: "Shares (ESPP + RSU)", body: <SharesDetail /> };
    case "cashflow": return { title: "Where your money goes", wide: true, body: <CashflowDetail /> };
    case "edit": return { title: "Edit your data", body: <EditBody />, footer: <EditFooter /> };
    default: return null;
  }
}
