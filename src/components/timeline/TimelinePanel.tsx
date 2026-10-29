import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowLeftRight, ArrowUp, Calendar, CalendarClock, CalendarSearch, ChevronsUp, Flag, History, MapPin,
  RotateCw, SearchX, SlidersHorizontal, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHistoryLayer } from "@/hooks/useHistoryLayer";
import {
  markAlertSeen, useTimelineAccounts, useTimelineFeed, useTimelineOldest, useTimelineRealtime, useTimelineUpcoming,
} from "@/hooks/useTimeline";
import { addDays, todayLocal } from "@/lib/recurring/dates";
import {
  activeFilterCount, buildTimelineRows, DEFAULT_FILTERS, matchesUpcoming, showHistory, showUpcoming, TIMELINE_CHIPS,
  toggleChip, UPCOMING_DAYS, UPCOMING_DAYS_EXTENDED, visibleUpcoming,
  type TimelineEvent, type TimelineFilters, type TimelineRow,
} from "@/lib/timeline";
import { CHIP_ICON, CHIP_LABEL, dfmt, dlong, monthLabel, subtitleOf } from "./format";
import { EventCard, Skeletons } from "./timeline-ui";
import { TimelineDetail } from "./TimelineDetail";
import { TimelineDialog, TimelineSheet } from "./TimelineOverlays";
import "./timeline.css";

export interface TimelinePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  /** Demo / guest mode: demo data, no Supabase calls. */
  demo: boolean;
}

type PopKind = "filters" | "jump";

/** Lazy shell: nothing (no queries, no CSS work) until first opened. */
export function TimelinePanel(props: TimelinePanelProps) {
  const [mounted, setMounted] = useState(props.open);
  useEffect(() => { if (props.open) setMounted(true); }, [props.open]);
  return mounted ? <TimelinePanelInner {...props} /> : null;
}

function TimelinePanelInner({ open, onOpenChange, userId, demo }: TimelinePanelProps) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const src = useMemo(() => ({ userId, demo }), [userId, demo]);
  const today = todayLocal();

  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [upAll, setUpAll] = useState(false);
  const [pop, setPop] = useState<PopKind | null>(null); // desktop popovers
  const [sheet, setSheet] = useState<PopKind | null>(null); // mobile sheets
  const [detail, setDetail] = useState<TimelineEvent | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [live, setLive] = useState("");

  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<Element | null>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  // closed panel stays mounted (slide-out animation) but is inert
  useEffect(() => { panelRef.current?.toggleAttribute("inert", !open); }, [open]);
  useHistoryLayer(open, close);

  // ── focus: into the panel on open, back to the opener on close ──
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>("[data-tl-close]")?.focus(), 40);
    return () => {
      clearTimeout(t);
      const el = openerRef.current as HTMLElement | null;
      if (el && document.contains(el)) el.focus();
      setPop(null); setSheet(null); setDetail(null);
    };
  }, [open]);

  // ── Escape: popover first, then the panel (Radix/vaul layers handle their own) ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (pop) { e.preventDefault(); setPop(null); panelRef.current?.querySelector<HTMLElement>(`[data-tl-pop="${pop}"]`)?.focus(); return; }
      if (detail || sheet) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pop, detail, sheet, close]);

  // click outside a desktop popover closes it
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest?.(".tl-pop, [data-tl-pop]")) setPop(null); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pop]);

  // popovers ↔ sheets when crossing the breakpoint
  useEffect(() => { if (isMobile && pop) { setSheet(pop); setPop(null); } }, [isMobile, pop]);

  // ── data ──
  const wantHistory = showHistory(filters);
  const wantUpcoming = showUpcoming(filters);
  const feed = useTimelineFeed(src, filters, open && wantHistory);
  const upcomingQ = useTimelineUpcoming(src, open && wantUpcoming);
  const accountsQ = useTimelineAccounts(src);
  const oldestQ = useTimelineOldest(src, open);
  const realtime = useTimelineRealtime(src, open);

  const history = useMemo(() => {
    const items = feed.data?.pages.flatMap(p => p.items) ?? [];
    return seen.size ? items.map(e => (seen.has(e.id) ? { ...e, status: "seen" as const } : e)) : items;
  }, [feed.data, seen]);

  const upcomingAll = upcomingQ.data ?? [];
  const upDays = upAll ? UPCOMING_DAYS_EXTENDED : UPCOMING_DAYS;
  const upVisible = wantUpcoming && upcomingQ.data ? visibleUpcoming(upcomingAll, filters, today, upDays) : null;
  const upMore = !upAll && upcomingAll.some(e => e.occurred_on > addDays(today, UPCOMING_DAYS) && matchesUpcoming(e, filters));

  const firstLoad = (wantHistory && feed.isPending) || (wantUpcoming && upcomingQ.isPending);
  const rows = useMemo<TimelineRow[]>(
    () => (firstLoad ? [] : buildTimelineRows({ today, upcoming: upVisible, history: wantHistory ? history : [], showToday: wantUpcoming })),
    [firstLoad, today, upVisible, history, wantHistory, wantUpcoming],
  );

  // ── infinite scroll: sentinel 400px before the end of the scroller ──
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isFetching } = feed;
  const canLoad = open && wantHistory && hasNextPage && !isFetchingNextPage && !feed.isError;
  useEffect(() => {
    const root = bodyRef.current, target = sentinelRef.current;
    if (!root || !target || !canLoad) return;
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) fetchNextPage(); }, { root, rootMargin: "0px 0px 400px 0px" });
    io.observe(target);
    return () => io.disconnect();
  }, [canLoad, fetchNextPage, history.length]);

  // screen-reader progress
  const pages = feed.data?.pages.length ?? 0;
  useEffect(() => {
    if (!pages || !feed.data) return;
    const last = feed.data.pages[pages - 1];
    setLive(last.next_cursor ? `Loaded ${last.items.length} more events` : "End of history");
  }, [pages, feed.data]);

  const scrollTop = () => { if (bodyRef.current) bodyRef.current.scrollTop = 0; };
  const applyFilters = (f: TimelineFilters) => { setFilters(f); scrollTop(); };
  const jumpTo = (at: string | null) => {
    setFilters(f => ({ ...f, at: at && at < today ? at : null }));
    setPop(null); setSheet(null); scrollTop();
  };
  const openPop = (k: PopKind) => {
    if (isMobile) { sheetOpener.current = panelRef.current?.querySelector<HTMLElement>(`[data-tl-pop="${k}"]`) ?? null; setSheet(k); }
    else setPop(p => (p === k ? null : k));
  };
  const onMarkSeen = async (e: TimelineEvent) => {
    if (!demo && !(await markAlertSeen(e.source_id))) return;
    setSeen(s => new Set(s).add(e.id));
    setDetail(d => (d && d.id === e.id ? { ...d, status: "seen" } : d));
    if (!demo) qc.invalidateQueries({ queryKey: ["timeline"] });
  };

  const count = activeFilterCount(filters);
  const oldest = oldestQ.data ?? null;
  const lastLoaded = history.length ? history[history.length - 1].occurred_on : null;
  const showEnd = wantHistory && !firstLoad && !hasNextPage && !isFetching && !feed.isError;

  // ── shared popover / sheet bodies ──
  const chipsWrap = (
    <div className="tl-chips-wrap" role="group" aria-label="Event types">
      <ChipButtons filters={filters} onChange={applyFilters} />
    </div>
  );
  const filtersBody = (
    <div data-testid="tl-filters">
      <div className="tl-lbl !mt-0">Show</div>
      {chipsWrap}
      <div className="tl-lbl">Hidden by default</div>
      <button type="button" className="tl-switch" role="switch" aria-checked={filters.includeInternal} data-testid="tl-transfers"
        onClick={() => applyFilters({ ...filters, includeInternal: !filters.includeInternal })}>
        <span className="grid place-items-center h-9 w-9 rounded-full k-transfer shrink-0"><ArrowLeftRight className="h-4 w-4" aria-hidden /></span>
        <span>
          <span className="block text-[14px] font-medium">Show internal transfers</span>
          <span className="block text-[12.5px] text-muted-foreground">Money moved between your own accounts</span>
        </span>
        <span className="tr" aria-hidden />
      </button>
      <div className="flex gap-2 mt-4">
        <button type="button" className="tl-btn flex-1" onClick={() => applyFilters({ ...DEFAULT_FILTERS, at: filters.at })}>Reset</button>
        <button type="button" className="tl-btn-gold flex-1" onClick={() => { setPop(null); setSheet(null); }}>Done</button>
      </div>
    </div>
  );
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const jan1 = `${today.slice(0, 4)}-01-01`;
  const jumpBody = (
    <JumpBody today={today} at={filters.at} oldest={oldest} lastMonthEnd={lastMonthEnd} jan1={jan1} onJump={jumpTo} />
  );

  return (
    <>
      <section
        ref={panelRef}
        id="tl-panel"
        className={cn("tl-panel", open && "on")}
        role="dialog"
        aria-modal={isMobile}
        aria-labelledby="tl-title"
        aria-hidden={!open}
        data-testid="tl-panel"
        style={isMobile ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
      >
        <div className="tl-head">
          {isMobile && (
            <button type="button" className="tl-ib" data-tl-close="" aria-label="Back" onClick={close} data-testid="tl-back">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h2 id="tl-title"><History className="h-5 w-5 text-primary hidden md:block" aria-hidden />Timeline</h2>
          {demo && <span className="chip chip-gold !text-[11px] !py-0.5" data-testid="tl-demo-tag">Demo</span>}
          <button type="button" className="tl-ib" data-tl-pop="jump" aria-label="Jump to date" aria-expanded={pop === "jump" || sheet === "jump"} onClick={() => openPop("jump")}>
            <CalendarSearch className="h-[18px] w-[18px]" />
          </button>
          <button type="button" className="tl-ib" data-tl-pop="filters" aria-label="Filters" aria-expanded={pop === "filters" || sheet === "filters"} onClick={() => openPop("filters")}>
            <SlidersHorizontal className="h-[18px] w-[18px]" />
            {count > 0 && <span className="tl-badge" data-testid="tl-badge">{count}</span>}
          </button>
          {!isMobile && (
            <button type="button" className="tl-ib" data-tl-close="" aria-label="Close timeline" onClick={close} data-testid="tl-close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="tl-chips" role="group" aria-label="Show">
          <ChipButtons filters={filters} onChange={applyFilters} />
        </div>

        {filters.at && (
          <div className="tl-jumped" data-testid="tl-jumped">
            <CalendarSearch className="h-4 w-4 text-info shrink-0" aria-hidden />
            <span>Showing from <b>{dlong(filters.at)}</b> back</span>
            <button type="button" className="tl-btn !min-h-[40px] max-md:!min-h-[44px]" onClick={() => jumpTo(null)}>
              <ArrowUp className="h-4 w-4" aria-hidden />Back to today
            </button>
          </div>
        )}

        <div className="tl-body" ref={bodyRef} aria-busy={isFetching} data-testid="tl-body">
          {realtime.count > 0 && (
            <button type="button" className="tl-new" onClick={() => { realtime.reset(); scrollTop(); }}>
              <ArrowUp className="h-4 w-4" aria-hidden />{realtime.count} new event{realtime.count === 1 ? "" : "s"} · Jump to top
            </button>
          )}
          {firstLoad && <Skeletons n={6} />}
          {!firstLoad && wantHistory && feed.isError && !history.length ? (
            <ErrorCard onRetry={() => feed.refetch()} />
          ) : (
            <RowList
              rows={rows}
              upMore={upMore}
              upAll={upAll}
              onUpAll={() => setUpAll(true)}
              onOpen={(e, el) => { detailOpener.current = el; setDetail(e); }}
              sub={e => subtitleOf(e, accountsQ.data)}
            />
          )}
          {wantHistory && isFetchingNextPage && <Skeletons n={3} />}
          {wantHistory && feed.isFetchNextPageError && <ErrorCard onRetry={() => fetchNextPage()} more />}
          {showEnd && history.length > 0 && (
            <div className="tl-end" data-testid="tl-end">
              <div className="ic"><Flag className="h-5 w-5" aria-hidden /></div>
              <b className="text-foreground text-[14px]">You've reached the beginning</b>
              <p className="mt-1">That's everything since {dlong(lastLoaded!)}{filters.chips.length || filters.at ? " for this view" : ", the oldest history we have for your linked accounts"}.</p>
            </div>
          )}
          {showEnd && history.length === 0 && (
            <div className="tl-empty" data-testid="tl-empty">
              <SearchX className="h-6 w-6 mx-auto mb-2" aria-hidden />
              {filters.at ? `Nothing on or before ${dlong(filters.at)}.` : "No events match these filters."}
              <div className="mt-3">
                <button type="button" className="tl-btn" onClick={() => applyFilters(DEFAULT_FILTERS)}>Clear filters</button>
              </div>
            </div>
          )}
          <div ref={sentinelRef} style={{ height: 1 }} data-testid="tl-sentinel" />
        </div>
        <div className="sr-only" aria-live="polite">{live}</div>

        {pop && !isMobile && (
          <div className="tl-pop" role="dialog" aria-labelledby="tl-pop-t" data-testid={`tl-pop-${pop}`}>
            <h3 id="tl-pop-t">
              {pop === "filters" ? "Filters" : "Jump to date"}
              <button type="button" className="tl-ib" aria-label={`Close ${pop === "filters" ? "filters" : "jump to date"}`}
                onClick={() => { const k = pop; setPop(null); panelRef.current?.querySelector<HTMLElement>(`[data-tl-pop="${k}"]`)?.focus(); }}>
                <X className="h-4 w-4" />
              </button>
            </h3>
            {pop === "filters" ? filtersBody : jumpBody}
          </div>
        )}
      </section>

      {/* mobile: Filters / Jump bottom sheets */}
      {isMobile && (
        <TimelineSheet open={!!sheet && open} onClose={() => setSheet(null)} title={sheet === "jump" ? "Jump to date" : "Filters"} testId={`tl-sheet-${sheet ?? "none"}`} returnFocus={sheetOpener}>
          {sheet === "jump" ? jumpBody : filtersBody}
        </TimelineSheet>
      )}

      {/* detail: dialog on desktop, bottom sheet on mobile */}
      {isMobile ? (
        <TimelineSheet open={!!detail && open} onClose={() => setDetail(null)} title={detail?.title ?? ""} testId="tl-detail-sheet" returnFocus={detailOpener}>
          {detail && <TimelineDetail e={detail} accounts={accountsQ.data} history={history} today={today} onMarkSeen={onMarkSeen} />}
        </TimelineSheet>
      ) : (
        <TimelineDialog open={!!detail && open} onClose={() => setDetail(null)} title={detail?.title ?? ""} testId="tl-detail-dialog" returnFocus={detailOpener}>
          {detail && <TimelineDetail e={detail} accounts={accountsQ.data} history={history} today={today} onMarkSeen={onMarkSeen} />}
        </TimelineDialog>
      )}
    </>
  );
}

function ChipButtons({ filters, onChange }: { filters: TimelineFilters; onChange: (f: TimelineFilters) => void }) {
  return (
    <>
      <button type="button" className="tl-chip" aria-pressed={filters.chips.length === 0} data-tl-chip="all"
        onClick={() => onChange({ ...filters, chips: toggleChip(filters.chips, "all") })}>All</button>
      {TIMELINE_CHIPS.map(c => {
        const Icon = CHIP_ICON[c];
        return (
          <button key={c} type="button" className="tl-chip" aria-pressed={filters.chips.includes(c)} data-tl-chip={c}
            onClick={() => onChange({ ...filters, chips: toggleChip(filters.chips, c) })}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{CHIP_LABEL[c]}
          </button>
        );
      })}
    </>
  );
}

function JumpBody({ today, at, oldest, lastMonthEnd, jan1, onJump }: {
  today: string; at: string | null; oldest: string | null; lastMonthEnd: string; jan1: string; onJump: (d: string | null) => void;
}) {
  const [val, setVal] = useState(at ?? jan1);
  const submit = (e: FormEvent) => { e.preventDefault(); if (val) onJump(val); };
  return (
    <div data-testid="tl-jump">
      <div className="tl-lbl !mt-0">Quick jumps</div>
      <div className="tl-chips-wrap">
        <button type="button" className="tl-chip" onClick={() => onJump(null)}><MapPin className="h-3.5 w-3.5" aria-hidden />Today</button>
        <button type="button" className="tl-chip" onClick={() => onJump(lastMonthEnd)}><Calendar className="h-3.5 w-3.5" aria-hidden />Last month</button>
        <button type="button" className="tl-chip" onClick={() => onJump(jan1)}><Calendar className="h-3.5 w-3.5" aria-hidden />Jan 1</button>
        {oldest && <button type="button" className="tl-chip" onClick={() => onJump(oldest)}><Flag className="h-3.5 w-3.5" aria-hidden />Start of history</button>}
      </div>
      <div className="tl-lbl">Or pick a date</div>
      <form className="flex gap-2" onSubmit={submit}>
        <label className="sr-only" htmlFor="tl-date">Date</label>
        <input id="tl-date" type="date" className="tl-date" min={oldest ?? undefined} max={today} value={val} onChange={e => setVal(e.target.value)} />
        <button type="submit" className="tl-btn-gold !min-h-[44px] px-5">Go</button>
      </form>
      {oldest && <p className="text-[12.5px] text-muted-foreground mt-3">History goes back to {dlong(oldest)}.</p>}
    </div>
  );
}

function ErrorCard({ onRetry, more }: { onRetry: () => void; more?: boolean }) {
  return (
    <div className="tl-err" role="alert" data-testid="tl-error">
      <div className="font-semibold">{more ? "Couldn't load more events" : "Couldn't load your timeline"}</div>
      <p className="tl-note mt-0.5">Check your connection and try again.</p>
      <button type="button" className="tl-btn mt-2" onClick={onRetry}><RotateCw className="h-4 w-4" aria-hidden />Retry</button>
    </div>
  );
}

/** Group flat rows into upcoming / months / days for sticky headers + the rail. */
function RowList({ rows, upMore, upAll, onUpAll, onOpen, sub }: {
  rows: TimelineRow[]; upMore: boolean; upAll: boolean; onUpAll: () => void; onOpen: (e: TimelineEvent, el: HTMLElement) => void;
  sub: (e: TimelineEvent) => string | null;
}) {
  const out: JSX.Element[] = [];
  let i = 0;
  const takeEvents = (ghost: boolean) => {
    const evs: TimelineEvent[] = [];
    while (i < rows.length && rows[i].kind === "event" && (rows[i] as Extract<TimelineRow, { kind: "event" }>).ghost === ghost) {
      evs.push((rows[i] as Extract<TimelineRow, { kind: "event" }>).event); i++;
    }
    return evs;
  };
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === "upcoming-header") {
      i++;
      out.push(
        <div key="up-h" className="tl-up-h" data-testid="tl-upcoming-h">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />Upcoming · next {upAll ? "5 weeks" : "14 days"}
          <span className="ml-auto normal-case tracking-normal font-medium">Projected</span>
        </div>,
      );
      if (upMore) out.push(
        <div key="up-more" className="pl-10 mb-2">
          <button type="button" className="tl-btn w-full" onClick={onUpAll}><ChevronsUp className="h-4 w-4" aria-hidden />Show further ahead</button>
        </div>,
      );
      if (rows[i]?.kind === "upcoming-empty") {
        i++;
        out.push(<p key="up-empty" className="pl-10 text-[13px] text-muted-foreground">Nothing upcoming for this filter.</p>);
      }
      const evs = takeEvents(true);
      if (evs.length) out.push(
        <ul key="up-list" className="tl-items" aria-label="Upcoming" data-testid="tl-upcoming">
          {evs.map(e => <EventCard key={e.id} e={e} ghost onOpen={onOpen} subtitle={sub(e)} />)}
        </ul>,
      );
    } else if (r.kind === "today") {
      i++;
      out.push(
        <div key="today" className="tl-today" id="tl-today" data-testid="tl-today">
          <span className="pin"><MapPin className="h-4 w-4" aria-hidden /></span>
          <b>Today · {dfmt(r.date)}</b><span className="ln" />
        </div>,
      );
    } else if (r.kind === "month") {
      i++;
      const days: JSX.Element[] = [];
      while (i < rows.length && rows[i].kind === "day") {
        const d = rows[i] as Extract<TimelineRow, { kind: "day" }>;
        i++;
        const evs = takeEvents(false);
        days.push(
          <div key={d.key} className="tl-day">
            <h4 className="tl-dh"><DayLabel date={d.date} /></h4>
            <ul className="tl-items">{evs.map(e => <EventCard key={e.id} e={e} onOpen={onOpen} subtitle={sub(e)} />)}</ul>
          </div>,
        );
      }
      out.push(
        <section key={r.key} className="tl-month" aria-label={monthLabel(r.month)}>
          <div className="tl-mh">{monthLabel(r.month)}</div>
          {days}
        </section>,
      );
    } else {
      i++; // stray row (shouldn't happen)
    }
  }
  return <div id="tl-list">{out.map((x, k) => <Fragment key={k}>{x}</Fragment>)}</div>;
}

function DayLabel({ date }: { date: string }) {
  const today = todayLocal();
  if (date === today) return <><b>Today</b> · {dfmt(date)}</>;
  if (date === addDays(today, -1)) return <><b>Yesterday</b> · {dfmt(date)}</>;
  return <>{dfmt(date)}</>;
}
