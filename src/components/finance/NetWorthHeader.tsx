import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { netWorthSeries } from "@/lib/finance-data";

interface Props {
  netWorth: number;
  assets: number;
  liabilities: number;
}

export const NetWorthHeader = ({ netWorth, assets, liabilities }: Props) => {
  const first = netWorthSeries[0].v;
  const last = netWorthSeries[netWorthSeries.length - 1].v;
  const change = last - first;
  const changePct = (change / first) * 100;

  return (
    <section className="surface-elevated relative overflow-hidden p-8 md:p-10 animate-fade-up">
      {/* glow */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-positive/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-info/5 blur-3xl" />

      <div className="relative grid gap-10 md:grid-cols-[1.1fr_1fr] md:gap-16">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-positive" />
            Net worth · April 2026
          </div>

          <h1 className="font-display text-5xl md:text-7xl font-medium leading-[0.95] mt-3 tabular text-primary">
            {fmtUSD(netWorth)}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="chip chip-positive">
              <ArrowUpRight className="h-3.5 w-3.5" />
              {fmtUSD(change, { signed: true, compact: true })} ({fmtPct(changePct, 1)})
            </span>
            <span className="text-sm text-muted-foreground">vs. 12 months ago</span>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 max-w-md">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Total Assets</div>
              <div className="font-display text-2xl mt-1 tabular text-positive">{fmtUSD(assets, { compact: true })}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Total Liabilities</div>
              <div className="font-display text-2xl mt-1 tabular text-negative">−{fmtUSD(Math.abs(liabilities), { compact: true })}</div>
            </div>
          </div>
        </div>

        <div className="h-48 md:h-56 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netWorthSeries} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--positive))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--positive))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="m"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                interval={1}
              />
              <YAxis hide domain={["dataMin - 5000", "dataMax + 5000"]} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border-strong))",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number) => [fmtUSD(v), "Net worth"]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--positive))"
                strokeWidth={2}
                fill="url(#nw)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};
