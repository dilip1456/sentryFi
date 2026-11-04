/**
 * "Detected recurring" review: what the app found repeating in the person's
 * transactions (src/lib/recurring/review.ts), grouped into Income, Bills &
 * utilities, Insurance & tax, Payments & loans and Savings. Each item can be
 * confirmed, edited (cadence, amount, group, covered-by account) or marked
 * "Not recurring" (undo toast; restore from the Dismissed list). Decisions are
 * stored per user and respected by future detection runs.
 *
 * Overlay keys: "rcv" (the list) and "rcv:item:<encoded key>" (one item, a
 * bottom sheet on mobile).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, CircleAlert, RotateCcw, Repeat, X } from "lucide-react";
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
const shortDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric" }) : "—");
const money = (n: number) => (Math.abs(n) < 100 && n % 1 ? `$${n.toFixed(2)}` : fmt(n));

function useActions() {
  const pc = usePicture();
  return useMemo(() => ({
    confirm: (it: ReviewItem) => { pc.recurring.decide(it, { status: "confirmed" }); toast.success(`${it.label} confirmed`, { id: TOAST }); },
    dismiss: (it: ReviewItem) => {
      const prev = pc.recurring.decide(it, { status: "dismissed" });
      toast(`${it.label} marked not recurring`, { id: TOAST, description: "It won't come back. Restore it from Dismissed.", action: { label: "Undo", onClick: () => pc.recurring.revert(it.key, prev) } });
    },
    restore: (it: ReviewItem) => { pc.recurring.restore(it.key); toast(`${it.label} restored`, { id: TOAST }); },
  }), [pc.recurring]);
}

function Badge({ it }: { it: ReviewItem }) {
  if (it.missed) return <span className="rcv-badge warn"><CircleAlert className="h-3 w-3" aria-hidden="true" />Missed or late</span>;
  if (it.status === "confirmed") return <span className="rcv-badge ok"><Check className="h-3 w-3" aria-hidden="true" />{it.edited ? "Edited" : "Confirmed"}</span>;
  return null;
}

function ItemRow({ it }: { it: ReviewItem }) {
  const { open } = useOverlay();
  const a = useActions();
  const amount = it.amountKind === "variable" ? `~${money(it.amount)}` : money(it.amount);
  return (
    <div className="rcv-row" data-testid="rcv-item" data-key={it.key}>
      <button type="button" className="rcv-main" onClick={() => open(itemKey(it.key))} aria-label={`${it.label}, ${it.pattern}. Details`}>
        <span className="rcv-lbl"><b>{it.label}</b><Badge it={it} /><small>{it.pattern}</small></span>
        <span className="rcv-amt">{amount}<small>Last {shortDate(it.lastSeen)} · Next {shortDate(it.nextDue)}</small></span>
        <ChevronRight className="h-4 w-4 rcv-chev" aria-hidden="true" />
      </button>
      <div className="rcv-acts">
        {it.status !== "confirmed" && <button type="button" className="rcv-icon ok" onClick={() => a.confirm(it)} aria-label={`Confirm ${it.label}`} title="Confirm"><Check className="h-4 w-4" /></button>}
        <button type="button" className="rcv-icon no" onClick={() => a.dismiss(it)} aria-label={`${it.label} is not recurring`} title="Not recurring"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** Compact card on the Picture: counts per group and what needs a look. */
export function RecurringCard() {
  const pc = usePicture();
  const { open } = useOverlay();
  const { items, dismissed } = pc.m.review;
  const toReview = items.filter(i => i.status === "suggested").length;
  const missed = items.filter(i => i.missed).length;
  return (
    <div className="sec rcv-card" data-testid="rcv-card">
      <div className="sec-h">
        <span className="sec-ico" aria-hidden="true"><Repeat className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0"><div className="sec-t">Detected recurring</div>
          <div className="sec-s">{items.length ? `${items.length} pattern${items.length === 1 ? "" : "s"} found${toReview ? ` · ${toReview} to review` : ""}` : "No repeating payments found yet"}</div></div>
        <button type="button" className="sec-more" onClick={() => open("rcv")}>Review<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="rcv-chips">
        {REVIEW_GROUPS.map(g => { const n = items.filter(i => i.group === g).length; return n ? <span key={g} className="rcv-chip">{REVIEW_GROUP_LABEL[g]} <b>{n}</b></span> : null; })}
        {dismissed.length > 0 && <span className="rcv-chip muted">Dismissed <b>{dismissed.length}</b></span>}
      </div>
      {missed > 0 && <p className="rcv-missed"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{missed} confirmed item{missed === 1 ? " is" : "s are"} missed or late.</p>}
    </div>
  );
}

export function RecurringList() {
  const pc = usePicture();
  const a = useActions();
  const { items, dismissed } = pc.m.review;
  const [showDismissed, setShowDismissed] = useState(false);
  return (
    <div className="rcv-list" data-testid="rcv-list">
      <p className="note mb-3">Payments and deposits that repeat on a schedule. Income needs 3+ months; bills and payments 3+ times; insurance and tax count from 2 (yearly and every-6-months too). Food, groceries, shopping and gas are never treated as recurring.</p>
      {REVIEW_GROUPS.map(g => {
        const list = items.filter(i => i.group === g);
        return (
          <section key={g} aria-label={REVIEW_GROUP_LABEL[g]}>
            <div className="h4">{REVIEW_GROUP_LABEL[g]} <span className="rcv-n">{list.length}</span></div>
            {list.length ? <div className="rows">{list.map(it => <ItemRow key={it.key} it={it} />)}</div> : <p className="mini">Nothing found.</p>}
          </section>
        );
      })}
      <div className="h4 flex items-center justify-between"><span>Dismissed <span className="rcv-n">{dismissed.length}</span></span>
        {dismissed.length > 0 && <button type="button" className="sec-more !ml-0" onClick={() => setShowDismissed(v => !v)} aria-expanded={showDismissed}>{showDismissed ? "Hide" : "Show"}</button>}</div>
      {!dismissed.length && <p className="mini">Items you mark “Not recurring” go here, so you can restore them.</p>}
      {showDismissed && <div className="rows">{dismissed.map(it => (
        <div className="rcv-row dismissed" key={it.key} data-testid="rcv-dismissed">
          <span className="rcv-main static"><span className="rcv-lbl"><b>{it.label}</b><small>{it.pattern || CADENCE_LABEL[it.cadence]} · {money(it.amount)}</small></span></span>
          <div className="rcv-acts"><button type="button" className="btn" onClick={() => a.restore(it)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Restore</button></div>
        </div>
      ))}</div>}
    </div>
  );
}

export function RecurringItem({ it }: { it: ReviewItem }) {
  const pc = usePicture();
  const { close } = useOverlay();
  const a = useActions();
  const [editing, setEditing] = useState(false);
  const [cadence, setCadence] = useState<Cadence>(it.cadence);
  const [amount, setAmount] = useState(String(Math.round(it.amount * 100) / 100));
  const [group, setGroup] = useState<ReviewGroup>(it.group);
  const [cover, setCover] = useState(it.coverAccountId ?? "");
  const accounts = pc.m.accounts.filter(x => x.kind === "bank" || x.kind === "save" || x.kind === "card");
  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt >= 0;
  const save = () => {
    if (!valid) return;
    pc.recurring.decide(it, { status: "confirmed", cadence: cadence !== it.cadence || it.edited ? cadence : null, amount: Math.abs(amt - it.amount) > 0.004 || it.edited ? amt : null, group: group !== it.group || it.edited ? group : null, coverAccountId: cover || null });
    toast.success(`${it.label} updated`, { id: TOAST });
    setEditing(false);
  };
  const facts = [
    { k: "Typical amount", v: it.amountKind === "variable" ? `${money(it.amountRange[0])}–${money(it.amountRange[1])}` : money(it.amount), s: it.amountKind === "variable" ? `about ${money(it.amount)} · varies` : "fixed" },
    { k: "Monthly equivalent", v: money(it.monthly), s: CADENCE_LABEL[it.cadence] },
    { k: "Next expected", v: shortDate(it.nextDue), s: `Last seen ${shortDate(it.lastSeen)}` },
  ];
  return (
    <div className="rcv-item" data-testid="rcv-item-detail">
      <div className="flex flex-wrap items-center gap-2 mb-2"><span className="rcv-badge">{REVIEW_GROUP_LABEL[it.group]}</span><Badge it={it} /><span className="mini">{it.pattern}</span></div>
      <div className="kv">{facts.map(f => <div key={f.k}><div className="k">{f.k}</div><div className="v">{f.v}</div><div className="mini">{f.s}</div></div>)}</div>
      {it.missed && <p className="rcv-missed mt-3"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{it.daysLate ? `Expected ${it.daysLate} day${it.daysLate === 1 ? "" : "s"} ago and not seen yet.` : "The expected payment hasn't shown up."}</p>}
      {!editing ? (
        <div className="rcv-btns">
          {it.status !== "confirmed" && <button type="button" className="btn-gold" onClick={() => a.confirm(it)}><Check className="h-4 w-4" aria-hidden="true" />Confirm</button>}
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn" onClick={() => { a.dismiss(it); close(); }}><X className="h-4 w-4" aria-hidden="true" />Not recurring</button>
        </div>
      ) : (
        <form className="rcv-form" onSubmit={e => { e.preventDefault(); save(); }}>
          <label>How often<select value={cadence} onChange={e => setCadence(e.target.value as Cadence)}>{CADENCES.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}</select></label>
          <label>Amount each time<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!valid} /></label>
          <label>Group<select value={group} onChange={e => setGroup(e.target.value as ReviewGroup)}>{REVIEW_GROUPS.map(g => <option key={g} value={g}>{REVIEW_GROUP_LABEL[g]}</option>)}</select></label>
          <label>{it.direction === "inflow" ? "Lands in" : "Covered by"}<select value={cover} onChange={e => setCover(e.target.value)}><option value="">{it.direction === "inflow" ? "As detected" : "Not set"}</option>{accounts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <div className="rcv-btns"><button type="submit" className="btn-gold" disabled={!valid}>Save</button><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      )}
      <div className="h4">How we found this</div>
      <p className="note">{it.why}</p>
      <p className="mini mt-1">Confidence {Math.round(it.confidence * 100)}% · {it.occurrences} match{it.occurrences === 1 ? "" : "es"}</p>
      {it.matched.length > 0 && <ul className="rcv-txns" aria-label="Matched transactions">{it.matched.slice(0, 24).map(t => (
        <li key={t.id}><span>{shortDate(t.date)}</span><span className="truncate">{t.name}</span><span className="amt">{money(Math.abs(t.amount))}</span></li>
      ))}</ul>}
      {it.matched.length > 24 && <p className="mini mt-1">and {it.matched.length - 24} more</p>}
    </div>
  );
}
