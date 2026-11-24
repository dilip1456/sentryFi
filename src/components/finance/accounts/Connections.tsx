import { AlertTriangle, CheckCircle2, Clock, Link2, Pencil, RefreshCw } from "lucide-react";
import { BankAvatar } from "./AccountRow";
import { agoLabel, signInLabel } from "@/lib/accounts/grouping";

export interface ConnectionRow {
  key: string;
  itemId: string | null;
  bankName: string;
  accounts: number;
  status: "ok" | "stale" | "broken" | "manual";
  lastSync: string | null;
}

/** Each bank: status (icon + word), last sync, account count, and Refresh or Reconnect. */
export function ConnectionsList({ rows, now, onRefresh, onReconnect, refreshing }: {
  rows: ConnectionRow[]; now: Date; refreshing?: boolean;
  onRefresh: () => void; onReconnect: (itemId: string) => void;
}) {
  return (
    <div data-testid="ac-connections">
      {rows.map(r => {
        const ago = agoLabel(r.lastSync, now);
        return (
          <div key={r.key} className="ac-li">
            <BankAvatar name={r.status === "manual" ? "Manual" : r.bankName} />
            <div>
              <div className="t">{r.bankName}</div>
              <div className="s">
                {r.status === "ok" && <span className="st-ok inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden />Synced</span>}
                {r.status === "stale" && <span className="st-warn inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />Synced {ago}</span>}
                {r.status === "broken" && <span className="st-bad inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />Needs sign-in</span>}
                {r.status === "manual" && <span className="inline-flex items-center gap-1"><Pencil className="h-3 w-3" aria-hidden />Manual · update anytime</span>}
                {r.status === "ok" && ago && <span>· {ago}</span>}
              </div>
            </div>
            {r.status === "broken" && r.itemId
              ? <button type="button" className="ac-reconn ib" onClick={() => onReconnect(r.itemId!)}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reconnect</button>
              : r.status !== "manual"
                ? <button type="button" className="ac-ib ib tap-44" aria-label={`Refresh ${r.bankName}`} onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /></button>
                : null}
          </div>
        );
      })}
    </div>
  );
}

export function ConnectionsCard(props: Parameters<typeof ConnectionsList>[0]) {
  return (
    <section className="ac-card" aria-label="Connections">
      <h3><Link2 className="h-4 w-4 text-primary" aria-hidden />Connections</h3>
      <p className="hs">{signInLabel(props.rows.filter(r => r.status === "broken").map(r => r.bankName), "All banks synced")} · Plaid</p>
      <ConnectionsList {...props} />
    </section>
  );
}
