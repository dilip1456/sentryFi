import { ChartNoAxesColumnDecreasing, CircleCheck, FlaskConical, Pencil, Plus, TriangleAlert } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MatchBlock, BracketCard, RiskCard, SharesCard, FlowMini } from "./picture/insights";
import { CoverSelect, DataMobile, DataRow } from "./picture/data-column";
import { PictureProvider, usePicture, type MyFinancialPictureProps } from "./picture/state";
import { OverlayProvider, useOverlay } from "./picture/overlays";
import { renderDetail } from "./picture/details";
import { HistoryToast } from "./picture/history-hint";
import { fmt } from "./picture/bits";
import { SEC } from "./picture/meta";
import type { ListGroup } from "./picture/state";
import "./picture/picture.css";

function PeriodControl() {
  const { full, setFull } = usePicture();
  return <div className="seg" role="group" aria-label="Period">
    <button type="button" aria-pressed={!full} onClick={() => setFull(false)}>Monthly</button>
    <button type="button" aria-pressed={full} onClick={() => setFull(true)}>Full Picture</button>
  </div>;
}

function ExampleTag() {
  return <span className="example-tag"><FlaskConical className="h-3 w-3" aria-hidden="true" />Example data</span>;
}

function SummaryCard() {
  const { flow, P, per, full } = usePicture();
  const committed = flow.parts.reduce((sum, part) => sum + part.amount, 0);
  const assignedPct = flow.income > 0 ? Math.max(0, Math.min(100, Math.round(committed / flow.income * 100))) : 0;
  const period = full ? "/yr" : "/mo";
  return <section className="fp-summary" aria-label="Cash flow summary">
    <div className="fp-summary-metrics">
      <div><span>{full ? "Annual income" : "Monthly income"}</span><strong>{fmt(flow.income * P)}<small>{period}</small></strong></div>
      <div><span>Committed</span><strong>{fmt(committed * P)}<small>{period}</small></strong></div>
      <div><span>Left to plan</span><strong className={flow.left < 0 ? "is-negative" : "is-positive"}>{fmt(flow.left * P)}<small>{period}</small></strong></div>
    </div>
    <div className="fp-summary-progress">
      <div className="bar" role="img" aria-label={`${assignedPct}% of income assigned`}><span style={{ width: `${assignedPct}%` }} /></div>
      <p><b>{assignedPct}%</b> of income already has a job</p>
    </div>
  </section>;
}

function PlanCard({ title, groups, includeCards = false }: { title: string; groups: ListGroup[]; includeCards?: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const amount = groups.reduce((total, group) => total + pc.sumOf(group), 0);
  const showGroupTitles = groups.length > 1 || includeCards;
  const addLabel = (group: ListGroup) => group === "budgets" ? "Add budget" : group === "savings" ? "Add goal" : "Add item";
  return <section className="fp-plan-panel">
    <header className="fp-plan-panel-head">
      <span className="sec-ico" aria-hidden="true">{(() => { const Icon = SEC[groups[0]].i; return <Icon className="h-[18px] w-[18px]" />; })()}</span>
      <div className="min-w-0"><h3>{title}</h3><p>{groups.reduce((sum, group) => sum + pc.rowsFor(group).length, 0)} item{groups.reduce((sum, group) => sum + pc.rowsFor(group).length, 0) === 1 ? "" : "s"}{includeCards && pc.m.cards.length ? ` · ${pc.m.cards.length} card${pc.m.cards.length === 1 ? "" : "s"}` : ""}</p></div>
      <strong>{fmt(amount * pc.P)}<small>{pc.per}</small></strong>
      {groups.length === 1 && !includeCards && ["fixed", "obligations", "budgets", "savings"].includes(groups[0]) && <button type="button" className="fp-plan-add" onClick={() => open(`add:${groups[0]}`)}><Plus className="h-3.5 w-3.5" />Add</button>}
    </header>
    <div className="fp-plan-panel-body">
      {groups.map(group => {
        const rows = pc.rowsFor(group);
        const addable = ["obligations", "fixed", "budgets", "savings"].includes(group);
        return <div className="fp-plan-group" key={group}>
          {showGroupTitles && <div className="fp-plan-group-head"><span>{SEC[group].t}</span>{addable && rows.length > 0 && <button type="button" onClick={() => open(`add:${group}`)} aria-label={addLabel(group)}><Plus className="h-3.5 w-3.5" />{addLabel(group)}</button>}</div>}
          {rows.length ? <div className="rows">{rows.map(row => <DataRow key={row.id} g={group} r={row} />)}</div>
            : <div className="fp-plan-empty">{group === "income" ? "No income found yet." : group === "deductions" ? "No paycheck deductions found." : `No ${SEC[group].t.toLowerCase()} yet.`}{addable && <button type="button" onClick={() => open(`add:${group}`)}>Add one</button>}</div>}
        </div>;
      })}
      {includeCards && <div className="fp-plan-group">
        <div className="fp-plan-group-head"><span>Cards & payoff accounts</span></div>
        {pc.m.cards.length ? <div className="fp-plan-card-list">{pc.m.cards.map(card => {
          const payer = pc.acct(card.payoffId);
          return <div className="fp-plan-card-row" key={card.id}>
            <button type="button" className="fp-plan-card-name" onClick={() => open(`row:cards:${card.id}`)}>{card.name}<small>{card.mask ? `••${card.mask}` : "Credit card"}</small></button>
            {pc.editing && !pc.full
              ? <CoverSelect g="cards" id={card.id} label={card.name} current={card.payoffId} />
              : <button type="button" className={payer ? "fp-plan-payer" : "fp-plan-payer missing"} onClick={() => open(`row:cards:${card.id}`)}>{payer ? `Paid by ${payer.name}` : "Set payoff account"}</button>}
          </div>;
        })}</div> : <p className="fp-plan-empty">No credit cards linked.</p>}
      </div>}
    </div>
  </section>;
}

function AttentionColumn() {
  const { full, year, cov, savers, bd } = usePicture();
  const { open } = useOverlay();
  const good = cov.pct >= 85;
  return <>
    <div className="col-h fp-redesign-heading"><div><h2 id="in-h">What needs attention</h2><p>{full ? `Next steps for your ${year} financial picture.` : "Insights and next steps to keep your plan on track."}</p></div></div>
    <button type="button" className={`fp-attention ${good ? "good" : "needs-work"}`} onClick={() => open("coverage")}>
      <span className="fp-attention-icon" aria-hidden="true">{good ? <CircleCheck /> : <TriangleAlert />}</span>
      <span className="fp-attention-copy"><b>{good ? "Everything is connected" : "A few things need a home"}</b><span>{cov.pct}% of bills and goals have an account behind them.</span><span className="bar"><i style={{ width: `${cov.pct}%` }} /></span></span>
      <strong>{cov.pct}%</strong>
    </button>
    {cov.flags.length > 0 && <div className="fp-review-card">
      <div><b>{cov.flags.length} item{cov.flags.length === 1 ? " needs" : "s need"} a payment account</b><p>Assign an account so these obligations are tracked against the right money.</p></div>
      <button type="button" className="btn" onClick={() => open(cov.flags[0].key)}>Review</button>
      <ul>{cov.flags.slice(0, 3).map(flag => <li key={flag.key}>{flag.text}</li>)}</ul>
    </div>}
    <h3 className="fp-subhead">Opportunities</h3>
    <div className="sec fp-opportunity"><div className="sec-t">Employer 401(k) match</div><p className="mini mt-1 mb-2">Check whether you’re getting the full match.</p><MatchBlock compact /></div>
    <button type="button" className="fp-insight-link" onClick={() => open("taxsavers")}><span><b>Tax savings</b><small>Estimated annual savings from HSA and retirement contributions</small></span><strong>{fmt(savers.now)}<small>/yr</small></strong></button>
    <button type="button" className="fp-insight-link" onClick={() => open("breakdown")}><span><b>Cash available now</b><small>{bd.cashPct}% of your savings is held in cash accounts</small><span className="bar"><i style={{ width: `${bd.cashPct}%` }} /></span></span><strong>{fmt(bd.tiers.now)}</strong></button>
    <div className="ins-grid"><BracketCard /><RiskCard /></div>
    <SharesCard />
  </>;
}

function Page({ mobile }: { mobile: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const editingAction = pc.editing ? "Cancel" : "Edit";
  const periodLabel = pc.full ? `${pc.year}, whole year` : pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (mobile) return <div className="fp-redesign px-4 pt-3 pb-28">
    <PeriodControl />
    <div className="flex items-center gap-2 mt-3">{pc.demo && <ExampleTag />}<span className="text-[12.5px] text-muted-foreground">{periodLabel}</span></div>
    <SummaryCard />
    <HistoryToast />
    <DataMobile />
    <div className="mt-6"><FlowMini /><AttentionColumn /></div>
  </div>;
  return <div className="fp-redesign content-max px-8 pt-4 pb-10">
    <header className="fp-redesign-header">
      <div><div className="flex items-center gap-2"><h1 className="font-display text-[24px] font-semibold">My Financial Picture</h1>{pc.demo && <ExampleTag />}</div><p>A clear view of what comes in, what goes out, and what’s covered.</p></div>
      <div className="fp-redesign-controls"><PeriodControl /><button type="button" className="btn" onClick={pc.editing ? pc.cancelEdit : pc.startEdit}><Pencil className="h-4 w-4" aria-hidden="true" />{editingAction}</button><button type="button" className="btn" onClick={() => open("cashflow")}><ChartNoAxesColumnDecreasing className="h-4 w-4" aria-hidden="true" />Where it goes</button></div>
    </header>
    <SummaryCard />
    <HistoryToast />
    <div className="fp-redesign-grid">
      <section aria-labelledby="yd-h">
        <div className="col-h"><div><h2 id="yd-h">{pc.full ? "Full picture" : "Monthly plan"}</h2><p>{pc.full ? `Your whole year, ${pc.year}.` : "Here’s how your money flows this month."}</p></div>{pc.full ? <span className="text-[12.5px] text-muted-foreground">Switch to Monthly to edit</span> : pc.editing ? <div className="flex gap-2"><button type="button" className="btn" onClick={pc.cancelEdit}>Cancel</button><button type="button" className="btn-gold" onClick={pc.saveEdit}>Done</button></div> : null}</div>
        <div className="fp-plan-flow"><FlowMini /></div>
        {pc.full && <PlanCard title="Income" groups={["income"]} />}
        {pc.full && <PlanCard title="Deductions & taxes" groups={["deductions", "taxes"]} />}
        {!pc.full && <PlanCard title="Income" groups={["income"]} />}
        {!pc.full && <PlanCard title="Paycheck deductions" groups={["deductions"]} />}
        <PlanCard title="Bills & essentials" groups={["fixed", "budgets"]} />
        <PlanCard title="Debt & cards" groups={["obligations"]} includeCards />
        <PlanCard title="Savings goals" groups={["savings"]} />
      </section>
      <section className="fp-attention-column" aria-labelledby="in-h"><AttentionColumn /></section>
    </div>
  </div>;
}

function WithOverlays() {
  const mobile = useIsMobile();
  const pc = usePicture();
  return <OverlayProvider isMobile={mobile} render={key => renderDetail(key, pc)}><Page mobile={mobile} /></OverlayProvider>;
}

export function MyFinancialPictureRedesign(props: MyFinancialPictureProps) {
  return <div className="fp fp-redesign-root" data-testid="financial-picture-redesign"><PictureProvider props={props}><WithOverlays /></PictureProvider></div>;
}

export default MyFinancialPictureRedesign;
