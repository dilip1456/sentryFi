import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeftRight, Banknote, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock, CreditCard,
  ArrowDownLeft, ArrowUpRight, History, Hourglass, Info, Landmark, PiggyBank, Receipt, Settings2, ShieldAlert, Wallet, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  buildRundown, previewEdit, spendableAccounts, normalizeRundownSettings, findGroup,
  type PlannedItem, type RundownEntry, type RundownFlag, type RundownInput, type RundownResult, type RundownRow, type RundownSettings, type RundownAccount,
} from "@/lib/timeline/rundown";
import { addDays } from "@/lib/recurring/dates";
import { saveOccurrence, useRundownSettings, useTimelineRundown } from "@/hooks/useTimelineRundown";
import { TimelineDialog, TimelineSheet } from "./TimelineOverlays";
import { Skeletons } from "./timeline-ui";
import { dfmt, fmtAmount, usd } from "./format";
import "./rundown.css";

type Cat = "income" | "bills" | "cards" | "savings" | "taxes" | "transfer";
const catOf = (k: string): Cat =>
  k === "income" ? "income" : k === "card" || k === "loan" ? "cards" : k === "savings" ? "savings" : k === "transfer" ? "transfer" : k === "tax" ? "taxes" : "bills";
const CAT_ICON: Record<Cat, typeof Receipt> = { income: Banknote, bills: Receipt, cards: CreditCard, savings: PiggyBank, taxes: Landmark, transfer: ArrowLeftRight };
const whole = (n: number) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
/** Balances are shown to the dollar (the design); item amounts keep cents. */
const money = (n: number) => (Math.round(n) < 0 ? "−" : "") + whole(n);
const short = (d: string) => dfmt(d).replace(/^\w+, /, "");
const KIND_LABEL: Record<string, string> = {
  income: "Income", bill: "Bill", utility: "Utility", insurance: "Insurance", tax: "Tax", loan: "Loan payment",
  card: "Card payment", savings: "Savings transfer", transfer: "Transfer", subscription: "Subscription",
};

type Patch = { status?: PlannedItem["status"]; override?: { date?: string; amount?: number } | null };

function acctLabel(a: RundownAccount | undefined) {
  if (!a) return "Unknown account";
  return `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`;
}

function stateBadge(r: RundownRow) {
  const inc = r.amount > 0;
  switch (r.state) {
    case "paid": return <span className="st st-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Paid</span>;
    case "received": return <span className="st st-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Received</span>;
    case "pending": return <span className="st st-mut"><Clock className="h-3.5 w-3.5" aria-hidden />Pending</span>;
    case "late": return <span className="st st-amb"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{inc ? "Not received" : "Late"}</span>;
    case "missed": return <span className="st st-amb"><XCircle className="h-3.5 w-3.5" aria-hidden />{inc ? "Not received" : "Missed"}</span>;
    case "skipped": return <span className="st st-mut"><XCircle className="h-3.5 w-3.5" aria-hidden />Skipped</span>;
    default: return <span className="st st-mut"><CalendarClock className="h-3.5 w-3.5" aria-hidden />Expected</span>;
  }
}

function whyLine(r: RundownRow, accounts: Map<string, RundownAccount>) {
  if (r.risk) return <span className="rd-why fl-amber"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /><span><b>At risk</b> {accounts.get(r.risk.accountId)?.name ?? "This account"} will be {whole(r.risk.short)} short on {short(r.day)}</span></span>;
  if ((r.state === "late" || r.state === "missed") && r.amount > 0)
    return <span className="rd-why fl-amber"><Hourglass className="h-3.5 w-3.5" aria-hidden /><span><b>Income late</b> not in the balance until it arrives</span></span>;
  if (r.state === "late" || r.state === "missed")
    return <span className="rd-why fl-amber"><Clock className="h-3.5 w-3.5" aria-hidden /><span><b>{r.state === "late" ? "Late" : "Missed"}</b> not seen since {short(r.date)}; counted as leaving today</span></span>;
  return null;
}

function RowCard({ r, accounts, onOpen, nested }: { r: RundownRow; accounts: Map<string, RundownAccount>; onOpen: (r: RundownRow, el: HTMLElement) => void; nested?: boolean }) {
  const cat = catOf(String(r.item.kind));
  const Icon = CAT_ICON[cat];
  const acct = accounts.get(r.item.accountId ?? "");
  return (
    <li>
      <button type="button" data-rd-row={r.item.id} onClick={e => onOpen(r, e.currentTarget)}
        className={cn("tl-ev rd-ev", r.risk && "risk", (r.state === "late" || r.state === "missed") && "late", r.state === "skipped" && "skipped")}
        aria-label={`${r.item.title}, ${fmtAmount(r.amount)}, ${dfmt(r.date)}`}>
        {!nested && <span className={cn("dot", `k-${cat}`)} aria-hidden><Icon className="h-4 w-4" /></span>}
        <span className="t">{r.item.title}</span>
        <span className={cn("a", r.amount > 0 && "text-positive")}>{r.item.estimated && <span className="tl-est">est.</span>}{fmtAmount(r.amount)}</span>
        <span className="s">{acct?.name ?? "—"}{r.item.toAccountId && accounts.get(r.item.toAccountId) ? ` → ${accounts.get(r.item.toAccountId)!.name}` : ""} · {r.item.source === "confirmed" ? "Confirmed" : "Detected"}{r.state === "late" || r.state === "missed" ? ` · due ${short(r.date)}` : ""}</span>
        {stateBadge(r)}
        {whyLine(r, accounts)}
      </button>
    </li>
  );
}

function GroupCard({ g, open, onToggle, accounts, onOpen }: { g: Extract<RundownEntry, { kind: "group" }>; open: boolean; onToggle: (el: HTMLElement) => void; accounts: Map<string, RundownAccount>; onOpen: (r: RundownRow, el: HTMLElement) => void }) {
  const names = g.rows.map(r => r.item.title).join(", ");
  return (
    <li>
      <button type="button" className="rd-group" aria-expanded={open} data-rd-group={g.key} onClick={e => onToggle(e.currentTarget)}>
        <span className="dot k-bills" aria-hidden><Receipt className="h-4 w-4" /></span>
        <span className="t">{g.rows.length} small {g.rows.every(r => r.item.kind === "subscription") ? "subscriptions" : "items"}</span>
        <span className="a">{fmtAmount(g.total)}</span>
        <span className="s truncate">{names}</span>
        <span className="chev">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
      </button>
      {open && <ul className="rd-grpl">{g.rows.map(r => <RowCard key={r.item.id} r={r} accounts={accounts} onOpen={onOpen} nested />)}</ul>}
    </li>
  );
}

function Chart({ r }: { r: RundownResult }) {
  const actual = r.recent.map(d => d.actualEod);
  const series = [...actual, r.start, ...r.eod];
  const W = 320, H = 110, pad = 6;
  const max = Math.max(...series, r.buffer, 0) * 1.08 + 1, min = Math.min(...series, 0) - Math.max(40, Math.abs(Math.min(...series, 0)) * 0.1);
  const x = (i: number) => pad + (i / Math.max(1, series.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad - 12);
  const ti = actual.length; // today index (start balance)
  const path = (from: number, to: number) => series.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const lowIdx = ti + 1 + r.eod.indexOf(r.low);
  const lowCls = r.low < 0 ? "lo-red" : r.low < r.buffer ? "lo-amb" : "lo-ok";
  return (
    <svg className="rd-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Balance from ${money(r.start)} today to a low of ${money(r.low)} on ${dfmt(r.lowDate)}`}>
      {min < 0 && <rect className="danger" x={0} y={y(0)} width={W} height={H - 12 - y(0)} />}
      {r.buffer > 0 && <line className="buf" x1={0} x2={W} y1={y(r.buffer)} y2={y(r.buffer)} />}
      {min < 0 && <line className="zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      <line className="today" x1={x(ti)} x2={x(ti)} y1={pad} y2={H - 12} />
      {ti > 0 && <path className="act" d={path(0, ti)} />}
      <path className="proj" d={path(ti, series.length - 1)} />
      {r.eod.length > 0 && <circle className={lowCls} cx={x(lowIdx)} cy={y(r.low)} r={4.5} />}
      {ti > 1 && <text className="lbl" x={pad} y={H - 1}>{short(r.recent[0].date)}</text>}
      <text className="lbl" x={x(ti)} y={H - 1} textAnchor="middle">Today</text>
      {r.buffer > 0 && <text className="lbl" x={W - pad} y={y(r.buffer) - 3} textAnchor="end">Buffer {whole(r.buffer)}</text>}
      <text className="lbl" x={W - pad} y={H - 1} textAnchor="end">{short(addDays(r.today, r.days - 1))}</text>
    </svg>
  );
}

function flagText(f: RundownFlag, accounts: Map<string, RundownAccount>): { cls: string; head: string; body: string; target: string; Icon: typeof Clock } {
  switch (f.type) {
    case "short": return { cls: "fl-red", Icon: AlertTriangle, head: "Shortfall", body: `from ${short(f.date)} · low ${money(f.low)}${f.atRiskCount ? ` · ${f.atRiskCount} payment${f.atRiskCount === 1 ? "" : "s"} at risk` : ""}`, target: `day:${f.date}` };
    case "buffer": return { cls: "fl-amber", Icon: Info, head: "Below buffer", body: `from ${short(f.date)} · low ${money(f.low)}`, target: `day:${f.date}` };
    case "risk": return { cls: "fl-amber", Icon: ShieldAlert, head: "At risk", body: `${f.row.item.title.split(" · ")[0]} · ${accounts.get(f.accountId)?.name?.replace(/ Checking$/, "") ?? "Account"} ${whole(f.short)} short`, target: f.row.item.id };
    case "late": case "missed": return { cls: "fl-amber", Icon: Clock, head: f.type === "late" ? "Late" : "Missed", body: `${f.row.item.title} · due ${short(f.row.date)}`, target: f.row.item.id };
    default: return { cls: "fl-amber", Icon: Hourglass, head: f.type === "income_late" ? "Income late" : "Income missed", body: `${f.row.item.title.split(" · ")[0]} · ${whole(f.row.amount)}, ${f.row.daysLate} day${f.row.daysLate === 1 ? "" : "s"}`, target: f.row.item.id };
  }
}

export interface RundownViewProps { userId?: string | null; demo?: boolean; today: string; enabled?: boolean; onLayerChange?: (open: boolean) => void }

export function RundownView({ userId, demo = false, today, enabled = true, onLayerChange }: RundownViewProps) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const src = useTimelineRundown({ userId: userId ?? null, demo }, enabled);
  const { settings, save } = useRundownSettings({ userId: userId ?? null, demo });
  const [days, setDays] = useState<7 | 14>(14);
  const [view, setView] = useState("all");
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [recentOpen, setRecentOpen] = useState(false);
  const [detail, setDetail] = useState<RundownRow | null>(null);
  const [groupSheet, setGroupSheet] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentSheet, setRecentSheet] = useState(false);
  const returnRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const layerOpen = !!detail || !!groupSheet || settingsOpen || recentSheet;
  useEffect(() => { onLayerChange?.(layerOpen); }, [layerOpen, onLayerChange]);

  const input: RundownInput | null = useMemo(() => {
    if (!src.data) return null;
    const items = src.data.items.map(it => {
      const p = patches[it.id];
      return p ? { ...it, ...(p.status ? { status: p.status } : {}), ...(p.override !== undefined ? { override: p.override } : {}) } : it;
    });
    return { today, days, items, txns: src.data.txns, accounts: src.data.accounts, settings, view };
  }, [src.data, patches, today, days, settings, view]);
  const r = useMemo(() => (input ? buildRundown(input) : null), [input]);
  const accounts = useMemo(() => new Map((src.data?.accounts ?? []).map(a => [a.id, a] as const)), [src.data]);
  const spend = useMemo(() => spendableAccounts(src.data?.accounts ?? [], settings), [src.data, settings]);

  const openRow = useCallback((row: RundownRow, el: HTMLElement) => { returnRef.current = el; setDetail(row); }, []);
  const toggleGroup = useCallback((key: string, el: HTMLElement) => {
    if (mobile) { returnRef.current = el; setGroupSheet(key); return; }
    setOpenGroups(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, [mobile]);

  const jump = (target: string) => {
    const root = listRef.current; if (!root) return;
    let el: HTMLElement | null = null;
    if (target.startsWith("day:")) el = root.querySelector(`[data-rd-day="${target.slice(4)}"]`);
    else {
      el = root.querySelector(`[data-rd-row="${target}"]`);
      if (!el) { // inside a collapsed group: open it, then retry
        const g = r && [...r.daysOut].flatMap(d => d.entries).find(e => e.kind === "group" && e.rows.some(x => x.item.id === target));
        if (g && g.kind === "group") { setOpenGroups(s => new Set(s).add(g.key)); setTimeout(() => jump(target), 50); return; }
      }
    }
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("rd-hl"); setTimeout(() => el?.classList.remove("rd-hl"), 2400);
  };

  const apply = async (row: RundownRow, p: Patch) => {
    setPatches(s => ({ ...s, [row.item.id]: { ...s[row.item.id], ...p } }));
    if (!demo && userId && row.item.streamId) {
      const ok = await saveOccurrence(userId, {
        stream_id: row.item.streamId, period: row.item.period ?? row.item.date,
        status: p.status === "skipped" ? "skipped" : p.status === "paid" || p.status === "received" ? "paid" : "expected",
        expected_date: p.override?.date ?? row.item.override?.date ?? row.item.date,
        expected_amount: p.override?.amount != null ? Math.abs(p.override.amount) : row.item.override?.amount != null ? Math.abs(row.item.override.amount) : null,
      });
      if (ok) qc.invalidateQueries({ queryKey: ["timeline-rundown"] });
    }
  };

  if (src.isPending || !r || !input) return <div className="tl-body rd-body" data-testid="rd-loading"><Skeletons n={5} /></div>;
  if (src.isError) return <div className="tl-body rd-body"><p className="text-sm text-muted-foreground">Couldn't load your rundown. Pull to refresh or try again later.</p></div>;

  const status = r.low < 0 ? { cls: "fl-red", label: "Shortfall" } : r.low < r.buffer ? { cls: "fl-amber", label: "Below buffer" } : { cls: "fl-green", label: "All clear" };
  const shortFlag = r.flags.find(f => f.type === "short" || f.type === "buffer") as Extract<RundownFlag, { id: "short" }> | undefined;
  const live = demo ? null : (detail && !detail.item.streamId);
  const viewOptions = spend.candidates.filter(a => spend.on.has(a.id));
  const group = groupSheet ? findGroup(r, groupSheet) : null;
  const Wrap = mobile ? TimelineSheet : TimelineDialog;
  const recentDone = r.recent.flatMap(d => d.entries.flatMap(e => (e.kind === "row" ? [e.row] : e.rows))).filter(x => x.state === "paid" || x.state === "received").length;
  const lateCount = r.rows.filter(x => x.state === "late" || x.state === "missed").length;

  const renderEntries = (entries: RundownEntry[]) => entries.map(e => e.kind === "row"
    ? <RowCard key={e.row.item.id} r={e.row} accounts={accounts} onOpen={openRow} />
    : <GroupCard key={e.key} g={e} open={openGroups.has(e.key)} onToggle={el => toggleGroup(e.key, el)} accounts={accounts} onOpen={openRow} />);

  const recentList = (
    <div className="rd-past">
      {r.recent.map(d => (
        <section key={d.date}>
          <h3 className="tl-dh rd-dh">{dfmt(d.date)}<span className="rd-eod rd-act">{money(d.actualEod)}</span></h3>
          {d.entries.length ? <ul className="tl-items">{renderEntries(d.entries)}</ul> : <p className="rd-none">No planned items</p>}
        </section>
      ))}
    </div>
  );

  return (
    <div className="rd-root flex flex-col min-h-0 flex-1" data-testid="rundown">
      <div className="rd-ctl">
        <label className="rd-sel"><Wallet className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">Accounts</span>
          <select value={view} onChange={e => setView(e.target.value)} data-testid="rd-account">
            <option value="all">All spendable</option>
            {viewOptions.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </select>
          <ChevronDown className="h-4 w-4 shrink-0 pointer-events-none" aria-hidden />
        </label>
        <div className="rd-seg" role="group" aria-label="Days ahead">
          {([7, 14] as const).map(n => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}
        </div>
        <button type="button" className="tl-ib" aria-label="Rundown settings" data-testid="rd-settings" onClick={e => { returnRef.current = e.currentTarget; setSettingsOpen(true); }}><Settings2 className="h-5 w-5" /></button>
      </div>

      <div className="tl-body rd-body" ref={listRef}>
        <section className={cn("rd-sum", status.cls)} aria-label="Rundown summary">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="rd-k">Lowest projected balance</div>
              <div className="rd-low" data-testid="rd-low">{money(r.low)}</div>
              <div className="text-[12.5px] text-muted-foreground">on {dfmt(r.lowDate)} · next {r.days} days</div>
            </div>
            <span className={cn("rd-pill", status.cls)}>{r.low < 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : r.low < r.buffer ? <Info className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{status.label}</span>
          </div>
          {r.flags.length ? (
            <div className="rd-flags" data-testid="rd-flags">
              <div className="rd-k mt-2">{r.flags.length} at risk · tap to jump</div>
              {r.flags.map(f => { const t = flagText(f, accounts); return (
                <button key={f.id + f.type} type="button" className={cn("rd-flag", t.cls)} onClick={() => jump(t.target)}>
                  <t.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <b>{t.head}</b><span>{t.body}</span>
                </button>); })}
            </div>
          ) : (
            <div className="rd-clear"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>Your planned bills are covered for the next {r.days} days, with at least {usd(r.buffer)} to spare.</span></div>
          )}
          <div className="rd-io">
            <span><ArrowDownLeft className="h-3.5 w-3.5 text-positive" />Income expected<b>{fmtAmount(Math.abs(r.incomeExpected))}</b></span>
            <span><ArrowUpRight className="h-3.5 w-3.5" />Bills due<b>{fmtAmount(-Math.abs(r.billsDue))}</b></span>
          </div>
          <Chart r={r} />
          <div className="rd-legend"><span><i className="ln" />Actual</span><span><i className="ln proj" />Projected</span>{r.buffer > 0 && <span><i className="ln buf" />Buffer</span>}</div>
          <p className="rd-cap"><Info className="h-3.5 w-3.5" />Planned recurring items only. Everyday spending isn't included{r.reserve ? ` (reserving ${usd(r.reserve)}/day)` : ""}.</p>
        </section>

        {r.recent.length > 0 && (
          <div className="rd-recent">
            <button type="button" className="rd-rbtn" aria-expanded={!mobile && recentOpen} data-testid="rd-recent"
              onClick={e => { if (mobile) { returnRef.current = e.currentTarget; setRecentSheet(true); } else setRecentOpen(o => !o); }}>
              <History className="h-4 w-4" /><span><b>Recent</b> · {short(r.recent[0].date)} – {short(r.recent[r.recent.length - 1].date)} · {recentDone} done{lateCount ? <>, <span className="text-warn">{lateCount} late</span></> : null}</span>
              {recentOpen && !mobile ? <ChevronDown className="h-4 w-4 ml-auto" /> : <ChevronRight className="h-4 w-4 ml-auto" />}
            </button>
            {recentOpen && !mobile && recentList}
          </div>
        )}

        {r.daysOut.map((d, i) => {
          const isShort = shortFlag && shortFlag.date === d.date;
          const eodCls = d.eod < 0 ? "fl-red" : d.eod < r.buffer ? "fl-amber" : "";
          return (
            <section key={d.date} data-rd-day={d.date} className="rounded-xl">
              <h3 className="tl-dh rd-dh">{i === 0 ? <>Today<span className="font-normal"> · {dfmt(d.date)}</span></> : i === 1 ? <>Tomorrow<span className="font-normal"> · {dfmt(d.date)}</span></> : dfmt(d.date)}
                <span className={cn("rd-eod", eodCls)} aria-label={`End of day ${money(d.eod)}`}>{d.eod < 0 ? "Short " : d.eod < r.buffer ? "Low " : ""}{money(d.eod)}</span>
              </h3>
              {isShort && shortFlag && (
                <div className={cn("rd-banner", shortFlag.type === "short" ? "fl-red" : "fl-amber")} role="note">
                  <AlertTriangle className="h-4 w-4" />
                  <span><b>{shortFlag.type === "short" ? `${whole(shortFlag.amountShort)} short` : "Below your buffer"}</b>
                    Balance reaches {money(shortFlag.low)} on {dfmt(shortFlag.lowDate)}.
                    {shortFlag.ifIncome ? ` If the late ${usd(shortFlag.ifIncome.amount)} arrives, the low is ${money(shortFlag.ifIncome.low)}.` : ""}</span>
                </div>
              )}
              {d.entries.length ? <ul className="tl-items">{renderEntries(d.entries)}</ul> : <p className="rd-none">Nothing planned</p>}
            </section>
          );
        })}
        <div className="rd-endw">End of the {r.days}-day rundown{days === 7 && <> · <button type="button" className="min-h-[44px]" onClick={() => setDays(14)}>Show 14 days</button></>}</div>
      </div>

      {detail && (
        <Wrap open onClose={() => setDetail(null)} title={detail.item.title} testId="rd-detail" returnFocus={returnRef}>
          <RowDetail key={detail.item.id} row={r.rows.find(x => x.item.id === detail.item.id) ?? detail} input={input} accounts={accounts} demo={demo}
            canSave={demo || !!detail.item.streamId} liveNote={!!live}
            onApply={async p => { await apply(detail, p); setDetail(null); }} />
        </Wrap>
      )}
      {group && (
        <TimelineSheet open onClose={() => setGroupSheet(null)} title={`${group.rows.length} small items · ${fmtAmount(group.total)}`} testId="rd-group-sheet" returnFocus={returnRef}>
          <ul className="tl-items">{group.rows.map(x => <RowCard key={x.item.id} r={x} accounts={accounts} onOpen={(row, el) => { setGroupSheet(null); openRow(row, el); }} nested />)}</ul>
        </TimelineSheet>
      )}
      {recentSheet && (
        <TimelineSheet open onClose={() => setRecentSheet(false)} title={`Last ${r.recent.length} days`} testId="rd-recent-sheet" returnFocus={returnRef}>{recentList}</TimelineSheet>
      )}
      {settingsOpen && (
        <Wrap open onClose={() => setSettingsOpen(false)} title="Rundown settings" testId="rd-settings-dlg" returnFocus={returnRef}>
          <RundownSettingsForm settings={settings} accounts={src.data?.accounts ?? []} onSave={async s => { await save(s); setSettingsOpen(false); }} />
        </Wrap>
      )}
    </div>
  );
}

function RowDetail({ row, input, accounts, onApply, canSave, liveNote }: { row: RundownRow; input: RundownInput; accounts: Map<string, RundownAccount>; demo: boolean; canSave: boolean; liveNote: boolean; onApply: (p: Patch) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(row.date);
  const [amt, setAmt] = useState(String(Math.abs(row.amount)));
  const inc = row.amount > 0;
  const n = Number(amt);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(n) && n > 0;
  const override = { date, amount: inc ? n : -n };
  const prev = useMemo(() => (editing && valid ? previewEdit(input, row.item.id, override) : null), [editing, valid, date, amt]); // eslint-disable-line react-hooks/exhaustive-deps
  const acct = accounts.get(row.item.accountId ?? "");
  const done = row.state === "paid" || row.state === "received";
  return (
    <div className="flex flex-col gap-3">
      <div className="tl-big">{row.item.estimated && <span className="tl-est">est.</span>}{fmtAmount(row.amount)}</div>
      {row.risk && <div className="rd-banner fl-amber !m-0"><ShieldAlert className="h-4 w-4" /><span><b>At risk.</b>{acctLabel(accounts.get(row.risk.accountId))} has {money(row.risk.before)} before this; {usd(row.risk.short)} short.</span></div>}
      {(row.state === "late" || row.state === "missed") && <div className="rd-banner fl-amber !m-0"><AlertTriangle className="h-4 w-4" /><span><b>{inc ? "Not received." : row.state === "late" ? "Late." : "Missed."}</b>
        {inc ? `Expected ${dfmt(row.date)}. It isn't counted in your balance until it arrives.` : `Was due ${dfmt(row.date)}; no matching payment found within ±3 days. Still counted as going out today.`}</span></div>}
      <div className="tl-kv">
        <div>Expected</div><div>{dfmt(row.date)}{row.item.date !== row.date && !row.item.override?.date ? " (moved to a business day)" : ""}</div>
        <div>Status</div><div>{stateBadge(row)}</div>
        <div>Type</div><div>{KIND_LABEL[String(row.item.kind)] ?? "Planned"}</div>
        <div>Source</div><div>{row.item.source === "confirmed" ? "Confirmed recurring" : "Detected (high confidence)"}</div>
        <div>{inc ? "Lands in" : "Paid from"}</div><div>{acctLabel(acct)}</div>
        {row.risk ? <><div>Coverage</div><div className="text-warn">{usd(row.risk.short)} short</div></> : null}
        {row.item.repeats ? <><div>Repeats</div><div>{row.item.repeats}</div></> : null}
        <div>Balance impact</div><div>{row.counts ? `${fmtAmount(row.amount)} on ${dfmt(row.day)}` : "Not counted"}</div>
      </div>
      {liveNote && <p className="text-[12.5px] text-muted-foreground">Confirm this item in Financial Picture to mark it paid, skip it, or edit it here.</p>}
      {canSave && !editing && (
        <div className="flex flex-wrap gap-2">
          {!done && <button type="button" className="tl-btn-gold" onClick={() => onApply({ status: inc ? "received" : "paid" })}>{inc ? "Mark received" : "Mark paid"}</button>}
          {done || row.state === "skipped" ? <button type="button" className="tl-btn" onClick={() => onApply({ status: "expected" })}>Undo</button>
            : <button type="button" className="tl-btn" onClick={() => onApply({ status: "skipped" })}>Skip this time</button>}
          <button type="button" className="tl-btn" onClick={() => setEditing(true)}>Edit date or amount</button>
        </div>
      )}
      {editing && (
        <form className="rd-edit" onSubmit={e => { e.preventDefault(); if (valid) void onApply({ override }); }}>
          <div className="grid grid-cols-2 gap-2">
            <label className="rd-f">Date<input type="date" value={date} min={addDays(input.today, -10)} onChange={e => setDate(e.target.value)} /></label>
            <label className="rd-f">Amount<input inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          </div>
          {prev && <p className="rd-prev" aria-live="polite"><Info className="h-4 w-4 shrink-0 mt-0.5" /><span>Lowest balance becomes <b className={prev.low < 0 ? "fl-red-t" : prev.low < input.settings.buffer ? "fl-amber-t" : ""}>{money(prev.low)}</b> on {dfmt(prev.lowDate)}.</span></p>}
          <div className="flex gap-2 mt-3">
            <button type="submit" className="tl-btn-gold" disabled={!valid}>Save this time</button>
            <button type="button" className="tl-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function RundownSettingsForm({ settings, accounts, onSave }: { settings: RundownSettings; accounts: RundownAccount[]; onSave: (s: RundownSettings) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const [buf, setBuf] = useState(String(settings.buffer));
  const [daily, setDaily] = useState(String(settings.reserveDaily));
  const { candidates, on } = spendableAccounts(accounts, s);
  return (
    <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void onSave(normalizeRundownSettings({ ...s, buffer: Number(buf) || 0, reserveDaily: Number(daily) || 0 })); }}>
      <label className="rd-f">Warn me when my balance drops below
        <input inputMode="decimal" value={buf} onChange={e => setBuf(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="rd-buffer" />
      </label>
      <div>
        <label className="flex items-center justify-between gap-3 min-h-[44px]">
          <span className="text-sm"><span className="font-semibold">Reserve for everyday spending</span><br /><span className="text-muted-foreground text-[12.5px]">Subtract a daily amount for groceries, gas, etc.</span></span>
          <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={s.reserveOn} onChange={e => setS({ ...s, reserveOn: e.target.checked })} />
        </label>
        {s.reserveOn && <label className="rd-f mt-2">Per day<input inputMode="decimal" value={daily} onChange={e => setDaily(e.target.value.replace(/[^0-9.]/g, ""))} /></label>}
      </div>
      <fieldset>
        <legend className="text-sm font-semibold mb-1">Spendable accounts</legend>
        {candidates.length ? candidates.map(a => (
          <label key={a.id} className="rd-acct">
            <input type="checkbox" checked={on.has(a.id)} onChange={e => setS({ ...s, accounts: { ...s.accounts, [a.id]: e.target.checked } })} />
            <span className="flex-1 min-w-0 text-sm">{acctLabel(a)}<br /><span className="text-muted-foreground text-[12.5px]">{a.subtype ?? a.type} · {a.balance == null ? "—" : money(a.balance)}</span></span>
          </label>
        )) : <p className="text-sm text-muted-foreground">No checking or savings accounts linked.</p>}
      </fieldset>
      <button type="submit" className="tl-btn-gold self-start">Save</button>
    </form>
  );
}
