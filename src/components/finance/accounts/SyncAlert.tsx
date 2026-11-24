import { Unplug, RefreshCw } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { shortDate } from "@/lib/accounts/grouping";

export interface BrokenBank { itemId: string; bankName: string; accounts: number; total: number; since: string | null }

/** One red strip per broken bank: what stopped, Reconnect and Why? (opens the reconnect sheet). */
export function SyncAlert({ b, onReconnect, onWhy, busy }: { b: BrokenBank; onReconnect: () => void; onWhy: () => void; busy?: boolean }) {
  return (
    <div className="ac-alert" role="alert" data-testid="ac-sync-alert">
      <span className="ic" aria-hidden><Unplug className="h-4 w-4" /></span>
      <div className="min-w-0">
        <h3>{b.bankName} stopped syncing</h3>
        <p>
          {b.bankName} needs you to sign in again. {b.accounts === 1 ? "Its account" : "Its accounts"} ({fmtUSD(Math.round(b.total))})
          {b.since ? ` ${b.accounts === 1 ? "is" : "are"} showing ${shortDate(b.since)} balances.` : " may be out of date."}
        </p>
        <div className="acts">
          <button type="button" className="btn-gold" onClick={onReconnect} disabled={busy}><RefreshCw className="h-4 w-4" aria-hidden />Reconnect</button>
          <button type="button" className="btn" onClick={onWhy}>Why?</button>
        </div>
      </div>
    </div>
  );
}
