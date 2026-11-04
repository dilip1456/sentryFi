import { ArrowLeftRight, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, type TimelineEvent, type UpcomingAccount } from "@/lib/timeline";
import { accountLabel, subtitleOf, CAT_ICON, dfmt, dlong, eventCat, fmtAmount, hasTime, monthShort, streamKeyOf, tfmt, usd } from "./format";
import { StatusBadge } from "./timeline-ui";

function sourceLabel(e: TimelineEvent): string {
  if (e.upcoming) {
    if (e.meta?.kind === "card_statement") return "Card statement due date";
    if (e.id.startsWith("up:tax:")) return "Tax milestone";
    return "Projected from a recurring stream";
  }
  switch (e.source) {
    case "alert": return e.meta?.computed ? "Sentry Finance paycheck check" : "Sentry Finance alert";
    case "inference": return "Sentry Finance finding";
    case "tax_milestone": return "Tax milestone";
    case "occurrence": return "Recurring payment record";
    default: return "Linked account transaction";
  }
}

interface Props {
  e: TimelineEvent;
  accounts: UpcomingAccount[] | undefined;
  /** Loaded history (for "Last N times" of the same stream). */
  history: TimelineEvent[];
  today: string;
  onMarkSeen?: (e: TimelineEvent) => void;
}

export function TimelineDetail({ e, accounts, history, today, onMarkSeen }: Props) {
  const cat = eventCat(e);
  const subtitle = subtitleOf(e, accounts);
  const Icon = CAT_ICON[cat];
  const key = streamKeyOf(e);
  const past = key
    ? history.filter(x => streamKeyOf(x) === key && x.occurred_on <= (e.upcoming ? today : e.occurred_on)).slice(0, 6).reverse()
    : [];
  const mx = Math.max(...past.map(x => Math.abs(x.amount ?? 0)), 1);
  const isOutflow = (e.amount ?? 0) < 0;
  const showCovered = e.upcoming && isOutflow && e.category !== "transfer" && !e.is_internal;
  const typeLabel = e.is_internal ? "Internal transfer" : CATEGORY_LABEL[e.category];

  const rows: [string, React.ReactNode][] = [
    ["When", e.upcoming ? `${dlong(e.occurred_on)} · expected` : hasTime(e) ? `${dlong(e.occurred_on)} · ${tfmt(e.occurred_at)}` : dlong(e.occurred_on)],
    ...(e.meta?.computed && !e.account_id ? [] : [["Account", accountLabel(e.account_id, accounts)] as [string, React.ReactNode]]),
    ["Type", <span key="t" className={cn("tl-tag", `k-${cat}`)}><Icon className="h-3.5 w-3.5" aria-hidden />{typeLabel}</span>],
    ["Status", <StatusBadge key="s" status={e.status} big className="inline-flex items-center gap-1.5 font-medium" />],
  ];
  if (showCovered) {
    rows.push(["Covered by", e.covered_by
      ? <span className="tl-tag k-income"><CircleCheck className="h-3.5 w-3.5" aria-hidden />{e.covered_by}</span>
      : <span className="tl-tag k-alerts"><TriangleAlert className="h-3.5 w-3.5" aria-hidden />Unassigned</span>]);
  }
  if (e.meta?.alert_type === "paycheck_shortfall") rows.push(["Paychecks this month", `${e.meta.found} of usual ~${e.meta.typical}`]);
  if (e.repeats) rows.push(["Repeats", e.repeats]);
  if ((e.source === "transaction" || e.source === "occurrence") && e.subtitle && e.subtitle !== e.title) rows.push(["Description", e.subtitle]);
  rows.push(["Source", sourceLabel(e)]);

  return (
    <div data-testid="tl-detail">
      <div className="flex items-end justify-between gap-3">
        <div className={cn("tl-big", (e.amount ?? 0) > 0 && "text-positive")}>
          {e.amount
            ? <>{e.estimated && <span className="tl-est">est.</span>}{fmtAmount(e.amount)}</>
            : <Icon className="h-8 w-8 text-primary" aria-hidden />}
        </div>
        {e.pending && <span className="tl-tag k-transfer">Pending</span>}
      </div>
      {subtitle && <p className="text-[13.5px] text-muted-foreground mt-1">{subtitle}</p>}
      {e.category === "alerts" && (e.status === "flag" || e.status === "review") && (
        <div className="tl-flags mt-4">
          <div className="font-semibold flex items-center gap-2 text-negative"><TriangleAlert className="h-4 w-4" aria-hidden />{e.title}</div>
          {typeof e.meta?.detail === "string"
            ? <p className="tl-note mt-1 !text-foreground">{e.meta.detail}</p>
            : e.subtitle && <p className="tl-note mt-1 !text-foreground">{e.subtitle}.</p>}
        </div>
      )}
      {e.estimated && (
        <p className="tl-note mt-2 flex gap-1.5"><Info className="h-4 w-4 shrink-0" aria-hidden />
          {e.meta?.kind === "card_statement" ? "No statement balance yet: estimated from the current balance." : "Estimated: this amount varies from period to period."}
        </p>
      )}
      {e.is_internal && (
        <p className="tl-note mt-2 flex gap-1.5"><ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />Money moved between your own accounts. Hidden from the timeline unless “Show internal transfers” is on.</p>
      )}
      <div className="tl-kv">
        {rows.map(([k, v]) => [<div key={k + "k"}>{k}</div>, <div key={k + "v"}>{v}</div>])}
      </div>
      {past.length > 1 && !e.is_internal && (
        <>
          <div className="tl-h4">Last {past.length} times</div>
          <div className="tl-spark" role="img" aria-label={past.map(x => `${dfmt(x.occurred_on)} ${usd(x.amount ?? 0)}`).join(", ")}>
            {past.map(x => <span key={x.id} className={x.id === e.id ? "cur" : ""} style={{ height: `${Math.max(6, (Math.abs(x.amount ?? 0) / mx) * 100)}%` }} />)}
          </div>
          <div className="tl-spark-l">{past.map(x => <span key={x.id}>{monthShort(x.occurred_on)}</span>)}</div>
        </>
      )}
      {e.source === "alert" && e.status === "flag" && onMarkSeen && (
        <div className="grid grid-cols-1 gap-2 mt-5">
          <button type="button" className="tl-btn-gold !min-h-[44px]" onClick={() => onMarkSeen(e)}>
            <CircleCheck className="h-4 w-4" aria-hidden />Mark as seen
          </button>
        </div>
      )}
    </div>
  );
}
