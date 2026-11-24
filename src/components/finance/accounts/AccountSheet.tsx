import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, ExternalLink, Hand, Lock, Loader2, Pencil, Repeat, AlertTriangle } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { daysUntil, shortDate, utilizationTone, type AccountView } from "@/lib/accounts/grouping";
import type { AccountFinding, AutopayState } from "@/lib/accounts/findings";
import type { AccountMetaEntry, CreditDetailLike, LoanDetailLike } from "@/lib/accounts/types";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";
import { cn } from "@/lib/utils";
import { AccountsSheet } from "./AccountsSheet";
import { AccountEdit, type EditSave } from "./AccountEdit";
import { FindingBox } from "./ThingsToConfirm";
import { usePlaidUpdate } from "./usePlaidUpdate";

export interface SheetTxn { id: string; date: string; amount: number; name: string | null; merchant_name: string | null; pending: boolean | null }

const TYPE_LABEL: Record<string, string> = { checking: "Checking", savings: "Savings", credit: "Credit card", loan: "Loan", investment: "Investment", other: "Asset" };
const subLabel = (v: AccountView) => {
  const sub = (v.linked?.subtype ?? v.manual?.type ?? "").replace(/_/g, " ");
  if (v.group === "credit") return "Credit card";
  return sub ? sub.replace(/\b\w/g, c => c.toUpperCase()) : TYPE_LABEL[v.group];
};

function GrantConsent({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const { start, busy } = usePlaidUpdate(itemId, "consent", onDone);
  return (
    <button type="button" className="btn w-full mt-3" onClick={() => start()} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
      Show statement and due date
    </button>
  );
}

export interface AccountSheetProps {
  v: AccountView | null;
  meta: AccountMetaEntry;
  credit?: CreditDetailLike;
  loan?: LoanDetailLike;
  txns: SheetTxn[];
  autopay: AutopayState;
  autopayFromName: string | null;
  findings: AccountFinding[];
  instUrl: string | null;
  lastSync: string | null;
  today: Date;
  onClose: () => void;
  onSave: (s: EditSave) => void;
  onAcceptFinding: (f: AccountFinding) => void;
  onDismissFinding: (f: AccountFinding) => void;
  onDisconnect: () => void;
  onEditManual?: () => void;
  onDeleteManual?: () => void;
  onReload: () => void;
  onSeeAll?: () => void;
}

/** Details → (Rename or hide) in one sheet. */
export function AccountSheet(p: AccountSheetProps) {
  const { v } = p;
  const [screen, setScreen] = useState<"details" | "edit">("details");
  useEffect(() => { setScreen("details"); }, [v?.key]);
  // The pushed edit screen owns its own history entry: Back returns to details.
  useHistoryLayer(!!v && screen === "edit", () => setScreen("details"));
  const subtitle = v ? `${v.kind === "manual" ? "Added by you" : v.bankName}${v.mask ? ` ··${v.mask}` : ""} · ${subLabel(v)}` : "";
  return (
    <AccountsSheet open={!!v} onClose={p.onClose} testId="ac-detail-sheet"
      title={v ? (screen === "edit" ? "Rename or hide" : v.name) : ""}
      subtitle={v ? (screen === "edit" ? `${v.bankName}${v.mask ? ` ··${v.mask}` : ""}` : subtitle) : ""}
      onBack={screen === "edit" ? () => setScreen("details") : undefined}>
      {v && screen === "details" && <Details {...p} v={v} onEdit={() => setScreen("edit")} />}
      {v && screen === "edit" && (
        <AccountEdit v={v} meta={p.meta} instUrl={p.instUrl}
          onCancel={() => setScreen("details")}
          onSave={s => { p.onSave(s); if (s.hidden) p.onClose(); else setScreen("details"); }}
          onDisconnect={v.kind === "linked" ? p.onDisconnect : undefined}
          onEditManual={p.onEditManual} onDeleteManual={p.onDeleteManual} />
      )}
    </AccountsSheet>
  );
}

function Details(p: AccountSheetProps & { v: AccountView; onEdit: () => void }) {
  const { v, credit, loan, meta, today } = p;
  const pct = v.utilization != null ? Math.round(v.utilization * 100) : null;
  const tone = v.utilization != null ? utilizationTone(v.utilization) : null;
  const due = v.dueDate;
  const dueIn = due ? daysUntil(due, today) : null;
  const recent = p.txns.filter(t => !t.pending).slice(0, 5);
  const payoff = v.limit && v.utilization != null && v.utilization > 0.3 ? Math.abs(v.balance) - v.limit * 0.3 : null;
  const kv: [string, React.ReactNode][] = [];
  if (v.group === "credit") {
    if (credit?.last_statement_balance != null) kv.push(["Statement balance", fmtUSD(Number(credit.last_statement_balance), { cents: true })]);
    if (credit?.minimum_payment_amount != null) kv.push(["Minimum due", fmtUSD(Number(credit.minimum_payment_amount), { cents: true })]);
    if (due) kv.push(["Due date", <span key="d" className={cn("due", dueIn != null && dueIn <= 7 && "soon")}><CalendarDays className="h-3.5 w-3.5" aria-hidden />{shortDate(due)}{dueIn != null && dueIn >= 0 ? ` · ${dueIn === 0 ? "today" : `in ${dueIn} day${dueIn === 1 ? "" : "s"}`}` : ""}</span>]);
    if (v.limit) kv.push(["Credit limit", fmtUSD(v.limit)]);
    if (meta.apr != null) kv.push(["APR", `${meta.apr}%`]);
    if (meta.promoApr != null) kv.push(["Promo APR", `${meta.promoApr}%${meta.promoEndDate ? ` until ${shortDate(meta.promoEndDate)}` : ""}`]);
  } else if (v.group === "loan") {
    if (loan?.next_monthly_payment != null) kv.push(["Next payment", fmtUSD(Number(loan.next_monthly_payment), { cents: true })]);
    if (due) kv.push(["Due date", <span key="d" className={cn("due", dueIn != null && dueIn <= 7 && "soon")}><CalendarDays className="h-3.5 w-3.5" aria-hidden />{shortDate(due)}</span>]);
    const rate = loan?.interest_rate ?? v.manual?.interest_rate ?? null;
    if (rate != null) kv.push(["Interest rate", `${Number(rate)}%`]);
    if (v.manual?.monthly_payment) kv.push(["Monthly payment", fmtUSD(Number(v.manual.monthly_payment), { cents: true })]);
    if (v.manual?.property_value) kv.push(["Property value", fmtUSD(Number(v.manual.property_value))]);
  } else if (v.group === "savings" && v.apy != null) {
    kv.push([meta.apr != null ? "APY" : "APY (estimated)", `${v.apy.toFixed(2)}%`]);
  }
  if (v.kind === "linked") {
    if (v.linked?.available_balance != null && v.group !== "credit" && v.group !== "loan") kv.push(["Available", fmtUSD(Number(v.linked.available_balance), { cents: true })]);
    kv.push(["Bank", v.bankName]);
    if (v.mask) kv.push(["Account", `··${v.mask}`]);
    kv.push(["Last synced", v.needsSignIn
      ? <span key="s" className="st-bad inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Needs sign-in{v.asOf ? ` · ${shortDate(v.asOf)}` : ""}</span>
      : p.lastSync ? <span key="s" className="st-ok inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{fmtSync(p.lastSync, today)}</span> : "—"]);
  } else {
    kv.push(["Type", subLabel(v)]);
    if (v.manual?.institution_name) kv.push(["Bank", v.manual.institution_name]);
    if (v.asOf) kv.push(["Updated", shortDate(v.asOf)]);
  }

  return (
    <div data-testid="ac-details">
      <div className="ac-sec-t !mt-0">{v.debt ? "You owe" : "Balance"}</div>
      <div className={cn("ac-big", v.balance < 0 && "neg")}>{fmtUSD(v.balance, { cents: true })}</div>

      {pct != null && v.limit && (
        <div className="mt-3">
          <div className="flex justify-between text-[13.5px]"><span className="text-muted-foreground">Utilization</span><b className="tabular-nums">{pct}% of {fmtUSD(v.limit)}</b></div>
          <div className="ac-bar-full" aria-hidden><i className={`m-${tone}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></div>
          <p className="text-[12.5px] text-muted-foreground mt-2">
            {tone === "ok" ? "Under 30%, healthy for your credit score." : `Paying ${fmtUSD(Math.ceil(payoff ?? 0))} brings it under 30%, which helps your credit score.`}
          </p>
        </div>
      )}

      {p.autopay === "on" && (
        <div className="ac-pay">
          <span className="ic" aria-hidden><Repeat className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="t">Autopay on</div><div className="s truncate">{p.autopayFromName ? `Paid from ${p.autopayFromName}` : "Confirmed by you"}</div></div>
        </div>
      )}
      {p.autopay === "manual" && (
        <div className="ac-pay">
          <span className="ic !bg-muted !text-muted-foreground" aria-hidden><Hand className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="t">Pay manually</div><div className="s">Recent payments look made by hand</div></div>
        </div>
      )}
      {p.findings.map(f => <FindingBox key={f.id} f={f} onAccept={p.onAcceptFinding} onDismiss={p.onDismissFinding} />)}
      {v.group === "credit" && !credit && v.itemId && <GrantConsent itemId={v.itemId} onDone={p.onReload} />}

      <div className="ac-kv">
        {kv.map(([k, val]) => [<div key={`${k}-k`}>{k}</div>, <div key={`${k}-v`}>{val}</div>])}
      </div>

      {recent.length > 0 && (
        <>
          <div className="ac-sec-t">Recent activity</div>
          {recent.map(t => {
            const amt = Number(t.amount);
            return (
              <div key={t.id} className="ac-tx">
                <div className="min-w-0"><div className="n">{t.merchant_name || t.name || "Transaction"}</div><div className="d">{shortDate(t.date)}</div></div>
                <div className={cn("a", amt < 0 && "pos")}>{amt < 0 ? "+" : "−"}{fmtUSD(Math.abs(amt), { cents: true })}</div>
              </div>
            );
          })}
          {p.onSeeAll && <button type="button" className="ac-link" onClick={p.onSeeAll}>See all in Spending<ChevronRight className="h-4 w-4" aria-hidden /></button>}
        </>
      )}

      <div className="ac-acts">
        <button type="button" className="btn" onClick={p.onEdit} data-testid="ac-rename-hide"><Pencil className="h-4 w-4" aria-hidden />Rename or hide</button>
        {p.instUrl
          ? <a className="btn" href={p.instUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /><span className="truncate">Open {v.kind === "manual" ? "site" : v.bankName}</span></a>
          : v.kind === "manual" && p.onEditManual ? <button type="button" className="btn" onClick={p.onEditManual}>Update balance</button> : <span />}
      </div>
    </div>
  );
}

function fmtSync(iso: string, today: Date) {
  const d = new Date(iso);
  const same = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return same ? `Today ${time}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}
