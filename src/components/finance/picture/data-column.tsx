/** "Your Data": desktop column (rows + inline edit) and the mobile summary cards. */
import { useState } from "react";
import { Briefcase, Check, ChevronRight, CircleAlert, CircleCheck, Info, Pencil, Plus, TriangleAlert } from "lucide-react";
import { usePicture, type ListGroup } from "./state";
import { useOverlay } from "./overlays";
import { CovChip, Tag, fmt, pctOf } from "./bits";
import { SEC, groupsFor, COVER_GROUPS } from "./meta";
import type { PictureGroup, PictureRow, CardInfo } from "@/lib/picture/model";

export const parseAmt = (s: string) => { const n = Number(s.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

/** Editable amount ($ input) bound to the edit draft. */
export function AmountInput({ g, row, className = "" }: { g: string; row: PictureRow; className?: string }) {
  const { draftAmt, setDraftAmt } = usePicture();
  const d = draftAmt(g, row.id);
  const [text, setText] = useState(() => Math.round(d ?? row.monthly).toLocaleString("en-US"));
  return (
    <label className={`amt-in ${className}`}>
      <span>$</span>
      <input
        inputMode="decimal" value={text} aria-label={`${row.label} amount per month`}
        onChange={e => { setText(e.target.value); const n = parseAmt(e.target.value); setDraftAmt(g, row.id, Number.isFinite(n) ? n : 0); }}
      />
    </label>
  );
}

/** Inline "Covered by" select used in desktop edit mode. */
export function CoverSelect({ g, id, label, current }: { g: PictureGroup; id: string; label: string; current: string | null }) {
  const { draftCov, setDraftCov, pool } = usePicture();
  const d = draftCov(g, id);
  const v = d === undefined ? current : d;
  return (
    <select className={`cov-sel ${v ? "" : "none"}`} aria-label={`${label} ${g === "cards" ? "paid by" : "covered by"}`} value={v ?? ""} onChange={e => setDraftCov(g, id, e.target.value || null)}>
      <option value="">⚠ Unassigned</option>
      {pool(g).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
    </select>
  );
}

const editableAmount = (g: PictureGroup, r: PictureRow) => g !== "taxes" && !(g === "income" && r.id.startsWith("manual-"));

function DataRow({ g, r }: { g: ListGroup; r: PictureRow }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const editing = pc.editing && !pc.full;
  const amt = editing && editableAmount(g, r)
    ? <AmountInput g={g} row={r} />
    : <span className="amt">{fmt(r.monthly * pc.P)}<span>{pc.per}</span></span>;
  let tag;
  if (g === "deductions") tag = <span className="tagbox">{(r.tags ?? []).map(t => <Tag key={t} kind={t} />)}</span>;
  else if (g === "savings") tag = editing ? <CoverSelect g="savings" id={r.id} label={`${r.label} from`} current={r.fromId ?? null} /> : <CovChip acct={pc.acct(r.toId)} />;
  else if (g === "income") tag = <span />;
  else if (g === "taxes") tag = r.id === "fedtax" || r.id === "fica"
    ? <span className="cov"><Briefcase className="h-3.5 w-3.5" aria-hidden="true" /><span>Withheld by payroll</span></span>
    : <CovChip acct={pc.acct(r.coverId)} />;
  else tag = editing ? <CoverSelect g={g} id={r.id} label={r.label} current={r.coverId} /> : <CovChip acct={pc.acct(r.coverId)} />;
  const sub = g === "savings"
    ? (r.target ? <small>{pctOf(r.have ?? 0, r.target)}% of {fmt(r.target)} goal</small> : r.detectedOnly ? <small>Detected transfer</small> : <small>No goal amount yet</small>)
    : r.sub && g !== "deductions" ? <small>{r.sub}</small> : null;
  const inner = <><span className="lbl">{r.label}{sub}</span>{amt}{tag}</>;
  const cls = `row ${g === "deductions" ? "row-tags" : ""}`;
  if (editing) return <div className={cls}>{inner}<span /></div>;
  return (
    <button type="button" className={cls} onClick={() => open(`row:${g}:${r.id}`)} aria-label={`${r.label}, ${fmt(r.monthly * pc.P)} ${pc.perWord}, details`}>
      {inner}<span className="chev" aria-hidden="true"><ChevronRight className="h-4 w-4" /></span>
    </button>
  );
}

function CardsTable() {
  const pc = usePicture();
  const { open } = useOverlay();
  const editing = pc.editing && !pc.full;
  if (!pc.m.cards.length) return <p className="mini">No credit cards linked.</p>;
  return (
    <div className="rows">
      <table className="tbl">
        <thead><tr><th scope="col">Card</th><th scope="col">Paid by</th><th scope="col">Last 4</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {pc.m.cards.map((c: CardInfo) => {
            const payer = pc.acct(c.payoffId);
            const go = () => open(`row:cards:${c.id}`);
            return (
              <tr key={c.id} className={editing ? "" : "click"} tabIndex={editing ? undefined : 0} aria-label={editing ? undefined : `${c.name} details`}
                onClick={editing ? undefined : go} onKeyDown={editing ? undefined : e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}>
                <td className="font-medium">{c.name}</td>
                <td>{editing ? <CoverSelect g="cards" id={c.id} label={c.name} current={c.payoffId} />
                  : payer ? payer.name : <span className="st st-bad"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />None</span>}</td>
                <td className="tabular text-muted-foreground">{c.mask ? `••${c.mask}` : "—"}</td>
                <td>{c.payoffId
                  ? <span className="st st-ok"><CircleCheck className="h-4 w-4" aria-hidden="true" />All set</span>
                  : <span className="st st-bad"><CircleAlert className="h-4 w-4" aria-hidden="true" />No payoff account</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ADDABLE: PictureGroup[] = ["obligations", "fixed", "budgets", "savings"];

function SecCard({ g }: { g: PictureGroup }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const s = SEC[g];
  const rows = g === "cards" ? [] : pc.rowsFor(g);
  return (
    <div className="sec" id={`sec-${g}`}>
      <div className="sec-h">
        <span className="sec-ico" aria-hidden="true"><s.i className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0"><div className="sec-t">{s.t}</div><div className="sec-s">{s.s}</div></div>
        {g !== "cards" && <span className="ml-auto text-[13px] text-muted-foreground tabular whitespace-nowrap">{fmt(pc.sumOf(g) * pc.P)}{pc.per}</span>}
        {/* Same "Add" the phone's section screens have (parity). */}
        {ADDABLE.includes(g) && rows.length > 0 && (
          <button type="button" className="sec-more !ml-1" aria-label={`Add to ${s.t}`} onClick={() => open(`add:${g}`)}><Plus className="h-4 w-4" aria-hidden="true" />Add</button>
        )}
      </div>
      {g === "cards" ? <CardsTable /> : rows.length
        ? <div className="rows">{rows.map(r => <DataRow key={r.id} g={g} r={r} />)}</div>
        : <EmptyRows g={g} />}
    </div>
  );
}

function EmptyRows({ g }: { g: PictureGroup }) {
  const { open } = useOverlay();
  const text: Partial<Record<PictureGroup, string>> = {
    obligations: "No loans found yet.", fixed: "No bills found yet.", budgets: "You haven't budgeted any categories yet.",
    savings: "No savings goals yet.", taxes: "", income: "No income found yet.",
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="mini">{text[g]}</p>
      {(g === "obligations" || g === "fixed" || g === "budgets" || g === "savings") && (
        <button type="button" className="btn !min-h-[40px]" onClick={() => open(`add:${g}`)}>Add {g === "savings" ? "a goal" : g === "budgets" ? "a budget" : "one"}</button>
      )}
    </div>
  );
}

export function DataDesktop() {
  const pc = usePicture();
  const editing = pc.editing && !pc.full;
  return (
    <>
      <div className="col-h">
        <div><h2 id="yd-h">Your Data</h2><p>{pc.full ? `Your whole year, ${pc.year}. Includes taxes.` : "Your money this month. Everything here is editable."}</p></div>
        {pc.full
          ? <span className="text-[12.5px] text-muted-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" aria-hidden="true" />Switch to Monthly to edit</span>
          : editing
            ? <div className="flex gap-2"><button type="button" className="btn" onClick={pc.cancelEdit}>Cancel</button><button type="button" className="btn-gold" onClick={pc.saveEdit}><Check className="h-4 w-4" aria-hidden="true" />Done</button></div>
            : <button type="button" className="btn" onClick={pc.startEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>}
      </div>
      {editing && (
        <div className="edit-banner"><Pencil className="h-4 w-4 text-primary" aria-hidden="true" /><span>Editing: change any amount or where it's <b>covered by</b>. Your changes override what we detected.</span></div>
      )}
      {groupsFor(pc.full).map(g => <SecCard key={g} g={g} />)}
    </>
  );
}

function sumSub(pc: ReturnType<typeof usePicture>, g: PictureGroup) {
  const st = (ok: boolean, text: string) => (
    <span className={`st ${ok ? "st-ok" : "st-bad"} !text-[12.5px]`}>
      {ok ? <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />}{text}
    </span>
  );
  if (g === "cards") {
    const bad = pc.m.cards.filter(c => !c.payoffId).length;
    return bad ? st(false, `${bad} ${bad === 1 ? "has" : "have"} no payoff account`) : pc.m.cards.length ? st(true, "All have a payoff account") : "No cards linked";
  }
  const rows = pc.rowsFor(g);
  if (g === "deductions") return <>{rows.length} items · <Tag kind="pre" /> {rows.some(r => r.tags?.includes("det")) && <Tag kind="det" />}</>;
  if (g === "obligations" || g === "fixed") {
    const un = rows.filter(r => !r.coverId).length;
    const noun = g === "obligations" ? (rows.length === 1 ? "loan" : "loans") : (rows.length === 1 ? "item" : "items");
    return <>{un ? st(false, `${un} unassigned`) : st(true, "All covered")} · {rows.length} {noun}</>;
  }
  if (g === "budgets") return `${rows.length} ${rows.length === 1 ? "category" : "categories"} you budget`;
  if (g === "savings") return `${rows.length} ${rows.length === 1 ? "goal" : "goals"} · own transfers`;
  if (g === "income") return rows.filter(r => r.monthly > 0).map(r => r.label.replace(" income", "")).join(" + ") || SEC.income.s;
  if (g === "taxes") return "Federal, FICA" + (rows.length > 2 ? ", property" : "");
  return null;
}

export function DataMobile() {
  const pc = usePicture();
  const { open } = useOverlay();
  return (
    <>
      <div className="col-h !mb-3">
        <div><h2 id="yd-h" className="!text-[22px]">Your Data</h2><p>{pc.full ? `Whole year ${pc.year}, incl. taxes` : "Tap a section for details"}</p></div>
        {!pc.full && <button type="button" className="btn" onClick={() => { pc.resetDraft(); open("edit"); }}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>}
      </div>
      {groupsFor(pc.full).map(g => {
        const s = SEC[g];
        const v = g === "cards"
          ? <>{pc.m.cards.length}<small>cards</small></>
          : <>{fmt(pc.sumOf(g) * pc.P)}<small>{pc.perWord}</small></>;
        return (
          <button type="button" key={g} className="sum-card" onClick={() => open(`sec:${g}`)}>
            <span className="sec-ico" aria-hidden="true"><s.i className="h-[18px] w-[18px]" /></span>
            <span className="flex-1 min-w-0"><span className="t block">{s.t}</span><span className="s">{sumSub(pc, g)}</span></span>
            <span className="v">{v}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        );
      })}
    </>
  );
}

export { COVER_GROUPS };
