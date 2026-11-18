import { Building2, CreditCard, Landmark, PiggyBank, RefreshCw, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { fmtUSD, fmtUSDCompact } from "@/lib/format";
import type { AccountView, ViewGroup } from "@/lib/accounts/grouping";
import { AccountRow, BankAvatar } from "./AccountRow";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, LucideIcon> = {
  checking: Wallet, savings: PiggyBank, credit: CreditCard, loan: Building2, investment: TrendingUp, other: Landmark,
};

export function AccountGroupCard({ g, by, today, onOpen, onReconnect }: {
  g: ViewGroup; by: "type" | "bank"; today: Date;
  onOpen: (v: AccountView) => void;
  onReconnect?: (itemId: string) => void;
}) {
  const Icon = TYPE_ICON[g.key] ?? Landmark;
  // No "N accounts" sublabel (no counts in the UI); cards keep their utilization.
  const sub = by === "type" && g.key === "credit" && g.limit
    ? `${Math.round(((g.used ?? 0) / g.limit) * 100)}% of ${fmtUSDCompact(g.limit)} limit used`
    : null;
  return (
    <section className="ac-grp" aria-label={g.label} data-ac-group={g.key}>
      <div className="ac-gh">
        {by === "type"
          ? <span className="gi" aria-hidden><Icon className="h-4 w-4" /></span>
          : <BankAvatar name={g.key === "__manual" ? "Manual" : g.label} size={32} />}
        <div className="min-w-0">
          <div className="gt truncate">{g.label}</div>
          {by === "bank" && g.needsSignIn
            ? <div className="gs"><span className="st-bad">Needs sign-in</span></div>
            : sub && <div className="gs">{sub}</div>}
        </div>
        {by === "bank" && g.needsSignIn && g.itemId && onReconnect
          ? <button type="button" className="ac-reconn ml-auto" onClick={() => onReconnect(g.itemId!)}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reconnect</button>
          : <div className={cn("gv", g.total < 0 && "neg")}>{fmtUSD(Math.round(g.total))}</div>}
      </div>
      {g.views.map(v => <AccountRow key={v.key} v={v} today={today} onOpen={onOpen} />)}
    </section>
  );
}
