import { cn } from "@/lib/utils";
import { STATUS_LABEL, type TimelineEvent, type TimelineStatus } from "@/lib/timeline";
import { CAT_ICON, dfmt, eventCat, fmtAmount, STATUS_ICON, toneClass } from "./format";

/** Status is always icon + word (never colour alone). */
export function StatusBadge({ status, className, big }: { status: TimelineStatus; className?: string; big?: boolean }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("st", toneClass(status), className)}>
      <Icon className={big ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />{STATUS_LABEL[status]}
    </span>
  );
}

export function EventCard({ e, ghost, onOpen, subtitle }: { e: TimelineEvent; ghost?: boolean; subtitle?: string | null; onOpen: (e: TimelineEvent, el: HTMLElement) => void }) {
  const cat = eventCat(e);
  const Icon = CAT_ICON[cat];
  const label = `${e.title}, ${e.amount ? fmtAmount(e.amount) + ", " : ""}${dfmt(e.occurred_on)}, ${STATUS_LABEL[e.status]}`;
  return (
    <li>
      <button
        type="button"
        className={cn("tl-ev", ghost && "ghost", e.category === "alerts" && e.status === "flag" && "alert", e.is_internal && "opacity-80")}
        data-tl-ev={e.id}
        data-cat={cat}
        data-internal={e.is_internal ? "true" : undefined}
        aria-label={label}
        onClick={ev => onOpen(e, ev.currentTarget)}
      >
        <span className={cn("dot", `k-${cat}`)} aria-hidden><Icon className="h-4 w-4" /></span>
        <span className="t">{e.title}</span>
        <span className={cn("a", (e.amount ?? 0) > 0 && "text-positive")}>
          {e.amount ? <>{e.estimated && <span className="tl-est">est.</span>}{fmtAmount(e.amount)}</> : null}
        </span>
        <span className="s">
          {ghost && <><b className="text-foreground font-medium">{dfmt(e.occurred_on)}</b> · </>}
          {subtitle === undefined ? e.subtitle : subtitle}
        </span>
        <StatusBadge status={e.status} />
      </button>
    </li>
  );
}

export function Skeletons({ n }: { n: number }) {
  return (
    <div data-testid="tl-skeleton">
      <div className="tl-skel-h" />
      <div className="tl-skel-wrap" aria-hidden>
        {Array.from({ length: n }, (_, i) => <div key={i} className="tl-skel"><i /><i /><i /></div>)}
      </div>
    </div>
  );
}
