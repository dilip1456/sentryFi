/**
 * Detected recurring items: what the app found repeating in the person's
 * transactions (src/lib/recurring/review.ts). Confident detections are
 * accepted automatically and weak ones left out (decisions.ts
 * settleSuggestions), so there is nothing to review and no counts. Each item
 * can still be edited (cadence, amount, group, covered-by account) or marked
 * "Not recurring" (undo toast; restore from Hidden). Decisions are stored per
 * user and respected by future detection runs.
 *
 * Overlay keys: "rcv" (the list), "rcv:item:<encoded key>" (one item, a
 * bottom sheet on mobile) and "rcv:edit:<encoded key>" (the same sheet opened
 * straight on its edit form: one tap from any recurring row's pencil).
 *
 * The person can name a pattern and set the amount to expect (plus how often,
 * group and covering account). Those live on the pattern's decision only;
 * transactions are never changed. "Reset to detected" clears them.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, CircleAlert, Pencil, RotateCcw, X } from "lucide-react";
import { REVIEW_GROUPS, REVIEW_GROUP_LABEL, type ReviewGroup, type ReviewItem } from "@/lib/recurring";
import type { Cadence } from "@/lib/recurring/schedule";
import { usePicture } from "./state";
import { useOverlay } from "./overlays";
import { fmt } from "./bits";

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly",
  quarterly: "Every 3 months", semiannual: "Every 6 months", yearly: "Yearly",
};
/** One toast slot: a new action replaces the last toast instead of stacking over its Undo. */
const TOAST = "fp-recurring";
const CADENCES = Object.keys(CADENCE_LABEL) as Cadence[];
const itemKey = (key: string) => `rcv:item:${encodeURIComponent(key)}`;
// eslint-disable-next-line react-refresh/only-export-components -- shared with plan.tsx
export const editKey = (key: string) => `rcv:edit:${encodeURIComponent(key)}`;

/** One-tap pencil that opens a recurring pattern's edit sheet. */
export function EditPatternButton({ it, className = "" }: { it: Pick<ReviewItem, "key" | "label">; className?: string }) {
  const { open } = useOverlay();
  return <button type="button" className={`rcv-icon tap-44 ${className}`} data-testid="rcv-edit" onClick={e => { e.stopPropagation(); open(editKey(it.key)); }} aria-label={`Edit ${it.label}`} title="Edit name and amount"><Pencil className="h-4 w-4" /></button>;
}
const shortDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric" }) : "—");
const money = (n: number) => (Math.abs(n) < 100 && n % 1 ? `$${n.toFixed(2)}` : fmt(n));

// eslint-disable-next-line react-refresh/only-export-components -- shared with plan.tsx
export function useRecurringActions() {
  const pc = usePicture();
  return useMemo(() => ({
    confirm: (it: ReviewItem) => {
      const prev = pc.recurring.decide(it, { status: "confirmed" });
      toast.success(`${it.label} confirmed`, { id: TOAST, description: "Added to your plan.", action: { label: "Undo", onClick: () => pc.recurring.revert(it.key, prev) } });
    },
    dismiss: (it: ReviewItem) => {
      const prev = pc.recurring.decide(it, { status: "dismissed" });
      toast(`${it.label} marked not recurring`, { id: TOAST, description: "It won't come back. Restore it from Dismissed.", action: { label: "Undo", onClick: () => pc.recurring.revert(it.key, prev) } });
    },
    restore: (it: ReviewItem) => { pc.recurring.restore(it.key); toast(`${it.label} restored`, { id: TOAST }); },
  }), [pc.recurring]);
}

function Badge({ it }: { it: ReviewItem }) {
  if (it.missed) return <span className="rcv-badge warn"><CircleAlert className="h-3 w-3" aria-hidden="true" />Missed or late</span>;
  return null;
}

export function ItemRow({ it }: { it: ReviewItem }) {
  const { open } = useOverlay();
  const a = useRecurringActions();
  const amount = it.amountKind === "variable" ? `~${money(it.amount)}` : money(it.amount);
  return (
    <div className="rcv-row" data-testid="rcv-item" data-key={it.key}>
      <button type="button" className="rcv-main" onClick={() => open(itemKey(it.key))} aria-label={`${it.label}, ${it.pattern}. Details`}>
        <span className="rcv-lbl"><b>{it.label}</b><Badge it={it} />{it.estimated && <span className="rcv-badge">Estimated</span>}<small>{it.patternLine}</small></span>
        <span className="rcv-amt">{amount}<small>Last {shortDate(it.lastSeen)} · Next {shortDate(it.nextDue)}</small></span>
        <ChevronRight className="h-4 w-4 rcv-chev" aria-hidden="true" />
      </button>
      <div className="rcv-acts">
        <EditPatternButton it={it} />
        <button type="button" className="rcv-icon no tap-44" onClick={() => a.dismiss(it)} aria-label={`${it.label} is not recurring`} title="Not recurring"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function RecurringList() {
  const pc = usePicture();
  const a = useRecurringActions();
  const { items, dismissed } = pc.m.review;
  const [showDismissed, setShowDismissed] = useState(false);
  return (
    <div className="rcv-list" data-testid="rcv-list">
      <p className="note mb-3">Payments and deposits that repeat on a schedule. They are already in your Picture; open one to correct it, or mark it “Not recurring”.</p>
      {REVIEW_GROUPS.map(g => {
        const list = items.filter(i => i.group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={REVIEW_GROUP_LABEL[g]}>
            <div className="h4 !mt-3 !text-[12.5px] text-muted-foreground">{REVIEW_GROUP_LABEL[g]}</div>
            <div className="rows">{list.map(it => <ItemRow key={it.key} it={it} />)}</div>
          </section>
        );
      })}
      {dismissed.length > 0 && <div className="h4 flex items-center justify-between"><span>Hidden</span>
        <button type="button" className="sec-more !ml-0 tap-44" onClick={() => setShowDismissed(v => !v)} aria-expanded={showDismissed}>{showDismissed ? "Hide" : "Show"}</button></div>}
      {showDismissed && <div className="rows mb-24">{dismissed.map(it => (
        <div className="rcv-row dismissed" key={it.key} data-testid="rcv-dismissed">
          <span className="rcv-main static"><span className="rcv-lbl"><b>{it.label}</b><small>{it.pattern || CADENCE_LABEL[it.cadence]} · {money(it.amount)}</small></span></span>
          <div className="rcv-acts"><button type="button" className="btn" onClick={() => a.restore(it)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Restore</button></div>
        </div>
      ))}</div>}
    </div>
  );
}

export function RecurringItem({ it, startEditing = false }: { it: ReviewItem; startEditing?: boolean }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const a = useRecurringActions();
  const [editing, setEditing] = useState(startEditing);
  const [name, setName] = useState(it.label);
  const [cadence, setCadence] = useState<Cadence>(it.cadence);
  const [amount, setAmount] = useState(String(Math.round(it.amount * 100) / 100));
  const [group, setGroup] = useState<ReviewGroup>(it.group);
  const [cover, setCover] = useState(it.coverAccountId ?? "");
  const accounts = pc.m.accounts.filter(x => x.kind === "bank" || x.kind === "save" || x.kind === "card");
  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt >= 0;
  const nm = name.trim();
  const save = () => {
    if (!valid || !nm) return;
    pc.recurring.decide(it, {
      status: "confirmed",
      name: nm !== it.autoLabel ? nm : null,
      // Saving an estimated item confirms its timing.
      cadence: cadence !== it.cadence || it.edited || it.estimated ? cadence : null,
      expectedAmount: Math.abs(amt - it.amount) > 0.004 || it.expectedAmount != null ? amt : null,
      group: group !== it.group || it.edited ? group : null,
      coverAccountId: cover || null,
    });
    toast.success(`${nm} updated`, { id: TOAST });
    if (startEditing) close(); else setEditing(false);
  };
  const customized = it.renamed || it.edited || it.expectedAmount != null;
  const reset = () => {
    const prev = pc.recurring.decide(it, { status: "confirmed", name: null, cadence: null, expectedAmount: null, group: null, coverAccountId: null });
    toast(`${it.autoLabel} reset to detected`, { id: TOAST, action: { label: "Undo", onClick: () => pc.recurring.revert(it.key, prev) } });
    if (startEditing) close(); else setEditing(false);
  };
  const facts = [
    { k: "Typical amount", v: it.amountKind === "variable" ? `${money(it.amountRange[0])}–${money(it.amountRange[1])}` : money(it.amount), s: it.amountKind === "variable" ? `about ${money(it.amount)} · varies` : "fixed" },
    { k: "Monthly equivalent", v: money(it.monthly), s: CADENCE_LABEL[it.cadence] },
    { k: "Next expected", v: shortDate(it.nextDue), s: `Last seen ${shortDate(it.lastSeen)}` },
  ];
  return (
    <div className="rcv-item" data-testid="rcv-item-detail">
      <div className="flex flex-wrap items-center gap-2 mb-2"><span className="rcv-badge">{REVIEW_GROUP_LABEL[it.group]}</span><Badge it={it} />{it.estimated && <span className="rcv-badge">Estimated</span>}<span className="mini" data-testid="rcv-pattern-line">{it.patternLine}</span></div>
      {it.estimateNote && <p className="note mb-2" data-testid="rcv-estimate-note">{it.estimateNote}</p>}
      {!startEditing && <div className="kv">{facts.map(f => <div key={f.k}><div className="k">{f.k}</div><div className="v">{f.v}</div><div className="mini">{f.s}</div></div>)}</div>}
      {it.missed && <p className="rcv-missed mt-3"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{it.daysLate ? `Expected ${it.daysLate} day${it.daysLate === 1 ? "" : "s"} ago and not seen yet.` : "The expected payment hasn't shown up."}</p>}
      {!editing ? (
        <div className="rcv-btns">
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn" onClick={() => { a.dismiss(it); close(); }}><X className="h-4 w-4" aria-hidden="true" />Not recurring</button>
        </div>
      ) : (
        <form className="rcv-form" data-testid="rcv-edit-form" onSubmit={e => { e.preventDefault(); save(); }}>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} maxLength={60} aria-invalid={!nm} autoComplete="off" /></label>
          <label>Expected amount<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!valid} /></label>
          <label>How often<select value={cadence} onChange={e => setCadence(e.target.value as Cadence)}>{CADENCES.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}</select></label>
          <label>Group<select value={group} onChange={e => setGroup(e.target.value as ReviewGroup)}>{REVIEW_GROUPS.map(g => <option key={g} value={g}>{REVIEW_GROUP_LABEL[g]}</option>)}</select></label>
          <label>{it.direction === "inflow" ? "Lands in" : "Covered by"}<select value={cover} onChange={e => setCover(e.target.value)}><option value="">{it.direction === "inflow" ? "As detected" : "Not set"}</option>{accounts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <div className="rcv-btns"><button type="submit" className="btn-gold" disabled={!valid || !nm}>Save</button><button type="button" className="btn" onClick={() => (startEditing ? close() : setEditing(false))}>Cancel</button>
            {customized && <button type="button" className="btn" data-testid="rcv-reset" onClick={reset}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset to detected</button>}</div>
          {it.renamed && <p className="mini">Detected as “{it.autoLabel}”.</p>}
        </form>
      )}
      {startEditing ? <div className="mt-3" data-testid="rcv-history">
        <p className="mini">{it.amountRange[0] === it.amountRange[1] ? `Each time ${money(it.amountRange[0])}` : `Ranged ${money(it.amountRange[0])}–${money(it.amountRange[1])}`} · planned at {money(it.amount)}{it.expectedAmount != null ? " (yours)" : it.amount > it.amountRange[0] + 0.004 ? " (the higher recent amount)" : ""}</p>
        {it.matched.length > 0 && <ul className="rcv-txns" aria-label="Recent charges">{it.matched.slice(0, 4).map(t => (
          <li key={t.id}><span>{shortDate(t.date)}</span><span className="truncate">{t.name}</span><span className="amt">{money(Math.abs(t.amount))}</span></li>
        ))}</ul>}
        <p className="mini mt-2">Your name and amount apply to this pattern only; transactions aren't changed.</p>
      </div> : <>
      <div className="h4">How we found this</div>
      <p className="note">{it.why}</p>
      {it.matched.length > 0 && <ul className="rcv-txns" aria-label="Matched transactions">{it.matched.slice(0, 24).map(t => (
        <li key={t.id}><span>{shortDate(t.date)}</span><span className="truncate">{t.name}</span><span className="amt">{money(Math.abs(t.amount))}</span></li>
      ))}</ul>}</>}
    </div>
  );
}
