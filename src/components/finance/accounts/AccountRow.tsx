import { AlertTriangle, CalendarDays, ChevronRight, Pencil } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { getBankBrand } from "@/lib/accounts/institutions";
import { identifierOf, rowFact, utilizationTone, type AccountView } from "@/lib/accounts/grouping";
import { cn } from "@/lib/utils";

export function BankAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const b = getBankBrand(name || "Bank");
  return (
    <span className="ac-av" style={{ background: b.bg, color: b.color, height: size, width: size }} aria-hidden>
      {b.abbr}
    </span>
  );
}

/** One 60px row: avatar · name (2 lines) · one fact + identifier · balance (+ meter) · chevron. */
export function AccountRow({ v, today, onOpen }: { v: AccountView; today: Date; onOpen: (v: AccountView) => void }) {
  const fact = rowFact(v, today);
  const pct = v.utilization != null ? Math.round(v.utilization * 100) : null;
  const tone = v.utilization != null ? utilizationTone(v.utilization) : null;
  const label = [
    v.name, identifierOf(v), fmtUSD(v.balance, { cents: true }),
    pct != null ? `${pct}% of limit used` : null,
    fact?.text,
  ].filter(Boolean).join(", ");
  return (
    <button type="button" className={cn("ac-row", v.needsSignIn && "paused")} aria-label={label} onClick={() => onOpen(v)} data-account-row={v.key}>
      <BankAvatar name={v.kind === "manual" ? "Manual" : v.bankName} />
      <span className="min-w-0">
        <span className="nm">{v.name}</span>
        <span className="sb">
          {fact?.kind === "signin" && <span className="st-bad"><AlertTriangle className="h-3 w-3" aria-hidden />{fact.text.replace(/as of .+$/, m => m.replace(/ /g, "\u00a0"))}</span>}
          {fact?.kind === "manual" && <span><Pencil className="h-3 w-3" aria-hidden />{fact.text}</span>}
          {fact?.kind === "due" && <span className={cn("due", fact.soon && "soon")}><CalendarDays className="h-3 w-3" aria-hidden />{fact.text}</span>}
          {fact?.kind === "apy" && <span>{fact.text}</span>}
          {fact && fact.kind !== "manual" && fact.kind !== "signin" && <span aria-hidden>·</span>}
          {fact?.kind !== "manual" && fact?.kind !== "signin" && <span className="id">{identifierOf(v)}</span>}
        </span>
      </span>
      <span className="rt">
        <span className={cn("bal block", v.balance < 0 && "neg")}>{fmtUSD(v.balance, { cents: true })}</span>
        {pct != null && (
          <span className="ut">
            <span className="ac-meter" aria-hidden><i className={`m-${tone}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>
            {pct}%
          </span>
        )}
      </span>
      <ChevronRight className="chev h-4 w-4" aria-hidden />
    </button>
  );
}
