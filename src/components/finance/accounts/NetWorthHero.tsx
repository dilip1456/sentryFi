import { AlertTriangle, CheckCircle2, ChevronRight, Clock } from "lucide-react";
import { fmtUSD, fmtUSDCompact } from "@/lib/format";
import { NET_WORTH_GROUP_LABEL, NET_WORTH_GROUP_ORDER, type NetWorthTotals } from "@/lib/accounts/totals";
import { agoLabel, signInLabel } from "@/lib/accounts/grouping";

export interface SyncSummary {
  banks: number;
  broken: number;
  /** Names of banks that need sign-in (shown instead of a count). */
  brokenNames?: string[];
  /** Newest successful sync across banks, ISO (null = unknown). */
  lastSync: string | null;
  stale: boolean;
}


/**
 * Net worth, assets / debts, the stacked bar with its legend, and one sync
 * line (phones and tablets; on wide screens the Connections card in the rail
 * replaces it). No "+$X this month" chip: there's no balance history yet.
 */
export function NetWorthHero({ t, sync, now, onConnections }: { t: NetWorthTotals; sync: SyncSummary; now: Date; onConnections: () => void }) {
  const parts = NET_WORTH_GROUP_ORDER.map(g => ({ g, v: t.byGroup[g] })).filter(p => Math.round(p.v) !== 0);
  const scale = parts.reduce((s, p) => s + Math.abs(p.v), 0);
  const ago = agoLabel(sync.lastSync, now);
  return (
    <section className="ac-hero" aria-label="Net worth" data-testid="ac-hero">
      <div className="lbl">Net worth</div>
      <div className="nw" data-testid="ac-networth">{fmtUSD(t.netWorth, { cents: true })}</div>
      <div className="ad">
        <span>Assets<b className="pos">{fmtUSD(Math.round(t.assets))}</b></span>
        <span>Debts<b className="neg">{fmtUSD(-Math.round(t.liabilities))}</b></span>
      </div>
      {scale > 0 && (
        <>
          <div className="ac-stack" role="img" aria-label={parts.map(p => `${NET_WORTH_GROUP_LABEL[p.g]} ${fmtUSDCompact(p.v)}`).join(", ")}>
            {parts.map(p => <span key={p.g} className={`ac-k-${p.g}`} style={{ width: `${(Math.abs(p.v) / scale) * 100}%` }} />)}
          </div>
          <div className="ac-legend">
            {parts.map(p => (
              <span key={p.g}><i className={`ac-k-${p.g}`} aria-hidden />{NET_WORTH_GROUP_LABEL[p.g]} <b>{fmtUSDCompact(p.v)}</b></span>
            ))}
          </div>
        </>
      )}
      {sync.banks > 0 && (
        <button type="button" className="ac-sync" onClick={onConnections} data-testid="ac-sync-line">
          {sync.broken > 0 ? (
            <span className="bad inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" aria-hidden />{signInLabel(sync.brokenNames ?? [], "A bank needs sign-in")}</span>
          ) : sync.stale ? (
            <span className="stale inline-flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden />Synced {ago}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 min-w-0"><CheckCircle2 className="ok h-4 w-4 shrink-0" aria-hidden /><span className="ok">Synced</span>
              {ago && <span className="text-muted-foreground truncate">· {ago}</span>}</span>
          )}
          <span className="more">Connections<ChevronRight className="h-4 w-4" aria-hidden /></span>
        </button>
      )}
    </section>
  );
}
