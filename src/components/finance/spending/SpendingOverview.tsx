/**
 * SpendingOverview: the top half of the Spending page for a selected month.
 * Hero (month-to-date total, vs. same point last month, month-end pace),
 * a daily/cumulative spending chart, a category donut with labelled budget and
 * month-over-month comparisons, top merchants with 6-month sparklines, and a
 * "worth a look" strip for possible duplicates / unpaired transfers.
 *
 * Purely presentational: every number is computed by SpendingBudgetView from
 * the same txns/budgets props it already receives, so it works identically
 * for live Plaid data and the demo dataset.
 */
import { useMemo, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Pie, PieChart, Cell,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Clock, Copy, ArrowLeftRight, Info, Pencil, Wallet, ChevronRight, Gauge, CreditCard, PiggyBank, Send, HandCoins, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { fmtShortDate, vivid, withAlpha, type TxnFlag } from "@/lib/spending-insights";

export interface OverviewCategory { cat: string; spend: number; prevSpend: number; budget: number | null; fixed: boolean }
export interface OverviewMerchant { name: string; cat: string; total: number; count: number; trend: number[] }
export interface OverviewFlagged { id: string; label: string; amount: number; date: string; flag: TxnFlag; account?: string }
// Shared classifier type names (src/lib/classify): everything that moves money but is neither spending nor income.
export type MovementKey = "credit_card_payment" | "savings_contribution" | "transfer_out" | "transfer_in" | "transfer_internal";
export type OverviewMovement = Record<MovementKey, { total: number; count: number }>;
export interface OverviewDay { day: number; amount: number; cum: number | null; prevCum: number | null; projected: number | null }

export interface SpendingOverviewProps {
  monthName: string;          // "October"
  prevMonthShort: string;     // "Sep"
  monthEndLabel: string;      // "Oct 31"
  isCurrentMonth: boolean;
  dayOfMonth: number;
  daysInMonth: number;
  spent: number;
  pendingSpent: number;
  pendingCount: number;
  earned: number;
  prevSameDay: number | null; // last month's spend through the same day
  prevTotal: number | null;
  budgetTotal: number;
  projected: number;
  days: OverviewDay[];
  categories: OverviewCategory[];
  merchants: OverviewMerchant[];
  flagged: OverviewFlagged[];
  movement: OverviewMovement;
  onShowIgnored: () => void;
  selectedCat: string | null;
  onSelectCat: (cat: string | null) => void;
  onCategoryDetails: (cat: string) => void;
  onManageBudgets: () => void;
  onOpenFlagged: (id: string) => void;
  catColor: (c: string) => string;
  categoryIcon: (c: string) => React.ElementType;
  formatCat: (c: string) => string;
}

const GOLD = "hsl(var(--primary))";

function Delta({ cur, prev, label, invert = false }: { cur: number; prev: number | null; label: string; invert?: boolean }) {
  if (prev == null || prev <= 0) return <span className="text-[12px] text-muted-foreground">No {label} data yet</span>;
  const diff = cur - prev;
  const pct = Math.round((diff / prev) * 100);
  const up = diff > 0;
  const good = invert ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular",
      good ? "bg-[hsl(var(--positive)/0.12)] text-positive" : "bg-[hsl(var(--negative)/0.12)] text-negative")}>
      <Icon className="h-3.5 w-3.5" />
      {fmtUSD(Math.abs(diff))} ({Math.abs(pct)}%) {up ? "more" : "less"} {label}
    </span>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 64, h = 22;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={w} cy={h - 2 - (last / max) * (h - 4)} r={2.2} fill={color} />
    </svg>
  );
}

function CardTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-foreground leading-tight">{title}</h2>
        {sub && <p className="text-[11.5px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function SpendingOverview(p: SpendingOverviewProps) {
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const pacePct = (p.dayOfMonth / p.daysInMonth) * 100;
  const spentPct = p.budgetTotal > 0 ? (p.spent / p.budgetTotal) * 100 : 0;
  const overPace = p.budgetTotal > 0 && p.projected > p.budgetTotal;
  const left = p.budgetTotal - p.spent;
  const daysLeft = Math.max(p.daysInMonth - p.dayOfMonth, 0);

  const { categories, formatCat, catColor } = p;
  const donut = useMemo(() => {
    const top = categories.slice(0, 6);
    const rest = categories.slice(6).reduce((s, c) => s + c.spend, 0);
    const rows = top.map(c => ({ key: c.cat, label: formatCat(c.cat), value: c.spend, color: vivid(catColor(c.cat)) }));
    if (rest > 0) rows.push({ key: "__other__", label: "Everything else", value: rest, color: "hsl(215 12% 40%)" });
    return rows;
  }, [categories, catColor, formatCat]);

  const focus = hoverCat ?? p.selectedCat;
  const focusRow = donut.find(d => d.key === focus);
  const catTotal = p.categories.reduce((s, c) => s + c.spend, 0);
  const maxMerchant = Math.max(...p.merchants.map(m => m.total), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="surface-elevated lg:col-span-5 p-5 md:p-6 flex flex-col bento-rise" aria-label="Month summary">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--primary))]">
          {p.isCurrentMonth ? `Spent so far in ${p.monthName}` : `Spent in ${p.monthName}`}
        </div>
        <div className="mt-1.5 text-[40px] md:text-[44px] leading-none font-semibold tracking-tight text-foreground tabular">
          {fmtUSD(p.spent)}
        </div>
        <div className="mt-3">
          <Delta cur={p.spent} prev={p.isCurrentMonth ? p.prevSameDay : p.prevTotal}
            label={p.isCurrentMonth ? `than ${p.prevMonthShort} 1–${p.dayOfMonth}` : `than ${p.prevMonthShort}`} />
        </div>

        <div className="mt-5 rounded-xl border border-border/60 bg-background/40 p-3.5">
          <div className="flex items-center gap-2 text-[13px]">
            <Gauge className={cn("h-4 w-4 shrink-0", overPace ? "text-negative" : "text-positive")} />
            {p.isCurrentMonth ? (
              <span className="text-foreground">
                On pace for <b className="tabular">{fmtUSD(Math.round(p.projected))}</b> by {p.monthEndLabel}
              </span>
            ) : (
              <span className="text-foreground">Month closed at <b className="tabular">{fmtUSD(p.spent)}</b></span>
            )}
          </div>
          {p.budgetTotal > 0 ? (
            <>
              <div className="relative mt-3 h-2.5 rounded-full bg-muted overflow-visible" role="img"
                aria-label={`${Math.round(spentPct)}% of monthly budget used, ${Math.round(pacePct)}% of month elapsed`}>
                <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-700",
                  spentPct > 100 ? "bg-negative" : overPace ? "bg-warning" : "bg-gold")}
                  style={{ width: `${Math.min(spentPct, 100)}%` }} />
                {p.isCurrentMonth && (
                  <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground/70" style={{ left: `${pacePct}%` }}
                    title={`Today: ${Math.round(pacePct)}% through the month`} />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground tabular">
                <span>{Math.round(spentPct)}% of {fmtUSD(p.budgetTotal)} monthly budget</span>
                <span className={cn(left < 0 && "text-negative font-semibold")}>
                  {left >= 0 ? `${fmtUSD(left)} left` : `${fmtUSD(-left)} over`}
                  {p.isCurrentMonth && left > 0 && daysLeft > 0 && ` · ${fmtUSD(Math.round(left / daysLeft))}/day`}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-2 text-[11.5px] text-muted-foreground">
              {p.prevTotal != null && <>Last month: <span className="tabular">{fmtUSD(p.prevTotal)}</span> · </>}
              <button onClick={p.onManageBudgets} className="text-[hsl(var(--primary))] font-medium hover:underline">Set a monthly budget</button>
            </div>
          )}
        </div>

        <div className="mt-auto pt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
          <span>Earned <b className="text-positive tabular font-semibold">{fmtUSD(p.earned)}</b></span>
          {p.pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1" title="Pending charges can still change amount or drop off before they post.">
              <Clock className="h-3 w-3 text-warning" /> Includes {fmtUSD(p.pendingSpent)} pending ({p.pendingCount})
            </span>
          ) : <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> All posted</span>}
          <span className="inline-flex items-center gap-1" title="Credit-card payments, savings & investing contributions, money sent to or received from people (Venmo, Zelle, Cash App, PayPal), and transfers between your own accounts are shown under Money movement. They're not counted as spending or income. Change a transaction's type to count it.">
            <Info className="h-3 w-3" /> Real spending only: no card payments, savings or transfers
          </span>
        </div>
      </section>

      {/* ── Daily / cumulative chart ─────────────────────────────────── */}
      <section className="surface-card lg:col-span-7 p-4 md:p-5 bento-rise" style={{ animationDelay: "60ms" }} aria-label="Daily spending">
        <CardTitle title="Daily spending" sub={`Bars: each day · Line: running total vs ${p.prevMonthShort}`}
          right={
            <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[hsl(var(--primary)/0.45)]" />Daily</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-gold" />{p.monthName.slice(0, 3)}</span>
              <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t border-dashed border-muted-foreground" />{p.prevMonthShort}</span>
              {p.budgetTotal > 0 && <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t border-dashed border-negative" />Budget</span>}
            </div>
          } />
        <div className="h-[220px] md:h-[250px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={p.days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spCum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} interval={0}
                tick={({ x, y, payload }) => (payload.value === 1 || payload.value % 5 === 0)
                  ? <text x={x} y={Number(y) + 10} textAnchor="middle" fontSize={10.5} fill="hsl(var(--muted-foreground))">{payload.value}</text>
                  : <g />} />
              <YAxis yAxisId="c" tickLine={false} axisLine={false} width={44} fontSize={10.5}
                tick={{ fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => fmtUSD(v, { compact: true })} />
              <YAxis yAxisId="d" hide domain={[0, (max: number) => max * 3.2]} />
              <Tooltip cursor={{ fill: "hsl(var(--foreground) / 0.04)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as OverviewDay;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-xl text-[12px] space-y-0.5">
                      <div className="font-semibold text-foreground">{p.monthName.slice(0, 3)} {d.day}</div>
                      <div className="text-muted-foreground">Spent that day <b className="text-foreground tabular">{fmtUSD(d.amount)}</b></div>
                      {d.cum != null && <div className="text-muted-foreground">Running total <b className="text-foreground tabular">{fmtUSD(d.cum)}</b></div>}
                      {d.cum == null && d.projected != null && <div className="text-muted-foreground">Projected <b className="text-foreground tabular">{fmtUSD(Math.round(d.projected))}</b></div>}
                      {d.prevCum != null && <div className="text-muted-foreground">{p.prevMonthShort} by then <span className="tabular">{fmtUSD(d.prevCum)}</span></div>}
                    </div>
                  );
                }} />
              {p.budgetTotal > 0 && <ReferenceLine yAxisId="c" y={p.budgetTotal} stroke="hsl(var(--negative))" strokeDasharray="4 4" strokeOpacity={0.7} />}
              <Bar yAxisId="d" dataKey="amount" fill="hsl(var(--primary) / 0.42)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              <Line yAxisId="c" dataKey="prevCum" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Area yAxisId="c" dataKey="cum" stroke={GOLD} strokeWidth={2.2} fill="url(#spCum)" dot={false} activeDot={{ r: 4, fill: GOLD, stroke: "hsl(var(--card))", strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="c" dataKey="projected" stroke={GOLD} strokeOpacity={0.6} strokeDasharray="2 4" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────────────── */}
      {/* Side by side only from xl: at lg (1024px, ~770px of content next to
          the sidebar) a 7/5 split left ~420px for the donut + category list
          and ~300px for merchants, truncating every name. Below xl the
          categories card spans the full row and merchants + money movement
          sit side by side underneath it. */}
      <div className="lg:col-span-12 xl:col-span-7 flex flex-col gap-4 min-w-0">
      <section className="surface-card p-4 md:p-5 bento-rise flex-1" style={{ animationDelay: "120ms" }} aria-label="Spending by category">
        <CardTitle title="Where it went" sub={`Tap a category to filter transactions · % change is vs ${p.prevMonthShort}`}
          right={
            <button onClick={p.onManageBudgets}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border/70 text-[12px] font-medium text-foreground hover:border-[hsl(var(--primary)/0.6)] hover:bg-[hsl(var(--primary)/0.06)] transition-colors shrink-0">
              <Wallet className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> Budgets
            </button>
          } />
        {p.categories.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-muted-foreground">No spending in {p.monthName} yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-5 items-center">
            <div className="relative h-[200px] w-[200px] mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="label" innerRadius={68} outerRadius={94} paddingAngle={2} stroke="none"
                    isAnimationActive={false} onMouseLeave={() => setHoverCat(null)}>
                    {donut.map(d => (
                      <Cell key={d.key} fill={d.color} cursor={d.key === "__other__" ? "default" : "pointer"}
                        opacity={focus && focus !== d.key ? 0.3 : 1}
                        onMouseEnter={() => setHoverCat(d.key)}
                        onClick={() => d.key !== "__other__" && p.onSelectCat(p.selectedCat === d.key ? null : d.key)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
                <div>
                  <div className="text-[11px] text-muted-foreground max-w-[110px] truncate">{focusRow ? focusRow.label : "Total"}</div>
                  <div className="text-[20px] font-semibold text-foreground tabular leading-tight">{fmtUSD(focusRow ? focusRow.value : catTotal, { compact: (focusRow?.value ?? catTotal) >= 10000 })}</div>
                  <div className="text-[11px] text-muted-foreground tabular">
                    {focusRow ? `${Math.round((focusRow.value / Math.max(catTotal, 1)) * 100)}% of spend` : `${p.categories.length} categories`}
                  </div>
                </div>
              </div>
            </div>

            <ul className="space-y-1 min-w-0">
              {p.categories.slice(0, 7).map(c => {
                const Icon = p.categoryIcon(c.cat);
                const col = vivid(p.catColor(c.cat));
                const active = p.selectedCat === c.cat;
                const mom = c.prevSpend > 0 ? Math.round(((c.spend - c.prevSpend) / c.prevSpend) * 100) : null;
                const over = c.budget != null && c.spend > c.budget;
                const bPct = c.budget ? Math.min((c.spend / c.budget) * 100, 100) : 0;
                return (
                  <li key={c.cat}>
                    <div role="button" tabIndex={0}
                      onClick={() => p.onSelectCat(active ? null : c.cat)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onSelectCat(active ? null : c.cat); } }}
                      onMouseEnter={() => setHoverCat(c.cat)} onMouseLeave={() => setHoverCat(null)}
                      aria-pressed={active}
                      className={cn("group w-full text-left rounded-xl px-2.5 py-2 flex items-center gap-3 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary)/0.6)]",
                        active ? "bg-[hsl(var(--primary)/0.10)] ring-1 ring-[hsl(var(--primary)/0.35)]" : "hover:bg-muted/50")}>
                      <span className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ background: withAlpha(col, 0.16), color: col }}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-foreground truncate">{p.formatCat(c.cat)}</span>
                          <button onClick={e => { e.stopPropagation(); p.onCategoryDetails(c.cat); }} aria-label={`Edit ${p.formatCat(c.cat)}`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-5 w-5 grid place-items-center rounded text-muted-foreground hover:text-foreground transition-opacity">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <span className="ml-auto text-[13px] font-semibold tabular text-foreground">{fmtUSD(c.spend)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {c.fixed ? (
                            <span className="text-[11px] text-muted-foreground">Fixed bill · paid this month</span>
                          ) : c.budget != null ? (
                            <>
                              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${bPct}%`, background: over ? "hsl(var(--negative))" : col }} />
                              </div>
                              <span className={cn("text-[11px] tabular shrink-0", over ? "text-negative font-semibold" : "text-muted-foreground")}>
                                {over ? `${fmtUSD(c.spend - c.budget)} over ${fmtUSD(c.budget)} budget` : `${Math.round((c.spend / Math.max(c.budget, 1)) * 100)}% of ${fmtUSD(c.budget)} budget`}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground flex-1">No budget set</span>
                          )}
                          {mom != null && (
                            <span title={`${p.prevMonthShort}: ${fmtUSD(c.prevSpend)}`}
                              className={cn("text-[11px] font-semibold tabular shrink-0 w-[96px] text-right whitespace-nowrap", mom > 0 ? "text-negative" : "text-positive")}>
                              {mom > 0 ? "▲" : "▼"} {Math.abs(mom)}% vs {p.prevMonthShort}
                            </span>
                          )}
                          {mom == null && <span className="text-[11px] text-muted-foreground shrink-0 w-[96px] text-right">New</span>}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

        {p.flagged.length > 0 && (
          <section className="surface-card p-4 bento-rise border-[hsl(var(--warning)/0.35)]" style={{ animationDelay: "220ms" }} aria-label="Worth a look">
            <CardTitle title="Worth a look" sub="Still counted in spending until you recategorize them" />
            <ul className="space-y-1">
              {p.flagged.slice(0, 4).map(f => (
                <li key={f.id}>
                  <button onClick={() => p.onOpenFlagged(f.id)}
                    className="w-full flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/40 transition-colors">
                    <FlagChip flag={f.flag} />
                    <span className="text-[13px] text-foreground truncate flex-1 min-w-0" title={f.label}>{f.label}</span>
                    <span className="text-[11.5px] text-muted-foreground shrink-0">{fmtShortDate(f.date)}</span>
                    <span className="text-[13px] font-semibold tabular text-foreground shrink-0">{fmtUSD(f.amount)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ── Right column: merchants + money movement ─────────────────── */}
      <div className="lg:col-span-12 xl:col-span-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4 content-start min-w-0">
        <section className="surface-card p-4 md:p-5 bento-rise min-w-0" style={{ animationDelay: "180ms" }} aria-label="Top merchants">
          <CardTitle title="Top merchants" sub="This month · line shows the last 6 months" />
          {p.merchants.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">Nothing yet.</div>
          ) : (
            <ul className="space-y-0.5">
              {p.merchants.map((m, i) => {
                const Icon = p.categoryIcon(m.cat);
                const col = vivid(p.catColor(m.cat));
                return (
                  <li key={m.name} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-muted/40 transition-colors">
                    <span className="w-4 text-[11px] text-muted-foreground tabular text-right shrink-0">{i + 1}</span>
                    <span className="h-8 w-8 rounded-full grid place-items-center shrink-0" style={{ background: withAlpha(col, 0.16), color: col }}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground truncate" title={m.name}>{m.name}</div>
                      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(m.total / maxMerchant) * 100}%`, background: col }} />
                      </div>
                    </div>
                    <Sparkline values={m.trend} color={col} />
                    <div className="text-right shrink-0 w-[72px]">
                      <div className="text-[13px] font-semibold text-foreground tabular">{fmtUSD(m.total)}</div>
                      <div className="text-[11px] text-muted-foreground">{m.count} {m.count === 1 ? "charge" : "charges"}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <MoneyMovement movement={p.movement} monthName={p.monthName} onShowIgnored={p.onShowIgnored} />

      </div>
    </div>
  );
}

export function FlagChip({ flag, compact = false }: { flag: TxnFlag; compact?: boolean }) {
  const dup = flag === "duplicate";
  const Icon = dup ? Copy : ArrowLeftRight;
  return (
    <span title={dup ? "Same amount & merchant within 3 days. Possible duplicate charge." : "Looks like a transfer between your own accounts. It's counted as spending until you recategorize it."}
      className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold shrink-0 whitespace-nowrap",
        dup ? "bg-[hsl(var(--negative)/0.12)] text-negative" : "bg-[hsl(210_60%_60%/0.14)] text-[hsl(210_70%_70%)]")}>
      <Icon className="h-2.5 w-2.5" />{compact ? (dup ? "Dup?" : "Transfer?") : (dup ? "Possible duplicate" : "Transfer?")}
    </span>
  );
}

export function PendingChip() {
  return (
    <span title="Pending: not posted yet. Included in totals; the amount may still change."
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold bg-warning/10 text-warning whitespace-nowrap">
      <Clock className="h-2.5 w-2.5" />Pending
    </span>
  );
}

const MOVEMENT_ROWS: { key: MovementKey; label: string; note: string; icon: React.ElementType; tone: string }[] = [
  { key: "credit_card_payment", label: "Credit card payments", note: "Pays off purchases already counted above", icon: CreditCard, tone: "hsl(215 30% 68%)" },
  { key: "savings_contribution", label: "Savings & investing", note: "Brokerage, savings and retirement contributions", icon: PiggyBank, tone: "hsl(158 48% 52%)" },
  // Money sent to / received from people (Venmo, Zelle…) is transfer_out /
  // transfer_in under the shared definitions, together with unmatched
  // transfers: neither spending nor income unless the user re-types them.
  { key: "transfer_out", label: "Sent to people & transfers out", note: "Venmo, Zelle, Cash App… and unmatched transfers; not spending", icon: Send, tone: "hsl(30 60% 66%)" },
  { key: "transfer_in", label: "Received from people & transfers in", note: "Venmo, Zelle, Cash App… and unmatched transfers; not income", icon: HandCoins, tone: "hsl(158 40% 60%)" },
];

function MoneyMovement({ movement, monthName, onShowIgnored }: { movement: OverviewMovement; monthName: string; onShowIgnored: () => void }) {
  const internal = movement["transfer_internal"];
  return (
    <section className="surface-card p-4 md:p-5 bento-rise flex-1" style={{ animationDelay: "200ms" }} aria-label="Money movement">
      <CardTitle title="Money movement" sub={`${monthName} · not spending, not budgeted`} />
      <ul className="space-y-0.5">
        {MOVEMENT_ROWS.map(r => {
          const v = movement[r.key];
          const Icon = r.icon;
          return (
            <li key={r.key} className={cn("flex items-center gap-3 rounded-lg px-1.5 py-1.5", v.count === 0 && "opacity-50")}>
              <span className="h-8 w-8 rounded-full grid place-items-center shrink-0" style={{ background: withAlpha(r.tone, 0.14), color: r.tone }}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground truncate">{r.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">{r.note}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={cn("text-[13px] font-semibold tabular", r.key === "transfer_in" && v.total > 0 ? "text-positive" : "text-foreground")}>
                  {v.count === 0 ? "None" : `${r.key === "transfer_in" ? "+" : ""}${fmtUSD(v.total)}`}
                </div>
                {v.count > 0 && <div className="text-[11px] text-muted-foreground">{v.count} {v.count === 1 ? "txn" : "txns"}</div>}
              </div>
            </li>
          );
        })}
      </ul>
      <button onClick={onShowIgnored}
        className="mt-2 w-full flex items-center gap-3 rounded-lg border border-dashed border-border/70 px-2.5 py-2 text-left text-muted-foreground hover:bg-muted/30 transition-colors">
        <Repeat className="h-4 w-4 shrink-0" />
        <span className="text-[12px] flex-1">Internal transfers (ignored) · between your own accounts</span>
        <span className="text-[12px] tabular">{internal.count ? `${fmtUSD(internal.total)} · ${internal.count}` : "None"}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      </button>
    </section>
  );
}
